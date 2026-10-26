
const PRIORITY_VALUES = {
  HIGH: 5,
  MEDIUM_HIGH: 4,
  MEDIUM: 3,
  LOW: 1,
};

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
  obstacle: {
    priority: 'MEDIUM',
    deduction: 8,
    label: 'Object Detected',
  },
};


export { PRIORITY_VALUES, DEFAULT_VIOLATION_CONFIG };

export default class FairnessScoreEngine {
  constructor(config) {
    this._config = config || { ...DEFAULT_VIOLATION_CONFIG };
    this._scores = {};
    this._counts = {};
    this._weights = {};
    this._history = [];

    this._initScores();
    this._computeWeights();
  }


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

  reset() {
    this._initScores();
    this._history = [];
  }

  registerType(type, cfg) {
    this._config[type] = cfg;
    if (this._scores[type] === undefined) {
      this._scores[type] = 100;
      this._counts[type] = 0;
    }
    this._computeWeights();
  }

  getConfig() {
    return { ...this._config };
  }


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
