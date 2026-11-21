export const NORMALIZATION_RULES = {
  multiplier: {
    id: 'multiplier',
    name: 'Integrity Multiplier',
    description: 'Scales raw score proportionally by fairness percentage: Raw × (Fairness / 100)',
    formula: 'Raw × (Fairness / 100)',
    calculate: (rawScore, fairnessScore, maxScore = 100) => {
      const raw = Math.min(Number(maxScore) || 100, Math.max(0, Number(rawScore) || 0));
      const fairness = Math.min(100, Math.max(0, Number(fairnessScore) || 0));
      return Number(((raw * fairness) / 100).toFixed(2));
    },
  },
  weighted_80_20: {
    id: 'weighted_80_20',
    name: 'Dual Weighted (80% Exam + 20% Integrity)',
    description: '80% of final grade from raw test score, 20% from proctoring integrity',
    formula: '0.80 × Raw + 0.20 × (Fairness% × Max)',
    calculate: (rawScore, fairnessScore, maxScore = 100) => {
      const raw = Math.min(Number(maxScore) || 100, Math.max(0, Number(rawScore) || 0));
      const max = Number(maxScore) || 100;
      const fairness = Math.min(100, Math.max(0, Number(fairnessScore) || 0));
      const examPart = 0.8 * raw;
      const integrityPart = 0.2 * ((fairness / 100) * max);
      return Number((examPart + integrityPart).toFixed(2));
    },
  },
  penalty_deduction: {
    id: 'penalty_deduction',
    name: 'Direct Penalty Deduction',
    description: 'Directly subtracts proctoring violation deductions from raw exam score',
    formula: 'Max(0, Raw − ((100 − Fairness) × Max / 100))',
    calculate: (rawScore, fairnessScore, maxScore = 100) => {
      const raw = Math.min(Number(maxScore) || 100, Math.max(0, Number(rawScore) || 0));
      const max = Number(maxScore) || 100;
      const fairness = Math.min(100, Math.max(0, Number(fairnessScore) || 0));
      const penaltyPercent = 100 - fairness;
      const deductedPoints = (penaltyPercent / 100) * max;
      return Number(Math.max(0, raw - deductedPoints).toFixed(2));
    },
  },
  threshold_gate: {
    id: 'threshold_gate',
    name: 'Integrity Threshold Gate',
    description: 'Full raw score holds if fairness ≥ threshold; zeroed if student violates below threshold',
    formula: 'Fairness ≥ Threshold ? Raw : 0',
    calculate: (rawScore, fairnessScore, maxScore = 100, passThreshold = 70) => {
      const raw = Math.min(Number(maxScore) || 100, Math.max(0, Number(rawScore) || 0));
      const fairness = Math.min(100, Math.max(0, Number(fairnessScore) || 0));
      const threshold = Number(passThreshold) || 70;
      return fairness >= threshold ? Number(raw.toFixed(2)) : 0;
    },
  },
};

export function calculateNormalizedScore({
  rule = 'multiplier',
  rawScore = 0,
  fairnessScore = 100,
  maxScore = 100,
  passThreshold = 70,
}) {
  const normRule = NORMALIZATION_RULES[rule] || NORMALIZATION_RULES.multiplier;
  return normRule.calculate(rawScore, fairnessScore, maxScore, passThreshold);
}

export function determineSessionStatus(fairnessScore, passThreshold = 70) {
  const score = Number(fairnessScore) || 0;
  const threshold = Number(passThreshold) || 70;
  if (score >= threshold) return 'passed';
  if (score >= threshold - 15) return 'flagged';
  return 'failed';
}

export const PLATFORM_CHOICES = {
  'google-forms': {
    id: 'google-forms',
    name: 'Google Forms',
    pattern: '^https?:\\/\\/(docs|forms)\\.google\\.com\\/forms',
    example: 'https://docs.google.com/forms/d/e/1FAIpQLSc.../viewform',
    icon: 'form',
  },
  'ms-forms': {
    id: 'ms-forms',
    name: 'Microsoft Forms',
    pattern: '^https?:\\/\\/forms\\.(office|microsoft)\\.com',
    example: 'https://forms.office.com/r/AbCd1234',
    icon: 'form',
  },
  'quizizz': {
    id: 'quizizz',
    name: 'Quizizz / Kahoot',
    pattern: '^https?:\\/\\/(quizizz|kahoot)\\.(com|it)',
    example: 'https://quizizz.com/join?gc=123456',
    icon: 'game',
  },
  'canvas': {
    id: 'canvas',
    name: 'Canvas / LMS',
    pattern: '.*',
    example: 'https://canvas.instructure.com/courses/.../quizzes/...',
    icon: 'school',
  },
  'custom': {
    id: 'custom',
    name: 'Custom Web Link',
    pattern: '.*',
    example: 'https://assessment-portal.edu/exam/midterm-2026',
    icon: 'globe',
  },
};
