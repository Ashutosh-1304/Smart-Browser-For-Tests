
import veyonClient from '../services/veyonClient.js';

export async function handleVeyonHealth(req, res) {
  try {
    const health = await veyonClient.checkHealth();
    
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
