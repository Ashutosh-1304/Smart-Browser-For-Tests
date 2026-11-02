import test from 'node:test';
import assert from 'node:assert/strict';
import FairnessScoreEngine from '../../src/engine/FairnessScoreEngine.js';
import {
  PROCTORING_PRESETS,
  getPreset,
  resolvePreset,
  buildCustomPreset,
  engineConfigFromPreset,
  DEFAULT_PRESET_ID,
} from '../../src/engine/proctoringPresets.js';

const SEQUENCE = ['multiple-faces', 'face', 'gaze', 'focus', 'fullscreen', 'obstacle'];

function runSequence(preset) {
  const engine = new FairnessScoreEngine(engineConfigFromPreset(preset), { grace: preset.grace });
  for (const type of SEQUENCE) engine.recordViolation(type);
  return engine.getScore();
}

test('three built-in presets plus custom are defined as data', () => {
  for (const id of ['level-1', 'level-2', 'level-3']) {
    const p = PROCTORING_PRESETS[id];
    assert.ok(p, `missing preset ${id}`);
    assert.equal(typeof p.passThreshold, 'number');
    assert.equal(typeof p.grace, 'number');
    assert.ok(p.violations && Object.keys(p.violations).length === 6);
  }
});

test('level-2 reproduces the original default scoring behavior', () => {
  const preset = getPreset('level-2');
  const engine = new FairnessScoreEngine(engineConfigFromPreset(preset), { grace: 0 });
  for (const t of SEQUENCE) engine.recordViolation(t);
  const { total, breakdown } = engine.getScore();

  const expected = (80 * 5 + 85 * 5 + 88 * 4 + 90 * 3 + 90 * 3 + 92 * 3) / 23;
  assert.ok(Math.abs(total - expected) < 0.05, `total ${total} != ${expected}`);

  const types = breakdown.map(b => b.type).sort();
  assert.deepEqual(types, ['face', 'focus', 'fullscreen', 'gaze', 'multiple-faces', 'obstacle'].sort());
});

test('level-1 disables gaze and obstacle entirely', () => {
  const preset = getPreset('level-1');
  const cfg = engineConfigFromPreset(preset);
  assert.equal(cfg.gaze, undefined);
  assert.equal(cfg.obstacle, undefined);
  assert.ok(cfg.face && cfg['multiple-faces']);
});

test('disabled violations do not count and do not dilute weights', () => {
  const preset = getPreset('level-1');
  const { breakdown, total } = runSequence(preset);
  const types = breakdown.map(b => b.type);
  assert.ok(!types.includes('gaze'));
  assert.ok(!types.includes('obstacle'));
  const weightSum = breakdown.reduce((s, b) => s + b.weight, 0);
  assert.ok(Math.abs(weightSum - 1) < 1e-6);
  assert.equal(total, 100);
});

test('grace forgives the first N events per type', () => {
  const preset = getPreset('level-1');
  const engine = new FairnessScoreEngine(engineConfigFromPreset(preset), { grace: preset.grace });
  engine.recordViolation('face');
  engine.recordViolation('face');
  engine.recordViolation('face');
  const before = engine.getScore().breakdown.find(b => b.type === 'face');
  assert.equal(before.score, 100);
  assert.equal(before.violations, 3);
  engine.recordViolation('face');
  const after = engine.getScore().breakdown.find(b => b.type === 'face');
  assert.equal(after.score, 100 - preset.violations.face.deduction);
});

test('level-3 is stricter than level-2 for the same sequence', () => {
  const l2 = runSequence({ ...getPreset('level-2'), grace: 0 });
  const l3 = runSequence(getPreset('level-3'));
  assert.ok(l3.total < l2.total, `strict ${l3.total} should be < standard ${l2.total}`);
});

test('resolvePreset handles ids, custom objects, and stored configs', () => {
  assert.equal(resolvePreset('level-3').name, 'Strict');
  assert.equal(resolvePreset('bogus').id, DEFAULT_PRESET_ID);
  const stored = getPreset('level-2');
  assert.equal(resolvePreset(stored).id, 'level-2');
});

test('buildCustomPreset applies overrides and validates bounds', () => {
  const res = buildCustomPreset('level-2', {
    violations: { face: { deduction: 25, dwellMs: 2500 }, gaze: { enabled: false } },
    passThreshold: 80,
  });
  assert.equal(res.ok, true);
  assert.equal(res.preset.violations.face.deduction, 25);
  assert.equal(res.preset.violations.face.dwellMs, 2500);
  assert.equal(res.preset.violations.gaze.enabled, false);
  assert.equal(res.preset.passThreshold, 80);
});

test('buildCustomPreset rejects out-of-range and unknown fields', () => {
  const res = buildCustomPreset('level-2', {
    violations: { face: { deduction: 500 }, bogus: { deduction: 1 } },
    grace: 'not-a-number',
  });
  assert.equal(res.ok, false);
  assert.ok(res.errors.length >= 2);
});
