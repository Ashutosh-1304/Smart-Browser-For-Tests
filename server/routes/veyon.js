/**
 * Veyon API Route Handler
 * 
 * Provides HTTP endpoints to interface with the Veyon service.
 * Supports both standalone Express routers and standard Node.js/Connect HTTP middlewares
 * (such as Vite dev server's middleware pipeline).
 */

import veyonClient from '../services/veyonClient.js';

/**
 * Handle GET /api/veyon/health
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
export async function handleVeyonHealth(req, res) {
  try {
    const health = await veyonClient.checkHealth();
    
    // Status code: 200 if WebAPI is reachable, 503 Service Unavailable if unreachable.
    res.statusCode = health.available ? 200 : 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(health, null, 2));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        available: false,
        service: 'veyon',
        webapi: 'error',
        error: err.message || 'Internal error checking Veyon status',
      }, null, 2)
    );
  }
}

/**
 * Universal middleware dispatcher for Veyon routes.
 * 
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {Function} next
 * @returns {boolean} True if route was handled, false if forwarded
 */
export function veyonMiddleware(req, res, next) {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1:5173'}`);

  if (url.pathname === '/api/veyon/health' && req.method === 'GET') {
    handleVeyonHealth(req, res);
    return true;
  }

  if (typeof next === 'function') {
    next();
  }
  return false;
}

export default {
  handleVeyonHealth,
  veyonMiddleware,
};
