import express from 'express';
import { defaultIntegrityServer } from '../integrityServer.js';
import { defaultVeyonBridge } from '../veyonBridge.js';

export const integrityRouter = express.Router();

integrityRouter.get('/status', (req, res) => {
  const bridgeStatus = defaultVeyonBridge.getStatus();
  const students = Array.from(defaultIntegrityServer.students.values());
  const activeCount = students.filter(s => s.status === 'online').length;
  const lockedCount = students.filter(s => s.status === 'locked').length;
  const flaggedCount = students.filter(s => s.fairnessScore < 70).length;

  return res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    bridge: bridgeStatus,
    stats: {
      totalStudents: students.length,
      activeStudents: activeCount,
      lockedStudents: lockedCount,
      flaggedStudents: flaggedCount,
      dashboardsConnected: defaultIntegrityServer.dashboardSockets.size,
    },
  });
});

integrityRouter.get('/students', (req, res) => {
  const students = Array.from(defaultIntegrityServer.students.values());
  return res.json({
    count: students.length,
    students,
  });
});

integrityRouter.get('/students/:id', (req, res) => {
  const student = defaultIntegrityServer.students.get(req.params.id);
  if (!student) {
    return res.status(404).json({ error: `Student with ID '${req.params.id}' not found.` });
  }
  return res.json(student);
});

integrityRouter.post('/students/:id/action', async (req, res) => {
  const { id } = req.params;
  const { action, message, host } = req.body || {};

  if (!action || !['lock', 'unlock', 'message', 'screenshot'].includes(action)) {
    return res.status(400).json({ error: "Invalid action. Allowed actions: 'lock', 'unlock', 'message', 'screenshot'." });
  }

  const result = await defaultIntegrityServer.triggerAction(id, action, { message, host });
  if (!result.success) {
    return res.status(result.error && result.error.includes('not found') ? 404 : 500).json(result);
  }

  return res.json(result);
});

integrityRouter.patch('/students/:id/mapping', (req, res) => {
  const { id } = req.params;
  const { hostname, ip } = req.body || {};

  const updated = defaultIntegrityServer.updateStudentMapping(id, { hostname, ip });
  if (!updated) {
    return res.status(404).json({ error: `Student with ID '${id}' not found.` });
  }

  return res.json({ success: true, student: updated });
});

integrityRouter.delete('/students/:id', (req, res) => {
  const { id } = req.params;
  const exists = defaultIntegrityServer.students.has(id);
  if (!exists) {
    return res.status(404).json({ error: `Student with ID '${id}' not found.` });
  }

  defaultIntegrityServer.students.delete(id);
  defaultIntegrityServer.candidateSockets.delete(id);
  defaultIntegrityServer.broadcastToDashboards('student:removed', { studentId: id });

  return res.json({ success: true, message: `Student '${id}' removed.` });
});

integrityRouter.get('/rules', (req, res) => {
  return res.json(defaultVeyonBridge.rules);
});

integrityRouter.put('/rules', (req, res) => {
  const { enabled, autoLockThreshold, autoWarnThreshold, cooldownSeconds, autoScreenshotOnCritical } = req.body || {};
  const updated = defaultVeyonBridge.updateRules({
    ...(enabled !== undefined && { enabled: !!enabled }),
    ...(autoLockThreshold !== undefined && { autoLockThreshold: Number(autoLockThreshold) }),
    ...(autoWarnThreshold !== undefined && { autoWarnThreshold: Number(autoWarnThreshold) }),
    ...(cooldownSeconds !== undefined && { cooldownSeconds: Number(cooldownSeconds) }),
    ...(autoScreenshotOnCritical !== undefined && { autoScreenshotOnCritical: !!autoScreenshotOnCritical }),
  });

  defaultIntegrityServer.broadcastToDashboards('rules:updated', updated);
  return res.json({ success: true, rules: updated });
});

integrityRouter.get('/actions', (req, res) => {
  return res.json({
    count: defaultVeyonBridge.actionLogs.length,
    actions: defaultVeyonBridge.actionLogs,
  });
});

integrityRouter.post('/simulate', (req, res) => {
  const student = defaultIntegrityServer.simulateStudent(req.body);
  return res.status(201).json({ success: true, student });
});

integrityRouter.post('/clear', (req, res) => {
  defaultIntegrityServer.clear();
  return res.json({ success: true, message: 'All student sessions reset.' });
});
