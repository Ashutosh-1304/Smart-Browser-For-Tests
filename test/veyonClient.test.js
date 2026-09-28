import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { VeyonClient } from '../server/services/veyonClient.js';
import { handleVeyonHealth } from '../server/routes/veyon.js';

test('VeyonClient - Default configuration', () => {
  const client = new VeyonClient();
  assert.equal(client.host, '127.0.0.1');
  assert.equal(client.port, 11080);
  assert.equal(client.protocol, 'http');
  assert.equal(client.getBaseUrl(), 'http://127.0.0.1:11080');
});

test('VeyonClient - Custom configuration override', () => {
  const client = new VeyonClient({
    host: '192.168.1.50',
    port: 12000,
    protocol: 'https',
    timeoutMs: 1500,
  });
  assert.equal(client.host, '192.168.1.50');
  assert.equal(client.port, 12000);
  assert.equal(client.protocol, 'https');
  assert.equal(client.timeoutMs, 1500);
  assert.equal(client.getBaseUrl(), 'https://192.168.1.50:12000');
});

test('VeyonClient - Gracefully handles offline Veyon service', async () => {
  // Point client to an unused local port that will refuse connection
  const client = new VeyonClient({
    host: '127.0.0.1',
    port: 59999,
    timeoutMs: 500,
  });

  const health = await client.checkHealth();
  assert.equal(health.available, false);
  assert.equal(health.service, 'veyon');
  assert.equal(health.webapi, 'unreachable');
  assert.ok(health.error);
  assert.equal(health.endpoint, '127.0.0.1:59999');
});

test('VeyonClient - Successfully reports reachable when mock Veyon WebAPI is active', async () => {
  // Spin up an ephemeral mock HTTP server simulating Veyon WebAPI
  const mockServer = http.createServer((req, res) => {
    if (req.url === '/api/v1/session') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'active', user: 'student01' }));
    } else {
      res.statusCode = 404;
      res.end();
    }
  });

  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  const mockPort = mockServer.address().port;

  try {
    const client = new VeyonClient({
      host: '127.0.0.1',
      port: mockPort,
      timeoutMs: 1000,
    });

    const health = await client.checkHealth();
    assert.equal(health.available, true);
    assert.equal(health.service, 'veyon');
    assert.equal(health.webapi, 'reachable');
    assert.equal(health.statusCode, 200);
    assert.equal(health.endpoint, `127.0.0.1:${mockPort}`);
  } finally {
    await new Promise((resolve) => mockServer.close(resolve));
  }
});

test('Veyon Route - handleVeyonHealth outputs correct JSON structure', async () => {
  let responseData = '';
  let statusCode = 0;
  const headers = {};

  const req = {
    method: 'GET',
    url: '/api/veyon/health',
    headers: { host: '127.0.0.1:5173' },
  };

  const res = {
    set statusCode(val) { statusCode = val; },
    get statusCode() { return statusCode; },
    setHeader(key, val) { headers[key] = val; },
    end(data) { responseData = data; },
  };

  await handleVeyonHealth(req, res);

  assert.ok(statusCode === 200 || statusCode === 503);
  assert.equal(headers['Content-Type'], 'application/json');

  const parsed = JSON.parse(responseData);
  assert.equal(parsed.service, 'veyon');
  assert.ok('available' in parsed);
  assert.ok('webapi' in parsed);
});
