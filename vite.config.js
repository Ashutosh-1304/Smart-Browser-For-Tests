import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const codesFile = path.resolve(__dirname, 'codes.json');

function getCodes() {
  try {
    if (!fs.existsSync(codesFile)) {
      fs.writeFileSync(codesFile, '[]', 'utf-8');
    }
    return JSON.parse(fs.readFileSync(codesFile, 'utf-8') || '[]');
  } catch {
    return [];
  }
}

function saveCodes(list) {
  try {
    fs.writeFileSync(codesFile, JSON.stringify(list, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving codes.json:', e);
  }
}

function codesApiPlugin() {
  return {
    name: 'codes-api-plugin',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Enable CORS for external browser (Chrome/Safari) requests
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }

        const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1:5173'}`);

        if (url.pathname === '/api/codes' && req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(getCodes()));
          return;
        }

        if (url.pathname.startsWith('/api/codes/') && req.method === 'GET') {
          const code = decodeURIComponent(url.pathname.replace('/api/codes/', '')).trim().toUpperCase();
          const codes = getCodes();
          const record = codes.find((entry) => entry.code === code);
          res.setHeader('Content-Type', 'application/json');

          if (!record) {
            res.statusCode = 404;
            res.end(JSON.stringify({ valid: false, error: 'Invalid test code. Please check and try again.' }));
            return;
          }

          const now = Date.now();
          const expiry = record.expiresTimestamp || (record.expiresAt ? new Date(record.expiresAt).getTime() : 0);
          if (expiry && now > expiry) {
            res.statusCode = 410;
            res.end(JSON.stringify({
              valid: false,
              expired: true,
              error: 'This test code has expired. Codes are only valid for 20 seconds.',
            }));
            return;
          }

          res.end(JSON.stringify({ valid: true, url: record.url, code: record.code, record }));
          return;
        }

        if (url.pathname === '/api/codes' && req.method === 'POST') {
          let body = '';
          req.on('data', (chunk) => { body += chunk; });
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              if (!data.code || !data.url) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Missing code or url' }));
                return;
              }
              const codes = getCodes();
              const filtered = codes.filter((c) => c.code !== data.code.toUpperCase());
              filtered.unshift({
                ...data,
                code: data.code.toUpperCase(),
              });
              saveCodes(filtered.slice(0, 100));
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, code: data.code }));
            } catch {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Invalid JSON body' }));
            }
          });
          return;
        }

        next();
      });
    },
  };
}

// Vite serves the React renderer. base:'./' keeps asset paths relative so the
// production build also works when Electron loads it via file://.
export default defineConfig({
  plugins: [react(), codesApiPlugin()],
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
