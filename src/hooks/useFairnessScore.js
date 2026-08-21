import { useCallback, useEffect, useRef, useState } from 'react';
import FairnessScoreEngine from '../engine/FairnessScoreEngine.js';

/**
 * React hook that wraps the FairnessScoreEngine, providing reactive state
 * updates whenever a violation is recorded.
 *
 * @param {Object} [config] – Optional custom violation config.
 * @returns {{
 *   score: number,
 *   breakdown: Array,
 *   recordViolation: (type: string) => void,
 *   reset: () => void,
 *   engine: FairnessScoreEngine
 * }}
 */
export function useFairnessScore(config) {
  const engineRef = useRef(null);

  // Lazily initialise the engine once (survives re-renders).
  if (!engineRef.current) {
    engineRef.current = new FairnessScoreEngine(config);
  }

  const engine = engineRef.current;
  const initial = engine.getScore();

  const [score, setScore] = useState(initial.total);
  const [breakdown, setBreakdown] = useState(initial.breakdown);

  const recordViolation = useCallback(
    (type) => {
      const result = engine.recordViolation(type);
      if (result) {
        const report = engine.getScore();
        setScore(report.total);
        setBreakdown(report.breakdown);
      }
    },
    [engine]
  );

  const reset = useCallback(() => {
    engine.reset();
    const report = engine.getScore();
    setScore(report.total);
    setBreakdown(report.breakdown);
  }, [engine]);

  return { score, breakdown, recordViolation, reset, engine };
}
