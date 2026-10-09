// ---------------------------------------------------------------------------
// Proctor client (renderer side) — connects the Electron app to the local
// proctor hub (server/proctor/bridge.js) as role "app".
//
// Responsibilities:
//   • Open a resilient WebSocket to ws://localhost:3001/proctor (auto-reconnect).
//   • Send the exam lifecycle (hello / session started|ended), each violation,
//     and periodic fairness-score snapshots.
//   • Receive commands from the control agent (Veyon plugin) and hand them to
//     a caller-supplied handler (lock / warn / end / ...).
//
// This file is framework-agnostic plain JS; the React glue lives in the
// useProctorBridge hook. The message shapes mirror server/proctor/bridge.js.
// ---------------------------------------------------------------------------
import { DEFAULT_VIOLATION_CONFIG, PRIORITY_VALUES } from '../engine/FairnessScoreEngine.js';

const DEFAULT_URL = 'ws://localhost:3001/proctor';

// Map a violation type to a coarse severity the agent can act on without
// knowing the scoring internals. Derived from the engine's priority tiers so
// it stays in sync when new types are added there.
export function severityFor(type) {
  const tier = DEFAULT_VIOLATION_CONFIG[type]?.priority;
  const weight = PRIORITY_VALUES[tier] ?? 1;
  if (weight >= PRIORITY_VALUES.HIGH) return 'high';
  if (weight >= PRIORITY_VALUES.MEDIUM_HIGH) return 'medium';
  return 'low';
}

export function labelFor(type) {
  return DEFAULT_VIOLATION_CONFIG[type]?.label || type;
}

export class ProctorClient {
  /**
   * @param {Object} [opts]
   * @param {string} [opts.url]              – hub URL
   * @param {(cmd) => void} [opts.onCommand] – called with {action, message, at}
   * @param {(info) => void} [opts.onStatus] – called with {connected, peers?}
   */
  constructor(opts = {}) {
    this._url = opts.url || DEFAULT_URL;
    this._onCommand = opts.onCommand || (() => {});
    this._onStatus = opts.onStatus || (() => {});

    this._ws = null;
    this._connected = false;
    this._closedByUser = false;
    this._reconnectDelay = 1000; // backs off to 10s
    this._reconnectTimer = null;

    // Identity + the latest session, replayed on every (re)connect so the hub
    // and a late-joining agent always know who this app is.
    this._identity = null; // { studentId, sessionId, name, code }
    this._session = null; // { state, code, url, at }

    // Messages queued while the socket is down.
    this._queue = [];
  }

  connect() {
    this._closedByUser = false;
    this._open();
  }

  _open() {
    let ws;
    try {
      ws = new WebSocket(this._url);
    } catch (err) {
      this._scheduleReconnect();
      return;
    }
    this._ws = ws;

    ws.onopen = () => {
      this._connected = true;
      this._reconnectDelay = 1000;
      // Re-announce identity and replay the current session so a reconnect is
      // transparent to the agent.
      if (this._identity) this._raw({ type: 'hello', role: 'app', ...this._identity });
      if (this._session) this._raw({ type: 'session', ...this._session, studentId: this._identity?.studentId });
      // Flush anything queued while offline.
      const pending = this._queue.splice(0);
      for (const m of pending) this._raw(m);
      this._onStatus({ connected: true });
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === 'command') {
        this._onCommand({ action: msg.action, message: msg.message ?? null, at: msg.at });
      } else if (msg.type === 'welcome' || msg.type === 'peers') {
        this._onStatus({ connected: true, peers: msg.peers ?? { app: msg.app, agent: msg.agent } });
      }
    };

    ws.onclose = () => {
      this._connected = false;
      this._onStatus({ connected: false });
      if (!this._closedByUser) this._scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose will follow and handle reconnect.
      try { ws.close(); } catch { /* noop */ }
    };
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    const delay = this._reconnectDelay;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._reconnectDelay = Math.min(this._reconnectDelay * 2, 10000);
      this._open();
    }, delay);
  }

  _raw(obj) {
    if (this._ws && this._connected) {
      this._ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  // Send now, or queue until the socket is back.
  _send(obj) {
    if (!this._raw(obj)) this._queue.push(obj);
  }

  // ── Public API used by the React layer ─────────────────────────────────────

  /** Announce who this student is. Call once at exam start. */
  identify({ studentId, sessionId, name, code }) {
    this._identity = { studentId, sessionId, name: name ?? null, code: code ?? null };
    this._send({ type: 'hello', role: 'app', ...this._identity });
  }

  startSession({ code, url }) {
    this._session = { state: 'started', code: code ?? null, url: url ?? null, at: Date.now() };
    this._send({ type: 'session', ...this._session, studentId: this._identity?.studentId });
  }

  endSession() {
    this._session = { state: 'ended', code: this._session?.code ?? null, url: null, at: Date.now() };
    this._send({ type: 'session', ...this._session, studentId: this._identity?.studentId });
  }

  sendViolation(type, message) {
    this._send({
      type: 'violation',
      studentId: this._identity?.studentId ?? null,
      violation: {
        kind: type,
        label: labelFor(type),
        message: message ?? labelFor(type),
        severity: severityFor(type),
        at: Date.now(),
      },
    });
  }

  sendScore(total, breakdown) {
    this._send({
      type: 'score',
      studentId: this._identity?.studentId ?? null,
      total,
      breakdown: breakdown ?? [],
      at: Date.now(),
    });
  }

  close() {
    this._closedByUser = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._ws) {
      try { this._ws.close(); } catch { /* noop */ }
    }
  }
}
