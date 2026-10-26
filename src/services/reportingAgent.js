export class ReportingAgent {
  constructor(options = {}) {
    this.serverUrl = options.serverUrl || this.resolveDefaultWsUrl();
    this.ws = null;
    this.studentInfo = null;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.isConnected = false;
    this.isManualClosed = false;

    this.callbacks = {
      onStatusChange: options.onStatusChange || (() => {}),
      onLock: options.onLock || (() => {}),
      onUnlock: options.onUnlock || (() => {}),
      onMessage: options.onMessage || (() => {}),
    };
  }

  resolveDefaultWsUrl() {
    const host = window.location.hostname || 'localhost';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const port = window.location.port === '5173' ? '3001' : (window.location.port || '3001');
    return `${protocol}//${host}:${port}/ws/candidate`;
  }

  async start(studentInfo = {}) {
    this.isManualClosed = false;
    
    let sysInfo = { hostname: 'client-pc', username: 'Candidate', platform: 'web', ip: '127.0.0.1' };
    if (window.electronAPI && typeof window.electronAPI.getSystemInfo === 'function') {
      try {
        const electronSys = await window.electronAPI.getSystemInfo();
        if (electronSys) sysInfo = electronSys;
      } catch (e) {
        console.warn('Failed to retrieve system info from electron:', e);
      }
    }

    this.studentInfo = {
      studentId: studentInfo.studentId || `STU-${Math.floor(100 + Math.random() * 900)}`,
      studentName: studentInfo.studentName || sysInfo.username || 'Candidate',
      testCode: studentInfo.testCode || 'GENERAL',
      url: studentInfo.url || 'https://google.com',
      hostname: studentInfo.hostname || sysInfo.hostname,
      ip: studentInfo.ip || sysInfo.ip,
      platform: sysInfo.platform,
    };

    this.connect();
  }

  connect() {
    if (this.isManualClosed) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.callbacks.onStatusChange('connecting');

    try {
      this.ws = new WebSocket(this.serverUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.callbacks.onStatusChange('connected');

        this.send('candidate:register', this.studentInfo);

        this.startHeartbeat();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleIncoming(data);
        } catch (err) {
          console.error('[ReportingAgent] Parse error:', err);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.stopHeartbeat();
        this.callbacks.onStatusChange('disconnected');

        if (!this.isManualClosed) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (err) => {
        console.warn('[ReportingAgent] WS connection error, reconnecting soon...');
      };
    } catch (err) {
      console.error('[ReportingAgent] Connection error:', err);
      this.scheduleReconnect();
    }
  }

  handleIncoming(msg) {
    if (!msg) return;

    switch (msg.type) {
      case 'lock':
        this.callbacks.onLock(msg.message || 'Assessment has been locked by the invigilator.');
        break;

      case 'unlock':
        this.callbacks.onUnlock();
        break;

      case 'message':
        this.callbacks.onMessage(msg.message || 'Attention: Follow test instructions.');
        break;

      default:
        break;
    }
  }

  send(type, payload = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify({ type, payload }));
      return true;
    } catch {
      return false;
    }
  }

  sendTelemetry(data) {
    if (!this.studentInfo) return;
    this.send('candidate:telemetry', {
      studentId: this.studentInfo.studentId,
      ...data,
    });
  }

  sendViolation(violation) {
    if (!this.studentInfo) return;
    this.send('candidate:violation', {
      studentId: this.studentInfo.studentId,
      ...violation,
    });
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.studentInfo && this.isConnected) {
        this.send('candidate:heartbeat', { studentId: this.studentInfo.studentId });
      }
    }, 3000);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }

  stop() {
    this.isManualClosed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.callbacks.onStatusChange('disconnected');
  }
}

export const reportingAgent = new ReportingAgent();
