/**
 * FairnessScoreEngine
 *
 * A framework-agnostic scoring engine that computes a fairness score (0–100)
 * from violation data. Each violation type starts at 100 and is deducted by
 * a fixed amount per violation event. Types are grouped by priority tiers
 * whose weights auto-normalize so adding new types never requires manual
 * weight redistribution.
 *
 * Usage:
 *   const engine = new FairnessScoreEngine();
 *   engine.recordViolation('face');
 *   engine.recordViolation('focus');
 *   const { total, breakdown } = engine.getScore();
 */

// ── Priority tiers ──────────────────────────────────────────────────────────
// Values are tuned so auto-normalized weights match the desired distribution:
//   HIGH     → 5/20 = 0.25 each  (multiple-faces, face)
//   MEDIUM_HIGH → 4/20 = 0.20    (gaze)
//   MEDIUM   → 3/20 = 0.15 each  (focus, fullscreen)
const PRIORITY_VALUES = {
  HIGH: 5,
  MEDIUM_HIGH: 4,
  MEDIUM: 3,
  LOW: 1,
};

// ── Default violation type configuration ────────────────────────────────────
// Add a new entry here to register a new violation type. Weights will
// auto-recalculate — no other code changes needed.
const DEFAULT_VIOLATION_CONFIG = {
  'multiple-faces': {
    priority: 'HIGH',
    deduction: 20,
    label: 'Multiple Faces',
  },
  face: {
    priority: 'HIGH',
    deduction: 15,
    label: 'No Face',
  },
  gaze: {
    priority: 'MEDIUM_HIGH',
    deduction: 12,
    label: 'Looking Away',
  },
  focus: {
    priority: 'MEDIUM',
    deduction: 10,
    label: 'Tab Switch',
  },
  fullscreen: {
    priority: 'MEDIUM',
    deduction: 10,
    label: 'Fullscreen Exit',
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export { PRIORITY_VALUES, DEFAULT_VIOLATION_CONFIG };

export default class FairnessScoreEngine {
  /**
   * @param {Object} [config] – Optional custom violation config.
   *   Falls back to DEFAULT_VIOLATION_CONFIG when omitted.
   *   Shape: { [type]: { priority: 'HIGH'|'MEDIUM'|'LOW', deduction: number, label: string } }
   */
  constructor(config) {
    this._config = config || { ...DEFAULT_VIOLATION_CONFIG };
    this._scores = {};       // type → current score (starts at 100)
    this._counts = {};       // type → number of violations recorded
    this._weights = {};      // type → auto-calculated weight (0–1)
    this._history = [];      // ordered list of { type, timestamp, scoreBefore, scoreAfter }

    this._initScores();
    this._computeWeights();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Record a violation of the given type.
   * Deducts the configured amount from that type's score (clamped at 0).
   *
   * @param {string} type – Must match a key in the violation config.
   * @returns {{ total: number, typeScore: number } | null} Updated scores, or null if type unknown.
   */
  recordViolation(type) {
    const cfg = this._config[type];
    if (!cfg) {
      console.warn(`[FairnessScoreEngine] Unknown violation type: "${type}"`);
      return null;
    }

    const before = this._scores[type];
    this._scores[type] = Math.max(0, before - cfg.deduction);
    this._counts[type] = (this._counts[type] || 0) + 1;

    this._history.push({
      type,
      timestamp: Date.now(),
      scoreBefore: before,
      scoreAfter: this._scores[type],
    });

    return {
      total: this._computeTotal(),
      typeScore: this._scores[type],
    };
  }

  /**
   * Get the full score report.
   *
   * @returns {{
   *   total: number,
   *   breakdown: Array<{ type: string, label: string, score: number, weight: number, weighted: number, violations: number, priority: string }>,
   *   history: Array<{ type: string, timestamp: number, scoreBefore: number, scoreAfter: number }>
   * }}
   */
  getScore() {
    const breakdown = Object.keys(this._config).map((type) => {
      const cfg = this._config[type];
      const score = this._scores[type];
      const weight = this._weights[type];
      return {
        type,
        label: cfg.label,
        score,
        weight,
        weighted: +(score * weight).toFixed(2),
        violations: this._counts[type] || 0,
        priority: cfg.priority,
      };
    });

    return {
      total: this._computeTotal(),
      breakdown,
      history: [...this._history],
    };
  }

  /**
   * Reset all scores back to 100 and clear history.
   */
  reset() {
    this._initScores();
    this._history = [];
  }

  /**
   * Dynamically register a new violation type (or update an existing one).
   * Weights auto-recalculate after this call.
   *
   * @param {string} type
   * @param {{ priority: string, deduction: number, label: string }} cfg
   */
  registerType(type, cfg) {
    this._config[type] = cfg;
    if (this._scores[type] === undefined) {
      this._scores[type] = 100;
      this._counts[type] = 0;
    }
    this._computeWeights();
  }

  /**
   * Get current config (read-only copy).
   */
  getConfig() {
    return { ...this._config };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  _initScores() {
    for (const type of Object.keys(this._config)) {
      this._scores[type] = 100;
      this._counts[type] = 0;
    }
  }

  _computeWeights() {
    const types = Object.keys(this._config);
    const totalPriority = types.reduce((sum, type) => {
      const tier = this._config[type].priority;
      return sum + (PRIORITY_VALUES[tier] || 1);
    }, 0);

    for (const type of types) {
      const tier = this._config[type].priority;
      this._weights[type] = (PRIORITY_VALUES[tier] || 1) / totalPriority;
    }
  }

  _computeTotal() {
    return +Object.keys(this._config)
      .reduce((sum, type) => {
        return sum + this._scores[type] * this._weights[type];
      }, 0)
      .toFixed(2);
  }
}
