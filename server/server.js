/**
 * Standalone Backend Server (Optional)
 * 
 * Provides an independent API gateway for Smart Browser and Veyon Integration.
 * 
 * Note: When running `npm run dev`, Vite's built-in connect middleware also directly
 * routes /api/veyon/* requests via `server/routes/veyon.js`, so a separate node process
 * is NOT strictly required for local development. This standalone server is provided
 * for dedicated backend/production deployments or remote proctoring relays.
 */

import http from 'http';
import { veyonMiddleware } from './routes/veyon.js';

const PORT = parseInt(process.env.PORT || '4000', 10);
const HOST = process.env.HOST || '127.0.0.1';

const server = http.createServer((req, res) => {
  // Enable CORS for frontend clients
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // Route to Veyon middleware
  const handled = veyonMiddleware(req, res, () => {
    // Fallback 404 handler
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
  });

  if (!handled) {
    // If not handled synchronously and next was not called
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[Smart Browser] Veyon Integration Backend running at http://${HOST}:${PORT}`);
  console.log(`[Smart Browser] Health check: http://${HOST}:${PORT}/api/veyon/health`);
});

export default server;
