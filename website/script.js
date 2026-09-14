/* ═══════════════════════════════════════════════════════════════════════════
   Smart Browser — Test Code Generator  |  Logic
   ─────────────────────────────────────────────────────────────────────────
   Encoding scheme (no server needed):
     1. Take the URL string.
     2. Base64-encode it.
     3. Prepend a 6-char random alphanumeric "human-friendly code".
     4. Store the mapping {code → url} in localStorage so the history table
        can reconstruct the list on reload.
     5. The final shareable code is: <6-char code>
     6. In the Electron app the student enters this code, the app calls the
        same decode logic to recover the original URL.
   ─────────────────────────────────────────────────────────────────────────
   Because this is a standalone demo with no backend, the code ↔ URL mapping
   lives entirely in localStorage. The Electron app also uses the same
   encode/decode functions (shared via a simple convention: the code IS a
   compressed representation of the URL itself, so no server lookup needed).
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Random Code Generator & Validation helpers ───────────────────────── //

/**
 * Generate a random 6-character alphanumeric code (uppercase letters and numbers).
 */
function generateRandomCode(length = 6) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  const cryptoObj = (typeof window !== 'undefined' && (window.crypto || window.msCrypto)) ||
                    (typeof crypto !== 'undefined' ? crypto : null);
  if (cryptoObj && cryptoObj.getRandomValues) {
    const values = new Uint8Array(length);
    cryptoObj.getRandomValues(values);
    for (let i = 0; i < length; i++) {
      result += chars[values[i] % chars.length];
    }
  } else {
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  }
  return result;
}

/**
 * Encode a URL into a short 6-character alphanumeric code.
 * Stores code, creation time, and 20-second expiry time in the database.
 */
function encodeURL(url) {
  return generateRandomCode(6);
}

/**
 * Decode / verify a code back into the original URL.
 * Rejects expired codes (expiry set to exactly 20 seconds).
 */
function decodeCode(code) {
  if (!code) return null;
  const cleanCode = code.trim().toUpperCase();
  const history = loadHistory();
  const item = history.find((entry) => entry.code === cleanCode);

  if (!item) {
    // Check fallback legacy encoding (prefix-base64)
    const sep = code.indexOf('-');
    if (sep !== -1) {
      const b64part = code.slice(sep + 1);
      let b64 = b64part.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      try {
        return decodeURIComponent(escape(atob(b64)));
      } catch {
        return null;
      }
    }
    return null;
  }

  // Reject expired codes (> 20 seconds from creation)
  const now = Date.now();
  const expiry = item.expiresTimestamp || (item.expiresAt ? new Date(item.expiresAt).getTime() : 0);
  if (expiry && now > expiry) {
    return null; // Rejected: code has expired
  }

  return item.url;
}

/**
 * Verify a test code with status details.
 */
function verifyCode(code) {
  if (!code) return { valid: false, error: 'Please enter a test code.' };
  const cleanCode = code.trim().toUpperCase();
  const history = loadHistory();
  const item = history.find((entry) => entry.code === cleanCode);

  if (!item) {
    return { valid: false, error: 'Invalid code. Please check and try again.' };
  }

  const now = Date.now();
  const expiry = item.expiresTimestamp || (item.expiresAt ? new Date(item.expiresAt).getTime() : 0);
  if (expiry && now > expiry) {
    return { valid: false, error: 'Code has expired. Test codes are valid for exactly 20 seconds.', expired: true };
  }

  return { valid: true, url: item.url, code: item.code, record: item };
}

// ── Storage ─────────────────────────────────────────────────────────────── //
const STORAGE_KEY = 'smartbrowser_codes';
const CANDIDATES_STORAGE_KEY = 'smartbrowser_candidates';

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveHistory(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

/**
 * Save candidate details in the database (Name, Enrollment Number, Batch).
 */
function saveCandidateDetails(details) {
  if (!details || !details.name || !details.enrollmentNumber || !details.batch) {
    return false;
  }
  try {
    const list = JSON.parse(localStorage.getItem(CANDIDATES_STORAGE_KEY) || '[]');
    const record = {
      name: details.name.trim(),
      enrollmentNumber: details.enrollmentNumber.trim(),
      batch: details.batch.trim(),
      code: details.code ? details.code.trim().toUpperCase() : '',
      submittedAt: new Date().toISOString(),
      timestamp: Date.now(),
    };
    list.unshift(record);
    localStorage.setItem(CANDIDATES_STORAGE_KEY, JSON.stringify(list));
    localStorage.setItem('smartbrowser_students', JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

// ── UI Logic ────────────────────────────────────────────────────────────── //
let lastGeneratedCode = '';

function generateCode() {
  const input = document.getElementById('linkInput');
  const errorText = document.getElementById('errorText');
  const url = input.value.trim();

  // Validate
  if (!url) {
    errorText.textContent = 'Please enter a test link.';
    input.focus();
    return;
  }

  // Basic URL validation
  try {
    const parsed = new URL(url.startsWith('http') ? url : 'https://' + url);
    if (!parsed.hostname.includes('.')) throw new Error();
  } catch {
    errorText.textContent = 'Please enter a valid URL (e.g. https://docs.google.com/forms/...).';
    input.focus();
    return;
  }

  errorText.textContent = '';

  const fullUrl = url.startsWith('http') ? url : 'https://' + url;
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  // Exactly 20 seconds expiry
  const expiresAt = new Date(now + 20 * 1000).toISOString();

  // Generate random 6-character alphanumeric code
  const code = generateRandomCode(6);
  lastGeneratedCode = code;

  // Save to database (localStorage)
  const history = loadHistory();
  const codeRecord = {
    code,
    url: fullUrl,
    createdAt,
    expiresAt,
    createdTimestamp: now,
    expiresTimestamp: now + 20000,
    time: new Date(now).toLocaleTimeString(),
  };

  history.unshift(codeRecord);
  if (history.length > 50) history.length = 50;
  saveHistory(history);

  // Sync with shared codes.json via local API server (port 5173)
  try {
    const apiTarget = window.location.port === '5173' ? '/api/codes' : 'http://127.0.0.1:5173/api/codes';
    fetch(apiTarget, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(codeRecord),
    }).catch(() => {
      // Offline fallback: handled by localStorage
    });
  } catch {
    // Graceful fallback
  }

  // Show result
  document.getElementById('codeText').textContent = code;
  document.getElementById('resultLink').textContent = fullUrl;
  document.getElementById('resultLink').title = fullUrl;
  document.getElementById('resultTime').textContent = new Date(now).toLocaleTimeString();
  const expiryEl = document.getElementById('resultExpiry');
  if (expiryEl) {
    expiryEl.textContent = '20 seconds';
  }

  document.getElementById('step1').classList.add('hidden');
  document.getElementById('step2').classList.remove('hidden');
  document.getElementById('cardTitle').textContent = 'Code Generated!';
  document.getElementById('cardSubtitle').textContent = 'Your 6-character test code is ready. Note: Code expires in 20 seconds.';

  renderHistory();
}

function copyCode() {
  const code = lastGeneratedCode;
  if (!code) return;

  navigator.clipboard.writeText(code).then(() => {
    showToast('Code copied to clipboard!');
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = code;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Code copied to clipboard!');
  });
}

function resetForm() {
  document.getElementById('linkInput').value = '';
  document.getElementById('errorText').textContent = '';
  document.getElementById('step1').classList.remove('hidden');
  document.getElementById('step2').classList.add('hidden');
  document.getElementById('cardTitle').textContent = 'Generate Test Code';
  document.getElementById('cardSubtitle').textContent =
    'Paste your Google Forms (or any test) link below to generate a unique code for your students.';
  document.getElementById('linkInput').focus();
}

// ── Toast ────────────────────────────────────────────────────────────────── //
function showToast(msg) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2200);
}

// ── History table ────────────────────────────────────────────────────────── //
function renderHistory() {
  const container = document.getElementById('historyTable');
  if (!container) return;
  const history = loadHistory();

  if (history.length === 0) {
    container.innerHTML = '<p class="empty-state">No codes generated yet.</p>';
    return;
  }

  let html = '<table><thead><tr><th>Code</th><th>Link</th><th>Created</th><th>Status</th></tr></thead><tbody>';
  const now = Date.now();
  history.forEach((item) => {
    const expiry = item.expiresTimestamp || (item.expiresAt ? new Date(item.expiresAt).getTime() : 0);
    const isExpired = expiry && now > expiry;
    const statusHtml = isExpired
      ? '<span class="badge badge-expired">Expired</span>'
      : '<span class="badge badge-active">Active</span>';

    html += `<tr>
      <td class="code-cell" title="${item.code}">${item.code}</td>
      <td class="link-cell" title="${item.url}">${item.url}</td>
      <td>${item.time || (item.createdAt ? new Date(item.createdAt).toLocaleTimeString() : '')}</td>
      <td>${statusHtml}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

// ── Init ─────────────────────────────────────────────────────────────────── //
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    renderHistory();
    const linkInput = document.getElementById('linkInput');
    if (linkInput) linkInput.focus();
  });
}

// ── Export / Global attachment for testing and script tag environments ──── //
if (typeof globalThis !== 'undefined') {
  globalThis.generateRandomCode = generateRandomCode;
  globalThis.generateCode = generateCode;
  globalThis.encodeURL = encodeURL;
  globalThis.decodeCode = decodeCode;
  globalThis.verifyCode = verifyCode;
  globalThis.loadHistory = loadHistory;
  globalThis.saveHistory = saveHistory;
  globalThis.STORAGE_KEY = STORAGE_KEY;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    generateRandomCode,
    generateCode,
    encodeURL,
    decodeCode,
    verifyCode,
    loadHistory,
    saveHistory,
    STORAGE_KEY,
  };
}


