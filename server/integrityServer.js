import { WebSocketServer, WebSocket } from 'ws';
import { defaultVeyonBridge } from './veyonBridge.js';

/**
 * Central Integrity Server (Approach A)
 * 
 * Central coordinator matching our Node.js stack:
 * 1. Receives real-time fairness scores, telemetry, and violation streams from student apps.
 * 2. Fans out live updates over WebSocket to all active invigilator dashboard instances.
 * 3. Bridges invigilator commands and automated rules to VeyonBridge (veyon-cli / simulated actions).
 */
export class IntegrityServer {
  constructor(options = {}) {
    this.veyonBridge = options.veyonBridge || defaultVeyonBridge;
    this.students = new Map(); // studentId -> StudentRecord
    this.candidateSockets = new Map(); // studentId -> WebSocket
    this.dashboardSockets = new Set(); // Set<WebSocket>
    this.wss = null;
    this.heartbeatTimer = null;
  }

  /**
   * Attach WebSocket server to existing HTTP/HTTPS server instance.
   */
  attachToServer(httpServer) {
    this.wss = new WebSocketServer({ noServer: true });

    httpServer.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      const pathname = url.pathname;

      if (pathname === '/ws/integrity' || pathname === '/ws/candidate' || pathname === '/ws/dashboard') {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit('connection', ws, request);
        });
      }
    });

    this.wss.on('connection', (ws, request) => {
      this.handleConnection(ws, request);
    });

    // Start background liveness monitor (every 4 seconds)
    this.heartbeatTimer = setInterval(() => {
      this.checkStudentHeartbeats();
    }, 4000);
    if (this.heartbeatTimer?.unref) this.heartbeatTimer.unref();

    return this;
  }

  /**
   * Handle incoming WebSocket connection.
   */
  handleConnection(ws, request) {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const roleParam = url.searchParams.get('role');
    const path = url.pathname;
    
    let isDashboard = roleParam === 'dashboard' || path === '/ws/dashboard';
    let currentStudentId = null;

    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    if (isDashboard) {
      this.dashboardSockets.add(ws);
      // Immediately send current system snapshot to newly connected dashboard
      ws.send(JSON.stringify({
        type: 'snapshot',
        payload: {
          students: Array.from(this.students.values()),
          bridgeStatus: this.veyonBridge.getStatus(),
          actions: this.veyonBridge.actionLogs.slice(0, 50),
        },
      }));
    }

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        await this.handleMessage(msg, ws, (studentId) => {
          currentStudentId = studentId;
        });
      } catch (err) {
        console.error('[IntegrityServer] Failed to handle message:', err);
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
      }
    });

    ws.on('close', () => {
      if (isDashboard) {
        this.dashboardSockets.delete(ws);
      } else if (currentStudentId) {
        const student = this.students.get(currentStudentId);
        if (student) {
          student.status = 'offline';
          student.lastSeen = Date.now();
          this.candidateSockets.delete(currentStudentId);
          this.broadcastToDashboards('student:updated', student);
        }
      }
    });

    ws.on('error', (err) => {
      console.error('[IntegrityServer WS Error]:', err);
    });
  }

  /**
   * Process parsed WebSocket messages.
   */
  async handleMessage(msg, ws, setStudentId) {
    const { type, payload } = msg;

    switch (type) {
      // 1. Invigilator Dashboard Subscription
      case 'dashboard:subscribe': {
        this.dashboardSockets.add(ws);
        ws.send(JSON.stringify({
          type: 'snapshot',
          payload: {
            students: Array.from(this.students.values()),
            bridgeStatus: this.veyonBridge.getStatus(),
            actions: this.veyonBridge.actionLogs.slice(0, 50),
          },
        }));
        break;
      }

      // 2. Candidate Registration
      case 'candidate:register': {
        const student = this.registerStudent(payload, ws);
        setStudentId(student.studentId);
        ws.send(JSON.stringify({
          type: 'registered',
          payload: { studentId: student.studentId, status: 'ok' },
        }));
        break;
      }

      // 3. Live Telemetry Update from Candidate App
      case 'candidate:telemetry': {
        const updated = await this.updateTelemetry(payload.studentId, payload);
        if (updated) setStudentId(payload.studentId);
        break;
      }

      // 4. Violation Recorded by Candidate App
      case 'candidate:violation': {
        const updated = await this.recordViolation(payload.studentId, payload);
        if (updated) setStudentId(payload.studentId);
        break;
      }

      // 5. Heartbeat Ping from Candidate App
      case 'candidate:heartbeat': {
        const student = this.students.get(payload.studentId);
        if (student) {
          student.lastSeen = Date.now();
          if (student.status === 'offline') {
            student.status = 'online';
            this.broadcastToDashboards('student:updated', student);
          }
        }
        break;
      }

      // 6. Invigilator Manual Action (Lock, Unlock, Message, Screenshot)
      case 'invigilator:action': {
        const result = await this.triggerAction(payload.studentId, payload.action, payload.options);
        ws.send(JSON.stringify({
          type: 'action:result',
          payload: result,
        }));
        break;
      }

      // 7. Update Student Machine Mapping (Hostname / IP)
      case 'invigilator:update_mapping': {
        const updated = this.updateStudentMapping(payload.studentId, payload.mapping);
        ws.send(JSON.stringify({
          type: 'mapping:updated',
          payload: updated,
        }));
        break;
      }

      // 8. Update Auto-Rules Config
      case 'invigilator:update_rules': {
        const newRules = this.veyonBridge.updateRules(payload);
        this.broadcastToDashboards('rules:updated', newRules);
        break;
      }

      default:
        console.warn(`[IntegrityServer] Unknown message type: ${type}`);
    }
  }

  /**
   * Register or restore a student session.
   */
  registerStudent(data = {}, socket = null) {
    const studentId = data.studentId || `STU-${Math.floor(100 + Math.random() * 900)}`;
    const studentName = data.studentName || `Student ${studentId.split('-')[1] || studentId}`;
    const hostname = data.hostname || 'lab-pc-01';
    const ip = data.ip || '127.0.0.1';

    const existing = this.students.get(studentId);
    const now = Date.now();

    const record = {
      studentId,
      studentName,
      testCode: data.testCode || 'TEST-01',
      url: data.url || 'https://google.com',
      hostname,
      ip,
      platform: data.platform || 'electron',
      status: 'online',
      fairnessScore: existing ? existing.fairnessScore : (data.fairnessScore ?? 100),
      fairnessBreakdown: existing ? existing.fairnessBreakdown : (data.fairnessBreakdown || {}),
      faceDetected: data.faceDetected ?? 1,
      gazeState: data.gazeState || { isLookingAway: false, direction: 'Center' },
      obstaclesCount: data.obstaclesCount || 0,
      focused: data.focused !== undefined ? data.focused : true,
      fullscreen: data.fullscreen !== undefined ? data.fullscreen : true,
      violations: existing ? existing.violations : [],
      latestViolation: null,
      registeredAt: existing ? existing.registeredAt : new Date().toISOString(),
      lastSeen: now,
      scoreHistory: existing ? existing.scoreHistory : [{ time: now, score: 100 }],
    };

    this.students.set(studentId, record);
    if (socket) {
      this.candidateSockets.set(studentId, socket);
    }

    this.broadcastToDashboards('student:joined', record);
    return record;
  }

  /**
   * Update student telemetry metrics and evaluate auto-rules.
   */
  async updateTelemetry(studentId, telemetry = {}) {
    const student = this.students.get(studentId);
    if (!student) return null;

    const now = Date.now();
    student.lastSeen = now;
    if (student.status === 'offline') student.status = 'online';

    if (telemetry.fairnessScore !== undefined) {
      student.fairnessScore = telemetry.fairnessScore;
      student.scoreHistory.push({ time: now, score: telemetry.fairnessScore });
      if (student.scoreHistory.length > 50) student.scoreHistory.shift();
    }
    if (telemetry.fairnessBreakdown) student.fairnessBreakdown = telemetry.fairnessBreakdown;
    if (telemetry.faceDetected !== undefined) student.faceDetected = telemetry.faceDetected;
    if (telemetry.gazeState) student.gazeState = telemetry.gazeState;
    if (telemetry.obstaclesCount !== undefined) student.obstaclesCount = telemetry.obstaclesCount;
    if (telemetry.focused !== undefined) student.focused = telemetry.focused;
    if (telemetry.fullscreen !== undefined) student.fullscreen = telemetry.fullscreen;

    // Evaluate Auto-Rules (Approach A)
    await this.evaluateRulesForStudent(student);

    this.broadcastToDashboards('student:telemetry', student);
    return student;
  }

  /**
   * Record a violation sent by candidate app and evaluate auto-rules.
   */
  async recordViolation(studentId, violationData = {}) {
    const student = this.students.get(studentId);
    if (!student) return null;

    const now = Date.now();
    student.lastSeen = now;
    if (student.status === 'offline') student.status = 'online';

    const violation = {
      id: violationData.id || `v_${now}_${Math.floor(Math.random() * 1000)}`,
      time: violationData.time || new Date().toLocaleTimeString(),
      timestamp: now,
      type: violationData.type || 'unknown',
      message: violationData.message || 'Integrity violation detected',
    };

    student.violations.unshift(violation);
    if (student.violations.length > 100) student.violations.pop();
    student.latestViolation = violation;

    if (violationData.fairnessScore !== undefined) {
      student.fairnessScore = violationData.fairnessScore;
      student.scoreHistory.push({ time: now, score: violationData.fairnessScore });
    }

    // Evaluate Auto-Rules on violation
    await this.evaluateRulesForStudent(student);

    this.broadcastToDashboards('student:violation', {
      studentId,
      student,
      violation,
    });

    return student;
  }

  /**
   * Evaluates auto-rules against a student using VeyonBridge.
   */
  async evaluateRulesForStudent(student) {
    const triggered = await this.veyonBridge.evaluateAutoRules(student, {
      onLock: (s, msg) => {
        s.status = 'locked';
        this.sendToCandidate(s.studentId, {
          type: 'lock',
          message: msg,
        });
      },
      onMessage: (s, msg) => {
        this.sendToCandidate(s.studentId, {
          type: 'message',
          message: msg,
        });
      },
      onScreenshot: (s, res) => {
        this.broadcastToDashboards('screenshot:captured', {
          studentId: s.studentId,
          screenshotUrl: res.screenshotUrl,
        });
      },
    });

    if (triggered) {
      this.broadcastToDashboards('autorules:triggered', {
        studentId: student.studentId,
        studentName: student.studentName,
        results: triggered,
      });
    }

    return triggered;
  }

  /**
   * Trigger an action (lock, unlock, message, screenshot) from invigilator or API.
   */
  async triggerAction(studentId, action, options = {}) {
    const student = this.students.get(studentId);
    if (!student) {
      return { success: false, error: `Student with ID ${studentId} not found` };
    }

    const host = options.host || student.hostname || student.ip || studentId;
    let result = null;

    switch (action) {
      case 'lock': {
        const msg = options.message || 'Assessment locked by invigilator';
        result = await this.veyonBridge.lockScreen(host, msg, {
          studentId,
          studentName: student.studentName,
          trigger: 'manual:invigilator',
        });
        student.status = 'locked';
        this.sendToCandidate(studentId, { type: 'lock', message: msg });
        break;
      }

      case 'unlock': {
        result = await this.veyonBridge.unlockScreen(host, {
          studentId,
          studentName: student.studentName,
          trigger: 'manual:invigilator',
        });
        student.status = 'online';
        this.sendToCandidate(studentId, { type: 'unlock' });
        break;
      }

      case 'message': {
        const msg = options.message || 'Please remain attentive and keep eyes on the screen.';
        result = await this.veyonBridge.sendMessage(host, msg, {
          studentId,
          studentName: student.studentName,
          trigger: 'manual:invigilator',
        });
        this.sendToCandidate(studentId, { type: 'message', message: msg });
        break;
      }

      case 'screenshot': {
        result = await this.veyonBridge.captureScreenshot(host, {
          studentId,
          studentName: student.studentName,
          fairnessScore: student.fairnessScore,
          trigger: 'manual:invigilator',
        });
        this.broadcastToDashboards('screenshot:captured', {
          studentId,
          screenshotUrl: result.screenshotUrl,
        });
        break;
      }

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }

    this.broadcastToDashboards('student:updated', student);
    this.broadcastToDashboards('action:logged', result.log);

    return {
      success: true,
      action,
      studentId,
      host,
      result,
    };
  }

  /**
   * Update student computer identity mapping (hostname / IP).
   */
  updateStudentMapping(studentId, mapping = {}) {
    const student = this.students.get(studentId);
    if (!student) return null;

    if (mapping.hostname) student.hostname = mapping.hostname.trim();
    if (mapping.ip) student.ip = mapping.ip.trim();

    this.broadcastToDashboards('student:updated', student);
    return student;
  }

  /**
   * Broadcast message to all connected invigilator dashboards.
   */
  broadcastToDashboards(type, payload) {
    const raw = JSON.stringify({ type, payload });
    for (const ws of this.dashboardSockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(raw);
      }
    }
  }

  /**
   * Send control packet to a specific candidate app.
   */
  sendToCandidate(studentId, data = {}) {
    const ws = this.candidateSockets.get(studentId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  /**
   * Check heartbeat timestamps and mark inactive students offline.
   */
  checkStudentHeartbeats() {
    const now = Date.now();
    for (const [studentId, student] of this.students.entries()) {
      if (student.status !== 'offline' && now - student.lastSeen > 12000) {
        student.status = 'offline';
        this.broadcastToDashboards('student:updated', student);
      }
    }
  }

  /**
   * Create or update a simulated student.
   * Super useful for testing without needing multiple physical PCs.
   */
  simulateStudent(custom = {}) {
    const idNum = Math.floor(10 + Math.random() * 90);
    const defaultData = {
      studentId: `SIM-${idNum}`,
      studentName: `Candidate ${idNum}`,
      hostname: `lab-pc-${idNum}`,
      ip: `192.168.1.${100 + idNum}`,
      testCode: 'TEST-SIM',
      url: 'https://docs.google.com/forms/example',
      fairnessScore: 92,
      faceDetected: 1,
      focused: true,
      fullscreen: true,
      ...custom,
    };

    const student = this.registerStudent(defaultData);
    return student;
  }

  /**
   * Reset / clear all students (for testing).
   */
  clear() {
    this.students.clear();
    this.candidateSockets.clear();
    this.broadcastToDashboards('snapshot', {
      students: [],
      bridgeStatus: this.veyonBridge.getStatus(),
      actions: [],
    });
  }

  /**
   * Stop background timers and close all sockets.
   */
  destroy() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const ws of this.candidateSockets.values()) {
      try { ws.terminate(); } catch {}
    }
    for (const ws of this.dashboardSockets) {
      try { ws.terminate(); } catch {}
    }
    this.candidateSockets.clear();
    this.dashboardSockets.clear();
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }
}

export const defaultIntegrityServer = new IntegrityServer();
