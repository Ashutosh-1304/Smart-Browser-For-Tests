import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../app.js';
import { initDb, db } from '../db.js';
import {
  calculateNormalizedScore,
  determineSessionStatus,
  NORMALIZATION_RULES,
} from '../utils/scoreNormalizer.js';

let server;
let baseUrl;

test.before(async () => {
  await initDb();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await db.destroy();
});

test('Score Normalizer: multiplier scales raw score proportionally by fairness percentage', () => {
  // Raw 90, Fairness 95 -> 90 * 0.95 = 85.5
  const res1 = calculateNormalizedScore({ rule: 'multiplier', rawScore: 90, fairnessScore: 95, maxScore: 100 });
  assert.equal(res1, 85.5);

  // Raw 80, Fairness 50 -> 80 * 0.50 = 40.0
  const res2 = calculateNormalizedScore({ rule: 'multiplier', rawScore: 80, fairnessScore: 50, maxScore: 100 });
  assert.equal(res2, 40);

  // Raw 100, Fairness 100 -> 100
  const res3 = calculateNormalizedScore({ rule: 'multiplier', rawScore: 100, fairnessScore: 100, maxScore: 100 });
  assert.equal(res3, 100);
});

test('Score Normalizer: weighted_80_20 splits grade 80% exam and 20% integrity', () => {
  // Raw 100, Fairness 100 -> 80 + 20 = 100
  const res1 = calculateNormalizedScore({ rule: 'weighted_80_20', rawScore: 100, fairnessScore: 100, maxScore: 100 });
  assert.equal(res1, 100);

  // Raw 100, Fairness 50 -> 80 + (0.2 * 50) = 80 + 10 = 90
  const res2 = calculateNormalizedScore({ rule: 'weighted_80_20', rawScore: 100, fairnessScore: 50, maxScore: 100 });
  assert.equal(res2, 90);
});

test('Score Normalizer: penalty_deduction subtracts violation points directly', () => {
  // Raw 90, Fairness 90 (10 deduction) -> 90 - 10 = 80
  const res1 = calculateNormalizedScore({ rule: 'penalty_deduction', rawScore: 90, fairnessScore: 90, maxScore: 100 });
  assert.equal(res1, 80);

  // Raw 20, Fairness 70 (30 deduction) -> max(0, 20 - 30) = 0
  const res2 = calculateNormalizedScore({ rule: 'penalty_deduction', rawScore: 20, fairnessScore: 70, maxScore: 100 });
  assert.equal(res2, 0);
});

test('Score Normalizer: threshold_gate zeroes score if fairness drops below threshold', () => {
  // Fairness 75 >= 70 -> 90
  const pass = calculateNormalizedScore({ rule: 'threshold_gate', rawScore: 90, fairnessScore: 75, passThreshold: 70 });
  assert.equal(pass, 90);

  // Fairness 68 < 70 -> 0
  const fail = calculateNormalizedScore({ rule: 'threshold_gate', rawScore: 90, fairnessScore: 68, passThreshold: 70 });
  assert.equal(fail, 0);
});

test('Score Normalizer: determineSessionStatus labels passed, flagged, failed correctly', () => {
  assert.equal(determineSessionStatus(95, 70), 'passed');
  assert.equal(determineSessionStatus(70, 70), 'passed');
  assert.equal(determineSessionStatus(65, 70), 'flagged');
  assert.equal(determineSessionStatus(50, 70), 'failed');
});

test('API: POST /api/codes supports platformType, maxScore, and normalizationRule', async () => {
  const payload = {
    url: 'https://docs.google.com/forms/d/e/1FAIpQLSc-sample/viewform',
    platformType: 'google-forms',
    maxScore: 50,
    normalizationRule: 'weighted_80_20',
  };

  const res = await fetch(`${baseUrl}/api/codes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  assert.equal(res.status, 201);
  const json = await res.json();
  assert.equal(json.platformType, 'google-forms');
  assert.equal(json.maxScore, 50);
  assert.equal(json.normalizationRule, 'weighted_80_20');

  // Verify GET /api/codes/:code returns them
  const getRes = await fetch(`${baseUrl}/api/codes/${json.code}`);
  assert.equal(getRes.status, 200);
  const getJson = await getRes.json();
  assert.equal(getJson.platformType, 'google-forms');
  assert.equal(getJson.maxScore, 50);
  assert.equal(getJson.normalizationRule, 'weighted_80_20');
});

test('API: POST /api/sessions submits a student session report and calculates normalized score', async () => {
  // Create test code with multiplier rule
  const codeRes = await fetch(`${baseUrl}/api/codes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: 'https://docs.google.com/forms/d/e/123/viewform',
      normalizationRule: 'multiplier',
      maxScore: 100,
    }),
  });
  const { code } = await codeRes.json();

  const sessionPayload = {
    code,
    studentName: 'Aarav Sharma',
    studentId: 'ENR-2026-99',
    studentEmail: 'aarav@university.edu',
    rawScore: 92,
    fairnessScore: 95,
    durationSeconds: 1800,
    violationsCount: 2,
    violationsSummary: [
      { type: 'focus', count: 1, deduction: 5 },
      { type: 'gaze', count: 1, deduction: 0 },
    ],
  };

  const res = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sessionPayload),
  });

  assert.equal(res.status, 201);
  const session = await res.json();
  assert.ok(session.id);
  assert.equal(session.code, code);
  assert.equal(session.studentName, 'Aarav Sharma');
  assert.equal(session.rawScore, 92);
  assert.equal(session.fairnessScore, 95);
  // Normalized score: 92 * 0.95 = 87.4
  assert.equal(session.normalizedScore, 87.4);
  assert.equal(session.status, 'passed');

  // Verify list in GET /api/sessions
  const listRes = await fetch(`${baseUrl}/api/sessions?code=${code}`);
  assert.equal(listRes.status, 200);
  const list = await listRes.json();
  assert.equal(list.length, 1);
  assert.equal(list[0].studentName, 'Aarav Sharma');
  assert.equal(list[0].normalizedScore, 87.4);

  // Verify GET /api/sessions/:id
  const detailRes = await fetch(`${baseUrl}/api/sessions/${session.id}`);
  assert.equal(detailRes.status, 200);
  const detail = await detailRes.json();
  assert.equal(detail.studentId, 'ENR-2026-99');

  // Test PATCH /api/sessions/:id/raw-score updates raw and recalculates normalized
  const patchRes = await fetch(`${baseUrl}/api/sessions/${session.id}/raw-score`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rawScore: 100 }),
  });
  assert.equal(patchRes.status, 200);
  const patchJson = await patchRes.json();
  assert.equal(patchJson.rawScore, 100);
  // Normalized score: 100 * 0.95 = 95
  assert.equal(patchJson.normalizedScore, 95);

  // Test GET /api/reports/summary
  const summaryRes = await fetch(`${baseUrl}/api/reports/summary?code=${code}`);
  assert.equal(summaryRes.status, 200);
  const summary = await summaryRes.json();
  assert.equal(summary.totalSessions, 1);
  assert.equal(summary.passedSessions, 1);
  assert.equal(summary.avgFairnessScore, 95);
});
