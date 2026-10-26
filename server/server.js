
import http from 'http';
import { veyonMiddleware } from './routes/veyon.js';

const PORT = parseInt(process.env.PORT || '4000', 10);
const HOST = process.env.HOST || '127.0.0.1';

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const handled = veyonMiddleware(req, res, () => {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
  });

  if (!handled) {
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[Smart Browser] Veyon Integration Backend running at http://${HOST}:${PORT}`);
  console.log(`[Smart Browser] Health check: http://${HOST}:${PORT}/api/veyon/health`);
});

export default server;
