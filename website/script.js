/* ═══════════════════════════════════════════════════════════════════════════
   Smart Browser — Test Code Generator  |  Client Logic
   ─────────────────────────────────────────────────────────────────────────
   Now connected to the backend API + persistent SQLite/PostgreSQL database.
   Codes are 6-character unambiguous alphanumeric tokens generated server-side.
   Target URLs are validated and stored safely on the server.
   ═══════════════════════════════════════════════════════════════════════════ */

const API_BASE_URL = window.API_BASE_URL || 'http://localhost:3001/api';
const STORAGE_CACHE_KEY = 'smartbrowser_cached_codes';

// ── Storage Fallback Helpers ────────────────────────────────────────────── //
function loadCachedHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_CACHE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveCachedHistory(list) {
  try {
    localStorage.setItem(STORAGE_CACHE_KEY, JSON.stringify(list));
  } catch {
    // Ignore storage quota errors
  }
}

// ── UI Logic ────────────────────────────────────────────────────────────── //
let lastGeneratedCode = '';

async function generateCode() {
  const input = document.getElementById('linkInput');
  const errorText = document.getElementById('errorText');
  const generateBtn = document.getElementById('generateBtn');
  const url = input.value.trim();

  // Validate presence
  if (!url) {
    errorText.textContent = 'Please enter a test link.';
    input.focus();
    return;
  }

  // Pre-validate URL format client-side
  const fullUrl = url.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//) ? url : 'https://' + url;
  try {
    const parsed = new URL(fullUrl);
    if (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost') {
      throw new Error();
    }
  } catch {
    errorText.textContent = 'Please enter a valid URL (e.g. https://docs.google.com/forms/...).';
    input.focus();
    return;
  }

  errorText.textContent = '';
  generateBtn.disabled = true;
  const originalBtnText = generateBtn.innerHTML;
  generateBtn.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin">
      <circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-linecap="round"/>
    </svg>
    Generating...
  `;

  try {
    const response = await fetch(`${API_BASE_URL}/codes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: fullUrl }),
    });

    const data = await response.json();

    if (!response.ok) {
      errorText.textContent = data.error || 'Failed to generate code. Please try again.';
      return;
    }

    lastGeneratedCode = data.code;

    // Show result
    document.getElementById('codeText').textContent = data.code;
    document.getElementById('resultLink').textContent = data.url;
    document.getElementById('resultLink').title = data.url;
    document.getElementById('resultTime').textContent = new Date(data.createdAt).toLocaleString();

    document.getElementById('step1').classList.add('hidden');
    document.getElementById('step2').classList.remove('hidden');
    document.getElementById('cardTitle').textContent = 'Code Generated!';
    document.getElementById('cardSubtitle').textContent =
      'Your test code is ready. Share it with your students.';

    // Refresh history from API
    await renderHistory();
  } catch (err) {
    errorText.textContent =
      'Cannot connect to the backend server. Please verify the server is running on http://localhost:3001.';
  } finally {
    generateBtn.disabled = false;
    generateBtn.innerHTML = originalBtnText;
  }
}

function copyCode() {
  const code = lastGeneratedCode;
  if (!code) return;

  navigator.clipboard
    .writeText(code)
    .then(() => {
      showToast('Code copied to clipboard!');
    })
    .catch(() => {
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
async function renderHistory() {
  const container = document.getElementById('historyTable');

  let codes = [];
  let isOffline = false;

  try {
    const res = await fetch(`${API_BASE_URL}/codes?limit=20`);
    if (res.ok) {
      codes = await res.json();
      saveCachedHistory(codes);
    } else {
      throw new Error('Server returned non-200');
    }
  } catch {
    codes = loadCachedHistory();
    isOffline = true;
  }

  if (!codes || codes.length === 0) {
    container.innerHTML = `
      <p class="empty-state">
        ${isOffline ? 'Offline — No cached codes found. Start server on :3001.' : 'No codes generated yet.'}
      </p>
    `;
    return;
  }

  let html = '';
  if (isOffline) {
    html += '<p style="color:var(--warning,#f59e0b);font-size:0.78rem;margin-bottom:8px;">⚠️ Server unreachable — showing cached history.</p>';
  }

  html += '<table><thead><tr><th>Code</th><th>Link</th><th>Status</th><th>Created</th></tr></thead><tbody>';
  codes.forEach((item) => {
    const formattedDate = item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '';
    const statusColor = item.status === 'active' ? '#10b981' : item.status === 'revoked' ? '#ef4444' : '#f59e0b';

    html += `<tr>
      <td class="code-cell" title="${item.code}">${item.code}</td>
      <td class="link-cell" title="${item.url}">${item.url}</td>
      <td><span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:600;background:rgba(255,255,255,0.06);color:${statusColor}">${item.status || 'active'}</span></td>
      <td>${formattedDate}</td>
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
