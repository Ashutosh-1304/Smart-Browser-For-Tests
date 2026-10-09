// ---------------------------------------------------------------------------
// Proctor Bridge — the local hub that connects the Electron proctoring app to
// an external control agent (e.g. a Veyon plugin) over WebSocket.
//
// Topology (one per student PC, all on localhost):
//
//    Electron app  ──┐                        ┌── Veyon plugin (agent)
//    (role: "app")   │   ws://localhost:PORT  │   (role: "agent")
//                    └──────► /proctor ◄───────┘
//                              (this hub)
//
// The hub does three things:
//   1. Relays "app → agent" messages (violations, score, session state).
//   2. Relays "agent → app" messages (commands: lock / warn / end ...).
//   3. Caches the latest session/score snapshot so a late-joining agent is
//      immediately brought up to date (Veyon Service may start before the app,
//      or the plugin may (re)connect mid-exam).
//
// Everything is role-tagged JSON. See MESSAGE CONTRACT below — the C++ Veyon
// plugin is written against exactly these shapes.
// ---------------------------------------------------------------------------
import { WebSocketServer } from 'ws';

// ── MESSAGE CONTRACT ────────────────────────────────────────────────────────
//
// Every message is a JSON object: { type, ...payload }. `type` is required.
//
// App → hub (relayed to every connected agent):
//   { type: 'hello',     role: 'app', studentId, sessionId, name?, code? }
//   { type: 'session',   state: 'started' | 'ended', studentId, code?, url?, at }
//   { type: 'violation', studentId, violation: { kind, label, message, severity, at } }
//   { type: 'score',     studentId, total, breakdown, at }
//
// Agent → hub (relayed to every connected app):
//   { type: 'hello',   role: 'agent', name? }
//   { type: 'command', action: 'lock'|'unlock'|'warn'|'end'|'acknowledge',
//                       message?, at }
//
// Hub → either side (generated locally, not relayed from the peer):
//   { type: 'welcome',  role: <echoed>, peers: { app: n, agent: n } }
//   { type: 'snapshot', session, score }   // sent to a freshly-connected agent
//   { type: 'peers',    app: n, agent: n } // peer-count changes
//
// Severity is 'high' | 'medium' | 'low' — derived from the fairness engine's
// deduction weight on the app side so the agent never needs the scoring config.
// ----------------------------------------------------------------------------

const VALID_ROLES = new Set(['app', 'agent']);
const VALID_COMMANDS = new Set(['lock', 'unlock', 'warn', 'end', 'acknowledge']);

/**
 * Attach the proctor WebSocket hub to an existing HTTP server.
 *
 * @param {import('http').Server} httpServer – the server returned by app.listen()
 * @param {{ path?: string, logger?: Console }} [opts]
 * @returns {{ close: () => Promise<void>, broadcast: Function, stats: Function }}
 */
export function attachProctorBridge(httpServer, opts = {}) {
  const path = opts.path || '/proctor';
  const log = opts.logger || console;

  const wss = new WebSocketServer({ server: httpServer, path });

  // role → Set<WebSocket>
  const clients = { app: new Set(), agent: new Set() };

  // Last-known state, replayed to late-joining agents.
  let lastSession = null; // { state, studentId, code, url, at }
  let lastScore = null; // { studentId, total, breakdown, at }

  const peerCounts = () => ({ app: clients.app.size, agent: clients.agent.size });

  const send = (ws, obj) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  };

  // Relay a message to everyone with the target role (optionally excluding sender).
  const relay = (role, obj, except) => {
    for (const ws of clients[role]) {
      if (ws !== except) send(ws, obj);
    }
  };

  const broadcastPeers = () => {
    const counts = peerCounts();
    relay('app', { type: 'peers', ...counts });
    relay('agent', { type: 'peers', ...counts });
  };

  wss.on('connection', (ws) => {
    // Role is unknown until the client sends its `hello`. Park it until then.
    ws._role = null;

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        send(ws, { type: 'error', error: 'invalid-json' });
        return;
      }
      if (!msg || typeof msg.type !== 'string') {
        send(ws, { type: 'error', error: 'missing-type' });
        return;
      }

      // ── Handshake ────────────────────────────────────────────────────────
      if (msg.type === 'hello') {
        const role = msg.role;
        if (!VALID_ROLES.has(role)) {
          send(ws, { type: 'error', error: 'invalid-role' });
          return;
        }
        ws._role = role;
        clients[role].add(ws);
        log.log(`[ProctorBridge] ${role} connected (${JSON.stringify(peerCounts())})`);

        send(ws, { type: 'welcome', role, peers: peerCounts() });

        // Bring a freshly-connected agent up to speed with the current exam state.
        if (role === 'agent') {
          send(ws, { type: 'snapshot', session: lastSession, score: lastScore });
        }
        broadcastPeers();
        return;
      }

      // Everything else requires a known role.
      if (!ws._role) {
        send(ws, { type: 'error', error: 'hello-required' });
        return;
      }

      // ── App → agents ───────────────────────────────────────────────────
      if (ws._role === 'app') {
        if (msg.type === 'session') {
          lastSession = {
            state: msg.state,
            studentId: msg.studentId ?? null,
            code: msg.code ?? null,
            url: msg.url ?? null,
            at: msg.at ?? Date.now(),
          };
          if (msg.state === 'ended') lastScore = null;
          relay('agent', { type: 'session', ...lastSession });
          return;
        }
        if (msg.type === 'violation') {
          relay('agent', {
            type: 'violation',
            studentId: msg.studentId ?? lastSession?.studentId ?? null,
            violation: msg.violation ?? null,
          });
          return;
        }
        if (msg.type === 'score') {
          lastScore = {
            studentId: msg.studentId ?? lastSession?.studentId ?? null,
            total: msg.total,
            breakdown: msg.breakdown ?? [],
            at: msg.at ?? Date.now(),
          };
          relay('agent', { type: 'score', ...lastScore });
          return;
        }
        send(ws, { type: 'error', error: `unknown-app-message:${msg.type}` });
        return;
      }

      // ── Agent → apps ─────────────────────────────────────────────────────
      if (ws._role === 'agent') {
        if (msg.type === 'command') {
          if (!VALID_COMMANDS.has(msg.action)) {
            send(ws, { type: 'error', error: `invalid-command:${msg.action}` });
            return;
          }
          relay('app', {
            type: 'command',
            action: msg.action,
            message: msg.message ?? null,
            at: msg.at ?? Date.now(),
          });
          return;
        }
        send(ws, { type: 'error', error: `unknown-agent-message:${msg.type}` });
        return;
      }
    });

    ws.on('close', () => {
      if (ws._role && clients[ws._role].has(ws)) {
        clients[ws._role].delete(ws);
        log.log(`[ProctorBridge] ${ws._role} disconnected (${JSON.stringify(peerCounts())})`);
        broadcastPeers();
      }
    });

    ws.on('error', (err) => {
      log.error('[ProctorBridge] socket error:', err.message);
    });
  });

  log.log(`[ProctorBridge] WebSocket hub ready at ws://localhost:<port>${path}`);

  return {
    stats: peerCounts,
    broadcast: (role, obj) => relay(role, obj),
    close: () =>
      new Promise((resolve) => {
        for (const role of VALID_ROLES) {
          for (const ws of clients[role]) ws.terminate();
          clients[role].clear();
        }
        wss.close(() => resolve());
      }),
  };
}
