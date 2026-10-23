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
export function useFairnessScore(config, options) {
  const engineRef = useRef(null);
  const configKeyRef = useRef(null);

  // Recreate the engine when the resolved preset/config identity changes
  // (e.g. a test code carrying a different strictness level was entered).
  const configKey = JSON.stringify([config, options]);
  if (engineRef.current == null || configKeyRef.current !== configKey) {
    configKeyRef.current = configKey;
    engineRef.current = new FairnessScoreEngine(config, options);
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
