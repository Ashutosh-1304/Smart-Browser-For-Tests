
export const PRESET_IDS = ['level-1', 'level-2', 'level-3'];

const BASE = 'Derived from mainstream online-proctoring practice (Unstop / standard remote-proctoring rubric); see docs/proctoring-levels.md';

export const PROCTORING_PRESETS = {
  'level-1': {
    id: 'level-1',
    name: 'Relaxed',
    level: 1,
    description: 'Practice quizzes and low-stakes checks. Counts only the clearest integrity signals and forgives a few minor events before scoring.',
    basis: BASE,
    passThreshold: 50,
    grace: 3,
    violations: {
      'multiple-faces': { enabled: true,  priority: 'HIGH',   deduction: 15, dwellMs: 3000, cooldownMs: 5000, label: 'Multiple Faces' },
      'face':           { enabled: true,  priority: 'HIGH',   deduction: 8,  dwellMs: 5000, cooldownMs: 5000, label: 'No Face' },
      'gaze':           { enabled: false, priority: 'MEDIUM_HIGH', deduction: 8, dwellMs: 1500, cooldownMs: 5000, label: 'Looking Away' },
      'focus':          { enabled: true,  priority: 'MEDIUM', deduction: 5,  dwellMs: 2000, cooldownMs: 2000, label: 'Tab Switch' },
      'fullscreen':     { enabled: true,  priority: 'MEDIUM', deduction: 5,  dwellMs: 1000, cooldownMs: 5000, label: 'Fullscreen Exit' },
      'obstacle':       { enabled: false, priority: 'MEDIUM', deduction: 10, dwellMs: 800,  cooldownMs: 5000, label: 'Object Detected' },
    },
  },

  'level-2': {
    id: 'level-2',
    name: 'Standard',
    level: 2,
    description: 'Balanced settings for regular graded tests. This reproduces the application’s original default scoring behavior.',
    basis: BASE,
    passThreshold: 70,
    grace: 1,
    violations: {
      'multiple-faces': { enabled: true, priority: 'HIGH',        deduction: 20, dwellMs: 3000, cooldownMs: 5000, label: 'Multiple Faces' },
      'face':           { enabled: true, priority: 'HIGH',        deduction: 15, dwellMs: 3000, cooldownMs: 5000, label: 'No Face' },
      'gaze':           { enabled: true, priority: 'MEDIUM_HIGH', deduction: 12, dwellMs: 1500, cooldownMs: 5000, label: 'Looking Away' },
      'focus':          { enabled: true, priority: 'MEDIUM',      deduction: 10, dwellMs: 2000, cooldownMs: 2000, label: 'Tab Switch' },
      'fullscreen':     { enabled: true, priority: 'MEDIUM',      deduction: 10, dwellMs: 1000, cooldownMs: 5000, label: 'Fullscreen Exit' },
      'obstacle':       { enabled: true, priority: 'MEDIUM',      deduction: 8,  dwellMs: 1000, cooldownMs: 5000, label: 'Object Detected' },
    },
  },

  'level-3': {
    id: 'level-3',
    name: 'Strict',
    level: 3,
    description: 'High-stakes and final exams. Faster detection, heavier deductions, and no forgiveness — every event counts.',
    basis: BASE,
    passThreshold: 85,
    grace: 0,
    violations: {
      'multiple-faces': { enabled: true, priority: 'HIGH',        deduction: 30, dwellMs: 2000, cooldownMs: 4000, label: 'Multiple Faces' },
      'face':           { enabled: true, priority: 'HIGH',        deduction: 20, dwellMs: 2000, cooldownMs: 4000, label: 'No Face' },
      'gaze':           { enabled: true, priority: 'MEDIUM_HIGH', deduction: 15, dwellMs: 1000, cooldownMs: 4000, label: 'Looking Away' },
      'focus':          { enabled: true, priority: 'MEDIUM',      deduction: 20, dwellMs: 1500, cooldownMs: 1500, label: 'Tab Switch' },
      'fullscreen':     { enabled: true, priority: 'MEDIUM',      deduction: 20, dwellMs: 800,  cooldownMs: 4000, label: 'Fullscreen Exit' },
      'obstacle':       { enabled: true, priority: 'MEDIUM',      deduction: 20, dwellMs: 500,  cooldownMs: 4000, label: 'Object Detected' },
    },
  },
};

export const DEFAULT_PRESET_ID = 'level-2';

export const PRESET_VALIDATION = {
  priorities: ['HIGH', 'MEDIUM_HIGH', 'MEDIUM', 'LOW'],
  deduction: { min: 0, max: 100 },
  dwellMs: { min: 0, max: 30000 },
  cooldownMs: { min: 0, max: 60000 },
  grace: { min: 0, max: 20 },
  passThreshold: { min: 0, max: 100 },
};

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function clampInt(n, { min, max }) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return null;
  return Math.min(max, Math.max(min, v));
}

export function getPreset(id) {
  const preset = PROCTORING_PRESETS[id] || PROCTORING_PRESETS[DEFAULT_PRESET_ID];
  return JSON.parse(JSON.stringify(preset));
}

export function engineConfigFromPreset(preset) {
  const out = {};
  for (const [type, v] of Object.entries(preset.violations || {})) {
    if (v && v.enabled) {
      out[type] = { priority: v.priority, deduction: v.deduction, label: v.label };
    }
  }
  return out;
}

export function buildCustomPreset(baseId = DEFAULT_PRESET_ID, overrides = {}) {
  const base = getPreset(baseId);
  const errors = [];

  const merged = {
    ...base,
    id: 'custom',
    name: 'Custom',
    level: null,
    description: `Teacher-customized profile based on ${base.name}.`,
    violations: JSON.parse(JSON.stringify(base.violations)),
  };

  if (overrides.name && typeof overrides.name === 'string') {
    merged.name = overrides.name.slice(0, 60);
  }
  if (overrides.description && typeof overrides.description === 'string') {
    merged.description = overrides.description.slice(0, 200);
  }

  if (overrides.grace !== undefined) {
    const g = clampInt(overrides.grace, PRESET_VALIDATION.grace);
    if (g == null) errors.push(`grace must be a number in ${PRESET_VALIDATION.grace.min}–${PRESET_VALIDATION.grace.max}`);
    else merged.grace = g;
  }
  if (overrides.passThreshold !== undefined) {
    const p = clampInt(overrides.passThreshold, PRESET_VALIDATION.passThreshold);
    if (p == null) errors.push(`passThreshold must be a number in ${PRESET_VALIDATION.passThreshold.min}–${PRESET_VALIDATION.passThreshold.max}`);
    else merged.passThreshold = p;
  }

  if (overrides.violations !== undefined) {
    if (!isPlainObject(overrides.violations)) {
      errors.push('violations must be an object keyed by violation type');
    } else {
      for (const [type, patch] of Object.entries(overrides.violations)) {
        const target = merged.violations[type];
        if (!target) {
          errors.push(`unknown violation type "${type}"`);
          continue;
        }
        if (!isPlainObject(patch)) {
          errors.push(`violations.${type} must be an object`);
          continue;
        }
        if (patch.enabled !== undefined) target.enabled = !!patch.enabled;
        if (patch.priority !== undefined) {
          if (PRESET_VALIDATION.priorities.includes(patch.priority)) {
            target.priority = patch.priority;
          } else {
            errors.push(`violations.${type}.priority must be one of ${PRESET_VALIDATION.priorities.join('/')}`);
          }
        }
        for (const key of ['deduction', 'dwellMs', 'cooldownMs']) {
          if (patch[key] === undefined) continue;
          const bounds = PRESET_VALIDATION[key];
          const val = clampInt(patch[key], bounds);
          if (val == null) errors.push(`violations.${type}.${key} must be a number in ${bounds.min}–${bounds.max}`);
          else target[key] = val;
        }
        if (patch.label !== undefined) target.label = String(patch.label).slice(0, 60);
      }
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, preset: merged };
}

export function resolvePreset(input) {
  if (input == null || input === DEFAULT_PRESET_ID) return getPreset(DEFAULT_PRESET_ID);
  if (typeof input === 'string') {
    if (input === 'custom') return getPreset(DEFAULT_PRESET_ID);
    return getPreset(input);
  }
  if (isPlainObject(input)) {
    if (input.violations) return input;
    const built = buildCustomPreset(input.baseId || DEFAULT_PRESET_ID, input);
    return built.ok ? built.preset : getPreset(DEFAULT_PRESET_ID);
  }
  return getPreset(DEFAULT_PRESET_ID);
}
