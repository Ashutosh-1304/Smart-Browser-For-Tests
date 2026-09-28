import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { WebSocket } from 'ws';
import { app } from '../app.js';
import { initDb, db } from '../db.js';
import { VeyonBridge } from '../veyonBridge.js';
import { IntegrityServer } from '../integrityServer.js';

test('Issue #26: VeyonBridge - Actions & Simulated Execution', async () => {
  const bridge = new VeyonBridge({ mockMode: true });

  const status = bridge.getStatus();
  assert.equal(status.mockMode, true);
  assert.equal(status.rules.autoLockThreshold, 50);

  // Lock
  const lockRes = await bridge.lockScreen('lab-pc-01', 'Locked for testing', {
    studentId: 'STU-001',
    studentName: 'Alice',
  });
  assert.equal(lockRes.success, true);
  assert.equal(lockRes.simulated, true);
  assert.ok(lockRes.command.includes('feature lock'));

  // Unlock
  const unlockRes = await bridge.unlockScreen('lab-pc-01', { studentId: 'STU-001' });
  assert.equal(unlockRes.success, true);
  assert.ok(unlockRes.command.includes('feature unlock'));

  // Message
  const msgRes = await bridge.sendMessage('lab-pc-01', 'Please focus', { studentId: 'STU-001' });
  assert.equal(msgRes.success, true);
  assert.ok(msgRes.command.includes('feature textmessage'));

  // Screenshot
  const shotRes = await bridge.captureScreenshot('lab-pc-01', {
    studentId: 'STU-001',
    studentName: 'Alice',
    fairnessScore: 85,
  });
  assert.equal(shotRes.success, true);
  assert.ok(shotRes.screenshotUrl.startsWith('data:image/svg+xml'));

  // Audit log count
  assert.equal(bridge.actionLogs.length, 4);
});

test('Issue #26: VeyonBridge - Auto-Rule Evaluation', async () => {
  const bridge = new VeyonBridge({
    mockMode: true,
    autoRulesEnabled: true,
    autoLockThreshold: 50,
    autoWarnThreshold: 70,
    cooldownSeconds: 0, // 0s for immediate testing
  });

  let lockCalled = false;
  let warnCalled = false;

  const callbacks = {
    onLock: () => { lockCalled = true; },
    onMessage: () => { warnCalled = true; },
  };

  // Student in good standing
  const sGood = { studentId: 'S1', hostname: 'host-1', fairnessScore: 90 };
  const resGood = await bridge.evaluateAutoRules(sGood, callbacks);
  assert.equal(resGood, null);
  assert.equal(lockCalled, false);
  assert.equal(warnCalled, false);

  // Student in warning threshold (score = 65)
  const sWarn = { studentId: 'S2', hostname: 'host-2', fairnessScore: 65 };
  const resWarn = await bridge.evaluateAutoRules(sWarn, callbacks);
  assert.ok(resWarn);
  assert.equal(resWarn[0].action, 'message');
  assert.equal(warnCalled, true);

  // Student in critical threshold (score = 40)
  const sCrit = { studentId: 'S3', hostname: 'host-3', fairnessScore: 40 };
  const resCrit = await bridge.evaluateAutoRules(sCrit, callbacks);
  assert.ok(resCrit);
  assert.equal(resCrit[0].action, 'lock');
  assert.equal(lockCalled, true);
});

test('Issue #26: IntegrityServer - State Management & Action Triggering', async () => {
  const bridge = new VeyonBridge({ mockMode: true });
  const server = new IntegrityServer({ veyonBridge: bridge });

  const student = server.registerStudent({
    studentId: 'STU-100',
    studentName: 'Bob',
    hostname: 'lab-pc-10',
    testCode: 'TEST-100',
  });

  assert.equal(student.studentId, 'STU-100');
  assert.equal(student.status, 'online');
  assert.equal(student.fairnessScore, 100);

  // Update telemetry
  await server.updateTelemetry('STU-100', { fairnessScore: 88, faceDetected: 1 });
  assert.equal(server.students.get('STU-100').fairnessScore, 88);

  // Record violation
  await server.recordViolation('STU-100', {
    type: 'focus',
    message: 'Window blur',
    fairnessScore: 78,
  });
  const updatedStudent = server.students.get('STU-100');
  assert.equal(updatedStudent.violations.length, 1);
  assert.equal(updatedStudent.fairnessScore, 78);

  // Trigger manual lock
  const lockAct = await server.triggerAction('STU-100', 'lock', { message: 'Manual Lock' });
  assert.equal(lockAct.success, true);
  assert.equal(updatedStudent.status, 'locked');

  // Trigger manual unlock
  const unlockAct = await server.triggerAction('STU-100', 'unlock');
  assert.equal(unlockAct.success, true);
  assert.equal(updatedStudent.status, 'online');

  // Update mapping
  const mapped = server.updateStudentMapping('STU-100', { hostname: 'lab-pc-99' });
  assert.equal(mapped.hostname, 'lab-pc-99');

  server.destroy();
});

test('Issue #26: Integrity REST API & WebSocket Streaming Integration', async (t) => {
  await initDb();

  // Create isolated test server
  const testBridge = new VeyonBridge({ mockMode: true });
  const testIntegrity = new IntegrityServer({ veyonBridge: testBridge });
  
  const httpServer = http.createServer(app);
  testIntegrity.attachToServer(httpServer);

  await new Promise((resolve) => httpServer.listen(0, resolve));
  const port = httpServer.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}`;

  t.after(async () => {
    testIntegrity.destroy();
    httpServer.close();
    await db.destroy();
  });

  // 1. GET /api/integrity/status
  const statusRes = await fetch(`${baseUrl}/api/integrity/status`);
  assert.equal(statusRes.status, 200);
  const statusData = await statusRes.json();
  assert.equal(statusData.status, 'ok');
  assert.ok(statusData.bridge);

  // 2. POST /api/integrity/simulate
  const simRes = await fetch(`${baseUrl}/api/integrity/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentName: 'Test Student', fairnessScore: 82 }),
  });
  assert.equal(simRes.status, 201);
  const simData = await simRes.json();
  const studentId = simData.student.studentId;
  assert.ok(studentId);

  // 3. GET /api/integrity/students/:id
  const getStudentRes = await fetch(`${baseUrl}/api/integrity/students/${encodeURIComponent(studentId)}`);
  assert.equal(getStudentRes.status, 200);
  const studentDetails = await getStudentRes.json();
  assert.equal(studentDetails.studentName, 'Test Student');
  assert.equal(studentDetails.fairnessScore, 82);

  // 4. POST /api/integrity/students/:id/action (Lock)
  const actRes = await fetch(`${baseUrl}/api/integrity/students/${encodeURIComponent(studentId)}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'lock', message: 'Locked via API test' }),
  });
  assert.equal(actRes.status, 200);
  const actData = await actRes.json();
  assert.equal(actData.success, true);

  // Verify status updated to locked
  const lockedDetailsRes = await fetch(`${baseUrl}/api/integrity/students/${encodeURIComponent(studentId)}`);
  const lockedDetails = await lockedDetailsRes.json();
  assert.equal(lockedDetails.status, 'locked');

  // 5. PATCH /api/integrity/students/:id/mapping
  const mapRes = await fetch(`${baseUrl}/api/integrity/students/${encodeURIComponent(studentId)}/mapping`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostname: 'new-lab-pc-42' }),
  });
  assert.equal(mapRes.status, 200);
  const mapData = await mapRes.json();
  assert.equal(mapData.student.hostname, 'new-lab-pc-42');

  // 6. PUT /api/integrity/rules
  const rulesRes = await fetch(`${baseUrl}/api/integrity/rules`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ autoLockThreshold: 45, cooldownSeconds: 20 }),
  });
  assert.equal(rulesRes.status, 200);
  const rulesData = await rulesRes.json();
  assert.equal(rulesData.rules.autoLockThreshold, 45);
  assert.equal(rulesData.rules.cooldownSeconds, 20);

  // 7. GET /api/integrity/actions
  const actionsRes = await fetch(`${baseUrl}/api/integrity/actions`);
  assert.equal(actionsRes.status, 200);
  const actionsData = await actionsRes.json();
  assert.ok(actionsData.count >= 1);

  // 8. Test Candidate WebSocket live connection and telemetry
  const wsCandidate = new WebSocket(`${wsUrl}/ws/candidate`);
  await new Promise((resolve) => wsCandidate.on('open', resolve));

  // Register candidate
  wsCandidate.send(JSON.stringify({
    type: 'candidate:register',
    payload: {
      studentId: 'WS-CANDIDATE-01',
      studentName: 'WS Candidate',
      hostname: 'ws-pc-01',
      testCode: 'TEST-WS',
      url: 'https://google.com',
    },
  }));

  // Wait for registration confirmation
  const regMsg = await new Promise((resolve) => {
    wsCandidate.on('message', (data) => {
      const parsed = JSON.parse(data.toString());
      if (parsed.type === 'registered') resolve(parsed);
    });
  });
  assert.equal(regMsg.payload.studentId, 'WS-CANDIDATE-01');

  // Send candidate telemetry over WS
  wsCandidate.send(JSON.stringify({
    type: 'candidate:telemetry',
    payload: {
      studentId: 'WS-CANDIDATE-01',
      fairnessScore: 91,
      faceDetected: 1,
    },
  }));

  // Allow server loop to process
  await new Promise((resolve) => setTimeout(resolve, 100));

  const wsStudent = testIntegrity.students.get('WS-CANDIDATE-01');
  assert.ok(wsStudent);
  assert.equal(wsStudent.fairnessScore, 91);

  wsCandidate.close();
});
