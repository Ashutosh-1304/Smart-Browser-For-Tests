# Smart Browser — Veyon "ProctorFeature" Plugin

Bridges the Smart Browser proctoring app to the Veyon Master console so a lab
supervisor sees each student's proctoring violations and fairness score **inside
Veyon**, and can push actions (lock / warn / unlock / end) back to the student's
exam.

This is the **Option 1** integration: one plugin binary loads on both ends and
uses Veyon's own transport between the student PC and the teacher PC. The plugin
only talks to the Smart Browser app over `ws://localhost:3001/proctor` on the
student's own machine — the JSON contract is defined in
`server/proctor/bridge.js`.

```
STUDENT PC                                          TEACHER PC
┌─ Veyon Service + this plugin ─┐                  ┌─ Veyon Master + this plugin ─┐
│ ProctorBridgeClient           │   Veyon's own    │ handleFeatureMessage()       │
│  ↔ ws://localhost:3001        │   FeatureMessage │  → flag on student thumbnail │
│ app violations/score  ────────┼─────────────────►│  + fairness score            │
│ supervisor commands  ◄────────┼──────────────────┤  teacher clicks → command    │
└───────────────────────────────┘                  └──────────────────────────────┘
```

## Files
| File | Role |
|------|------|
| `ProctorFeaturePlugin.{h,cpp}` | Veyon `PluginInterface` + `FeatureProviderInterface`. Defines two features: `ProctorFlag` (state → thumbnail) and `ProctorCommand` (teacher action). Routes `FeatureMessage`s both ways. |
| `ProctorBridgeClient.{h,cpp}` | Pure-Qt `QWebSocket` client to the local hub. No Veyon dependency, so it can be tested standalone. |
| `CMakeLists.txt` | In-tree and out-of-tree build. |

## Prerequisites
- **Veyon source for the exact version you deploy.** A plugin must match the
  ABI of the Veyon it loads into — a plugin built against 4.8.x will not load
  into 4.7.x. Install the matching Veyon on all PCs.
- **Qt** matching that Veyon build (Veyon 4.8+ uses **Qt6**; older uses Qt5),
  including the **WebSockets** module (`qt6-websockets` / `Qt6WebSockets`),
  which the stock Veyon build does not pull in.
- CMake ≥ 3.16, a C++17 compiler (MSVC on Windows, GCC/Clang on Linux).

## Build — recommended (in-tree)
This is the reliable path: `build_veyon_plugin()` and the `veyon-core` target
already exist inside the Veyon tree.

1. Clone Veyon at your target version:
   ```sh
   git clone --branch v4.8.3 https://github.com/veyon/veyon.git
   ```
2. Copy this folder in:
   ```sh
   cp -r veyon-plugin veyon/plugins/proctorfeature
   ```
3. Register it — add to `veyon/plugins/CMakeLists.txt`:
   ```cmake
   add_subdirectory(proctorfeature)
   ```
4. Configure + build Veyon normally (Windows example):
   ```sh
   cd veyon
   cmake -B build -G "Visual Studio 17 2022" -A x64
   cmake --build build --config Release
   ```
5. The plugin builds as `proctorfeature.dll` (Windows) / `.so` (Linux) and is
   placed with Veyon's other plugins.

## Build — out-of-tree (advanced, more fragile)
Requires an installed Veyon SDK (headers + `veyon-core` import lib):
```sh
cmake -B build -DVEYON_DIR=/path/to/veyon-sdk
cmake --build build --config Release
```
Then copy the resulting module next to Veyon's plugins (see Install).

## Install
Place the built module where Veyon loads plugins **on every PC** (students and
the teacher):
- **Windows:** `C:\Program Files\Veyon\plugins\`
- **Linux:** `/usr/lib/veyon/` (distro-dependent)

Restart the Veyon Service (students) and the Veyon Master (teacher). The app's
backend (`npm run dev:server`, port 3001 with the `/proctor` hub) must be
running on each student PC — it already starts with the Smart Browser app.

## Verify it works
1. Student PC: start the Smart Browser app + server, begin an exam. Trigger a
   violation (e.g. look away / show phone).
2. Teacher PC: open Veyon Master. The student's thumbnail should surface the
   violation; the fairness score updates live.
3. Teacher triggers the **Lock Student Exam** action → the student's app shows
   the lock overlay (handled in `src/App.jsx`).

## ⚠️ TODO(verify) — confirm against YOUR Veyon headers before shipping
These spots are version-sensitive and are flagged inline in the code. I did not
guess silently — confirm each against your installed Veyon's headers:

1. **`FeatureMessage` argument API** (`ProctorFeaturePlugin.cpp`) —
   `addArgument(key, value)` / `argument(key)`. Some versions use different
   setter/getter names or an index-based API. Check `core/include/FeatureMessage.h`.
2. **Emitting an unsolicited message Service → Master**
   (`onProctorViolation/Score/Session`). The correct call differs by version
   (`sendAsyncFeatureMessages()`, or caching a reply handle from a prior
   `handleFeatureMessage`). Check `VeyonServerInterface.h`.
3. **Thumbnail decoration on the Master** (`handleFeatureMessage` master
   overload). The placeholder uses `setUserLoginName()` just to prove the data
   arrives; replace with a real badge/overlay. Check how built-in features
   (e.g. the "Demo"/"ScreenLock" plugins) decorate computers.
4. **`sendFeatureMessage` signature** (`sendCommandToStudent`). Confirm the
   `ComputerControlInterface` method name/arguments.
5. **CMake target name** from `build_veyon_plugin()` and the Qt major version.
6. **Plugin UID** in `uid()` — regenerate with `uuidgen` if it ever clashes.

## License
This plugin links `veyon-core`, which is **GPLv2**. Anything you distribute that
includes this plugin is therefore bound by **GPLv2**. (Only the arm's-length
`veyon-cli` subprocess approach would avoid that — but that cannot render flags
inside the Master, which is the whole point here.) Keep this plugin's source
available if you distribute binaries.
