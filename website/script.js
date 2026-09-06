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

// ── Encode / Decode helpers ─────────────────────────────────────────────── //

/**
 * Encode a URL into a short alphanumeric code.
 *
 * Strategy: base64-encode the URL, then take a deterministic 6-char hash
 * from it so the code is short and memorable. To guarantee we can decode it
 * back, we append the full base64 payload after a separator ("-").
 *
 * Final code format: XXXXXX-<base64url>
 *   – XXXXXX  = 6 uppercase alphanumeric characters (human-friendly part)
 *   – base64url = URL-safe base64 of the original link
 */
function encodeURL(url) {
  // Standard base64, then make URL-safe (replace +/ with -_)
  const b64 = btoa(unescape(encodeURIComponent(url)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  // Generate a 6-char human-readable prefix from a simple hash
  const prefix = shortHash(url);

  return prefix + '-' + b64;
}

/**
 * Decode a code back into the original URL.
 */
function decodeCode(code) {
  const sep = code.indexOf('-');
  if (sep === -1) return null;

  const b64part = code.slice(sep + 1);

  // Restore standard base64 chars and padding
  let b64 = b64part.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';

  try {
    return decodeURIComponent(escape(atob(b64)));
  } catch {
    return null;
  }
}

/**
 * Produce a deterministic 6-char alphanumeric string from any input string.
 */
function shortHash(str) {
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime
  }
  // Make positive, convert to base-36, pad and uppercase
  const raw = Math.abs(h).toString(36).toUpperCase();
  return (raw + 'AAAAAA').slice(0, 6);
}

// ── Storage ─────────────────────────────────────────────────────────────── //
const STORAGE_KEY = 'smartbrowser_codes';

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
  const code = encodeURL(fullUrl);
  lastGeneratedCode = code;

  // Save to history
  const history = loadHistory();
  history.unshift({
    code,
    url: fullUrl,
    time: new Date().toLocaleString(),
  });
  // Keep only last 20
  if (history.length > 20) history.length = 20;
  saveHistory(history);

  // Show result
  document.getElementById('codeText').textContent = code;
  document.getElementById('resultLink').textContent = fullUrl;
  document.getElementById('resultLink').title = fullUrl;
  document.getElementById('resultTime').textContent = new Date().toLocaleString();

  document.getElementById('step1').classList.add('hidden');
  document.getElementById('step2').classList.remove('hidden');
  document.getElementById('cardTitle').textContent = 'Code Generated!';
  document.getElementById('cardSubtitle').textContent = 'Your test code is ready. Share it with your students.';

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
  const history = loadHistory();

  if (history.length === 0) {
    container.innerHTML = '<p class="empty-state">No codes generated yet.</p>';
    return;
  }

  let html = '<table><thead><tr><th>Code</th><th>Link</th><th>Created</th></tr></thead><tbody>';
  history.forEach((item) => {
    const shortCode = item.code.split('-')[0]; // Show only the 6-char prefix in table
    html += `<tr>
      <td class="code-cell" title="${item.code}">${shortCode}…</td>
      <td class="link-cell" title="${item.url}">${item.url}</td>
      <td>${item.time}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

// ── Init ─────────────────────────────────────────────────────────────────── //
document.addEventListener('DOMContentLoaded', () => {
  renderHistory();
  document.getElementById('linkInput').focus();
});
