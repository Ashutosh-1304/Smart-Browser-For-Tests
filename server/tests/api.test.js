import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAndNormalizeUrl } from '../utils/urlValidator.js';
import { generateCandidateCode, generateUniqueCode, CODE_CHARSET, CODE_LENGTH } from '../utils/codeGenerator.js';
import { app } from '../app.js';
import { initDb, db } from '../db.js';

let server;
let baseUrl;

test.before(async () => {
  // Use in-memory SQLite for testing
  await initDb();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await db.destroy();
});

test('URL Validator: accepts valid URLs and enforces http/https', () => {
  const v1 = validateAndNormalizeUrl('https://docs.google.com/forms/d/e/123');
  assert.equal(v1.valid, true);
  assert.equal(v1.url, 'https://docs.google.com/forms/d/e/123');

  const v2 = validateAndNormalizeUrl('http://example.com/test');
  assert.equal(v2.valid, true);

  const v3 = validateAndNormalizeUrl('docs.google.com/forms');
  assert.equal(v3.valid, true);
  assert.equal(v3.url, 'https://docs.google.com/forms');

  const v4 = validateAndNormalizeUrl('javascript:alert(1)');
  assert.equal(v4.valid, false);

  const v5 = validateAndNormalizeUrl('file:///etc/passwd');
  assert.equal(v5.valid, false);

  const v6 = validateAndNormalizeUrl('not-a-valid-url');
  assert.equal(v6.valid, false);
});

test('Issue #10: Code format matches ^[A-Z2-9]{6}$ and excludes ambiguous characters', () => {
  const ambiguousChars = ['0', 'O', '1', 'I', 'L'];
  const codeRegex = /^[A-Z2-9]{6}$/;

  for (let i = 0; i < 200; i++) {
    const code = generateCandidateCode();
    assert.equal(code.length, CODE_LENGTH, 'Code must be exactly 6 characters');
    assert.match(code, codeRegex, 'Code must match ^[A-Z2-9]{6}$');

    for (const ambig of ambiguousChars) {
      assert.ok(!code.includes(ambig), `Code ${code} must not contain ambiguous char ${ambig}`);
    }
  }
});

test('Issue #10: Uniqueness collision retry succeeds on collision', async () => {
  // Mock a DB where first call finds an existing code, and second call finds none
  let calls = 0;
  const mockDb = () => ({
    where: () => ({
      first: async () => {
        calls++;
        return calls === 1 ? { id: 'existing-id' } : null;
      },
    }),
  });

  const uniqueCode = await generateUniqueCode(mockDb, 5);
  assert.equal(uniqueCode.length, 6);
  assert.equal(calls, 2, 'Should have retried once after first collision');
});

test('Issue #10: Collision retry throws when max retries exceeded', async () => {
  // Mock a DB that always returns a colliding record
  const mockCollidingDb = () => ({
    where: () => ({
      first: async () => ({ id: 'always-collision' }),
    }),
  });

  await assert.rejects(
    async () => {
      await generateUniqueCode(mockCollidingDb, 3);
    },
    /Failed to generate unique test code after multiple retries/
  );
});

test('API: health endpoint returns 200', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.status, 'ok');
  assert.equal(json.database, 'connected');
});

test('API: POST /api/codes generates and stores test code', async () => {
  const res = await fetch(`${baseUrl}/api/codes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://classroom.google.com/test' }),
  });

  assert.equal(res.status, 201);
  const data = await res.json();
  assert.ok(data.code);
  assert.equal(data.code.length, 6);
  assert.equal(data.url, 'https://classroom.google.com/test');
  assert.equal(data.status, 'active');
  assert.ok(data.createdAt);
});

test('API: POST /api/codes rejects invalid URLs with 400', async () => {
  const res = await fetch(`${baseUrl}/api/codes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'ftp://bad-scheme.com' }),
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(data.error);
});

test('API: GET /api/codes/:code resolves code and increments hit count', async () => {
  // Create code
  const createRes = await fetch(`${baseUrl}/api/codes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://assessment.org/exam1' }),
  });
  const created = await createRes.json();
  const testCode = created.code;

  // Resolve code with case-insensitivity (lowercase)
  const resolveRes = await fetch(`${baseUrl}/api/codes/${testCode.toLowerCase()}`);
  assert.equal(resolveRes.status, 200);
  const resolved = await resolveRes.json();
  assert.equal(resolved.code, testCode);
  assert.equal(resolved.url, 'https://assessment.org/exam1');
  assert.equal(resolved.status, 'active');

  // Resolve code with case-insensitivity (mixed case)
  const mixedCase = testCode[0].toLowerCase() + testCode.slice(1).toUpperCase();
  const mixedRes = await fetch(`${baseUrl}/api/codes/${mixedCase}`);
  assert.equal(mixedRes.status, 200);

  // Internal fields should not be leaked
  assert.equal(resolved.id, undefined);
  assert.equal(resolved.created_by, undefined);

  // Check hit count in DB (2 resolutions performed)
  const row = await db('codes').where({ code: testCode }).first();
  assert.equal(row.hit_count, 2);
});

test('API: GET /api/codes/:code returns 404 for non-existent code', async () => {
  const res = await fetch(`${baseUrl}/api/codes/NONEX9`);
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.ok(data.error);
});

test('API: POST /api/codes/:code/revoke and 410 on resolution', async () => {
  const createRes = await fetch(`${baseUrl}/api/codes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://assessment.org/exam2' }),
  });
  const created = await createRes.json();
  const testCode = created.code;

  // Revoke code
  const revokeRes = await fetch(`${baseUrl}/api/codes/${testCode}/revoke`, {
    method: 'POST',
  });
  assert.equal(revokeRes.status, 200);
  const revokeData = await revokeRes.json();
  assert.equal(revokeData.status, 'revoked');

  // Attempt resolving revoked code
  const resolveRes = await fetch(`${baseUrl}/api/codes/${testCode}`);
  assert.equal(resolveRes.status, 410);
  const resolveData = await resolveRes.json();
  assert.equal(resolveData.status, 'revoked');
});

test('API: GET /api/codes returns recent codes list without leaking internals', async () => {
  const res = await fetch(`${baseUrl}/api/codes`);
  assert.equal(res.status, 200);
  const list = await res.json();
  assert.ok(Array.isArray(list));
  assert.ok(list.length > 0);
  for (const item of list) {
    assert.ok(item.code);
    assert.ok(item.url);
    assert.ok(item.status);
    assert.equal(item.id, undefined);
    assert.equal(item.created_by, undefined);
  }
});
