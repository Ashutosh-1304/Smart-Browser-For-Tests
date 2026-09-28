import express from 'express';
import { defaultIntegrityServer } from '../integrityServer.js';
import { defaultVeyonBridge } from '../veyonBridge.js';

export const integrityRouter = express.Router();

/**
 * GET /api/integrity/status
 * Returns system integrity and Veyon bridge health status.
 */
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

/**
 * GET /api/integrity/students
 * Lists all registered students with their current live telemetry and fairness scores.
 */
integrityRouter.get('/students', (req, res) => {
  const students = Array.from(defaultIntegrityServer.students.values());
  return res.json({
    count: students.length,
    students,
  });
});

/**
 * GET /api/integrity/students/:id
 * Retrieve full details for a single student.
 */
integrityRouter.get('/students/:id', (req, res) => {
  const student = defaultIntegrityServer.students.get(req.params.id);
  if (!student) {
    return res.status(404).json({ error: `Student with ID '${req.params.id}' not found.` });
  }
  return res.json(student);
});

/**
 * POST /api/integrity/students/:id/action
 * Triggers a manual invigilator action (lock, unlock, message, screenshot).
 */
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

/**
 * PATCH /api/integrity/students/:id/mapping
 * Update identity-to-Veyon-computer mapping (hostname / IP).
 */
integrityRouter.patch('/students/:id/mapping', (req, res) => {
  const { id } = req.params;
  const { hostname, ip } = req.body || {};

  const updated = defaultIntegrityServer.updateStudentMapping(id, { hostname, ip });
  if (!updated) {
    return res.status(404).json({ error: `Student with ID '${id}' not found.` });
  }

  return res.json({ success: true, student: updated });
});

/**
 * DELETE /api/integrity/students/:id
 * Remove a student session.
 */
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

/**
 * GET /api/integrity/rules
 * Fetch active auto-rules configuration.
 */
integrityRouter.get('/rules', (req, res) => {
  return res.json(defaultVeyonBridge.rules);
});

/**
 * PUT /api/integrity/rules
 * Update auto-rules configuration (thresholds, cooldown, enabled switch).
 */
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

/**
 * GET /api/integrity/actions
 * View the Veyon bridge action logs / audit trail.
 */
integrityRouter.get('/actions', (req, res) => {
  return res.json({
    count: defaultVeyonBridge.actionLogs.length,
    actions: defaultVeyonBridge.actionLogs,
  });
});

/**
 * POST /api/integrity/simulate
 * Spawns a simulated student session for instant testing.
 */
integrityRouter.post('/simulate', (req, res) => {
  const student = defaultIntegrityServer.simulateStudent(req.body);
  return res.status(201).json({ success: true, student });
});

/**
 * POST /api/integrity/clear
 * Resets all student sessions and actions for clean testing.
 */
integrityRouter.post('/clear', (req, res) => {
  defaultIntegrityServer.clear();
  return res.json({ success: true, message: 'All student sessions reset.' });
});
