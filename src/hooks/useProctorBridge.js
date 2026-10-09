import { useCallback, useEffect, useRef, useState } from 'react';
import { ProctorClient } from '../proctor/ProctorClient.js';

/**
 * React wrapper around ProctorClient. Owns a single client instance for the
 * component's lifetime, exposes imperative senders, and surfaces live
 * connection status plus the most recent command received from the agent.
 *
 * @param {Object} [opts]
 * @param {(cmd: {action: string, message: string|null, at: number}) => void} [opts.onCommand]
 *        Called whenever the control agent (Veyon plugin) issues a command.
 * @param {string} [opts.url] – override the hub URL (defaults to localhost:3001).
 * @returns {{
 *   connected: boolean,
 *   peers: { app: number, agent: number },
 *   agentOnline: boolean,
 *   identify: Function, startSession: Function, endSession: Function,
 *   sendViolation: Function, sendScore: Function
 * }}
 */
export function useProctorBridge(opts = {}) {
  const { onCommand, url } = opts;

  const clientRef = useRef(null);
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;

  const [connected, setConnected] = useState(false);
  const [peers, setPeers] = useState({ app: 0, agent: 0 });

  if (!clientRef.current) {
    clientRef.current = new ProctorClient({
      url,
      onCommand: (cmd) => onCommandRef.current?.(cmd),
      onStatus: ({ connected: c, peers: p }) => {
        setConnected(c);
        if (p) setPeers(p);
      },
    });
  }

  useEffect(() => {
    const client = clientRef.current;
    client.connect();
    return () => client.close();
  }, []);

  const identify = useCallback((info) => clientRef.current?.identify(info), []);
  const startSession = useCallback((info) => clientRef.current?.startSession(info), []);
  const endSession = useCallback(() => clientRef.current?.endSession(), []);
  const sendViolation = useCallback((type, message) => clientRef.current?.sendViolation(type, message), []);
  const sendScore = useCallback((total, breakdown) => clientRef.current?.sendScore(total, breakdown), []);

  return {
    connected,
    peers,
    agentOnline: peers.agent > 0,
    identify,
    startSession,
    endSession,
    sendViolation,
    sendScore,
  };
}
