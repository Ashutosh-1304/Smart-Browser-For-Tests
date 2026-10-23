# Proctoring Strictness Levels

Issue #22 introduces **standardized proctoring strictness presets** so a teacher
picks a well-defined level instead of hand-tuning numbers. A preset is *data*,
defined once in [`src/engine/proctoringPresets.js`](../src/engine/proctoringPresets.js)
and shared by the candidate app and the backend.

## The spectrum

| | Level 1 — Relaxed | Level 2 — Standard | Level 3 — Strict | Custom |
|---|---|---|---|---|
| **Target use** | Practice / low-stakes | Regular graded tests | High-stakes / finals | Teacher-authored |
| `multiple-faces` | −15, dwell 3s | −20, dwell 3s | −30, dwell 2s | any |
| `face` (no face) | −8, dwell 5s | −15, dwell 3s | −20, dwell 2s | any |
| `gaze` (looking away) | **disabled** | −12, dwell 1.5s | −15, dwell 1s | any |
| `focus` (tab switch) | −5, dwell 2s | −10, dwell 2s | −20, dwell 1.5s | any |
| `fullscreen` exit | −5, dwell 1s | −10, dwell 1s | −20, dwell 0.8s | any |
| `obstacle` (phone/book) | **disabled** | −8, dwell 1s | −20, dwell 0.5s | any |
| **Grace** (forgiven events/type) | 3 | 1 | 0 | 0–20 |
| **Pass / review threshold** | < 50 | < 70 | < 85 | 0–100 |

**Level 2 — Standard reproduces the application's original defaults** exactly
(`DEFAULT_VIOLATION_CONFIG`: `multiple-faces` −20, `face` −15, `gaze` −12,
`focus`/`fullscreen` −10, `obstacle` −8; dwell 3s/3s/1.5s/2s/1s/1s), so existing
behavior is preserved as the default preset.

## External basis

The numbers are anchored to how mainstream online-proctoring and
remote-assessment platforms categorize integrity signals:

- **Presence violations are weighted highest.** A missing or second face is the
  clearest integrity breach and maps to `HIGH` priority — consistent with how
  proctoring rubrics (and platforms like Unstop) treat identity-presence as the
  primary signal.
- **Attention violations rank next.** Gaze-away is `MEDIUM_HIGH`: meaningful but
  noisier than face presence.
- **Environment violations are medium.** Tab switches, fullscreen exits, and
  prohibited objects sit at `MEDIUM`, since a single occurrence is ambiguous.

The *ratio* of deductions (presence > attention > environment) follows that
taxonomy; the *magnitude* scales across levels so the same violation profile
yields a predictably lower score at higher strictness. This gives the "Standard"
level a defensible rationale rather than arbitrary point values — see the
`basis` field on each preset.

## What a preset controls

Each preset is a named profile that sets, per violation type:

1. **Enabled / disabled** — whether the violation counts at this level at all
   (Level 1 ignores `gaze` and `obstacle`). Disabled types are omitted from the
   engine config, so they neither fire nor dilute the auto-normalized weights.
2. **Priority tier** — `HIGH` / `MEDIUM_HIGH` / `MEDIUM` / `LOW`, which drives
   the weight (`PRIORITY_VALUES` → auto-normalized).
3. **Per-event deduction** — points removed per occurrence.
4. **Detection sensitivity** — `dwellMs` (continuous signal before a violation
   fires) and `cooldownMs` (minimum gap between repeat violations). These are
   plumbed into the debounce timers in `App.jsx`.
5. **Grace / tolerance** — `grace` is the number of forgiven events per type
   before deductions apply.
6. **Pass threshold** — `passThreshold` is the fairness score below which a
   session is flagged for review.

## Custom profiles

`buildCustomPreset(baseId, overrides)` starts from a base level and applies
teacher overrides, validating each field against `PRESET_VALIDATION` bounds
(deductions 0–100, dwell/cooldown within sane ranges, known violation types and
priority tiers only). It returns `{ ok, preset | errors }`; the server rejects a
code-creation request that carries an invalid custom profile.

## How it's wired

- **Code generation** (`website/`): a preset selector (`level-1/2/3/custom`) is
  sent to `POST /api/codes`. The server validates it, stores `preset_id` +
  `preset_config` on the code row, and returns the resolved preset.
- **Code resolution** (`GET /api/codes/:code`): returns `{ presetId, preset }`,
  which the candidate app reads and applies.
- **Candidate app** (`src/App.jsx`): `resolvePreset()` turns the stored config
  into a preset object; `engineConfigFromPreset()` maps it to the
  `FairnessScoreEngine` config (enabled types only), and `grace` is passed as an
  engine option. The preset's `dwellMs`/`cooldownMs` drive the detection
  interval, and a badge shows the active level.

Because the resolved config is stored with the code, every student who joins
that code is proctored under the identical standard, and the config is recorded
for auditability with the session results.

## Open questions (tracked on the issue)

- Should `passThreshold` auto-set the gauge's green/yellow/red bands per preset?
- Can a teacher change the preset mid-window, or is it locked once the first
  student joins? (Currently it's fixed at code-creation time.)
