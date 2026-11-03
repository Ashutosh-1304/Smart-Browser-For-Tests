const API_BASE_URL = window.API_BASE_URL || 'http://localhost:3001/api';
const STORAGE_CACHE_KEY = 'smartbrowser_cached_codes';

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
  } catch {}
}

let lastGeneratedCode = '';
let cachedCodes = [];
let currentSearchQuery = '';
let currentStatusFilter = 'all';

/* ── Preset Strictness Configurations ─────────────────────────────────────── */
const PRESET_DEFS = {
  'level-1': {
    name: 'Relaxed',
    passThreshold: 50,
    grace: 3,
    violations: {
      'multiple-faces': { enabled: true,  priority: 'HIGH',        deduction: 15, dwellMs: 3000, cooldownMs: 5000 },
      'face':           { enabled: true,  priority: 'HIGH',        deduction: 8,  dwellMs: 5000, cooldownMs: 5000 },
      'gaze':           { enabled: false, priority: 'MEDIUM_HIGH', deduction: 8,  dwellMs: 1500, cooldownMs: 5000 },
      'focus':          { enabled: true,  priority: 'MEDIUM',      deduction: 5,  dwellMs: 2000, cooldownMs: 2000 },
      'fullscreen':     { enabled: true,  priority: 'MEDIUM',      deduction: 5,  dwellMs: 1000, cooldownMs: 5000 },
      'obstacle':       { enabled: false, priority: 'MEDIUM',      deduction: 10, dwellMs: 800,  cooldownMs: 5000 },
    }
  },
  'level-2': {
    name: 'Standard',
    passThreshold: 70,
    grace: 1,
    violations: {
      'multiple-faces': { enabled: true, priority: 'HIGH',        deduction: 20, dwellMs: 3000, cooldownMs: 5000 },
      'face':           { enabled: true, priority: 'HIGH',        deduction: 15, dwellMs: 3000, cooldownMs: 5000 },
      'gaze':           { enabled: true, priority: 'MEDIUM_HIGH', deduction: 12, dwellMs: 1500, cooldownMs: 5000 },
      'focus':          { enabled: true, priority: 'MEDIUM',      deduction: 10, dwellMs: 2000, cooldownMs: 2000 },
      'fullscreen':     { enabled: true, priority: 'MEDIUM',      deduction: 10, dwellMs: 1000, cooldownMs: 5000 },
      'obstacle':       { enabled: true, priority: 'MEDIUM',      deduction: 8,  dwellMs: 1000, cooldownMs: 5000 },
    }
  },
  'level-3': {
    name: 'Strict',
    passThreshold: 85,
    grace: 0,
    violations: {
      'multiple-faces': { enabled: true, priority: 'HIGH',        deduction: 30, dwellMs: 2000, cooldownMs: 4000 },
      'face':           { enabled: true, priority: 'HIGH',        deduction: 20, dwellMs: 2000, cooldownMs: 4000 },
      'gaze':           { enabled: true, priority: 'MEDIUM_HIGH', deduction: 15, dwellMs: 1000, cooldownMs: 4000 },
      'focus':          { enabled: true, priority: 'MEDIUM',      deduction: 20, dwellMs: 1500, cooldownMs: 1500 },
      'fullscreen':     { enabled: true, priority: 'MEDIUM',      deduction: 20, dwellMs: 800,  cooldownMs: 4000 },
      'obstacle':       { enabled: true, priority: 'MEDIUM',      deduction: 20, dwellMs: 500,  cooldownMs: 4000 },
    }
  },
};

const VIOLATION_META = {
  'multiple-faces': 'Multiple Faces',
  'face': 'No Face',
  'gaze': 'Looking Away',
  'focus': 'Tab Switch',
  'fullscreen': 'Fullscreen Exit',
  'obstacle': 'Object Detected',
};

const PRIORITY_VALUES = { HIGH: 5, MEDIUM_HIGH: 4, MEDIUM: 3, LOW: 1 };
const PRIORITIES = ['HIGH', 'MEDIUM_HIGH', 'MEDIUM', 'LOW'];

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

function simulatePreset(preset, events) {
  const types = Object.keys(preset.violations).filter(t => preset.violations[t].enabled);
  const totalPri = types.reduce((s, t) => s + (PRIORITY_VALUES[preset.violations[t].priority] || 1), 0);
  let total = 0;
  const rows = types.map(t => {
    const v = preset.violations[t];
    const weight = (PRIORITY_VALUES[v.priority] || 1) / (totalPri || 1);
    const counted = Math.max(0, events - preset.grace);
    const score = Math.max(0, 100 - counted * v.deduction);
    total += score * weight;
    return { t, score, weight, deduction: v.deduction, counted };
  });
  return { total: +total.toFixed(1), rows };
}

let customPreset = deepClone(PRESET_DEFS['level-2']);
customPreset.id = 'custom';

function renderCustomEditor() {
  const container = document.getElementById('customViolations');
  if (!container) return;
  container.innerHTML = '';
  for (const [type, meta] of Object.entries(VIOLATION_META)) {
    const v = customPreset.violations[type];
    const row = document.createElement('div');
    row.className = 'custom-row' + (v.enabled ? '' : ' disabled');
    row.innerHTML = `
      <div class="custom-row-head">
        <label class="custom-toggle"><input type="checkbox" data-type="${type}" ${v.enabled ? 'checked' : ''} /> <span class="custom-type-name">${meta}</span></label>
        <span class="custom-value" data-val="${type}">−${v.deduction} pts</span>
      </div>
      <div class="custom-sliders" data-sliders="${type}">
        <label>Deduction <input type="range" min="0" max="50" value="${v.deduction}" data-type="${type}" data-field="deduction" /></label>
        <label>Dwell (ms) <input type="range" min="0" max="8000" step="100" value="${v.dwellMs || 0}" data-type="${type}" data-field="dwellMs" /></label>
        <label>Cooldown (ms) <input type="range" min="0" max="15000" step="500" value="${v.cooldownMs || 5000}" data-type="${type}" data-field="cooldownMs" /></label>
        <label>Priority
          <select data-type="${type}" data-field="priority">
            ${PRIORITIES.map(p => `<option ${p === v.priority ? 'selected' : ''}>${p}</option>`).join('')}
          </select>
        </label>
      </div>`;
    container.appendChild(row);
  }
  container.querySelectorAll('input,select').forEach(el => {
    el.addEventListener('input', onCustomInput);
  });
  updateWhatIf();
}

function onCustomInput(e) {
  const el = e.target;
  const type = el.dataset.type;
  const field = el.dataset.field;
  if (!type) return;
  const v = customPreset.violations[type];
  if (el.type === 'checkbox') {
    v.enabled = el.checked;
    el.closest('.custom-row').classList.toggle('disabled', !v.enabled);
  } else if (field === 'priority') {
    v.priority = el.value;
  } else if (field) {
    v[field] = parseInt(el.value, 10);
    const valEl = document.querySelector(`[data-val="${type}"]`);
    if (valEl) valEl.textContent = `−${v.deduction} pts`;
  }
  updateWhatIf();
}

function updateWhatIf() {
  const simInput = document.getElementById('whatifEvents');
  const simVal = document.getElementById('whatifEventsVal');
  const resultContainer = document.getElementById('whatifResult');
  if (!simInput || !resultContainer) return;

  const events = parseInt(simInput.value, 10);
  if (simVal) simVal.textContent = events;
  const { total, rows } = simulatePreset(customPreset, events);
  const flag = total < customPreset.passThreshold;
  const parts = rows.map(r => `${VIOLATION_META[r.t]} ${r.score}`).join(' · ');
  resultContainer.innerHTML =
    `<span class="whatif-score ${flag ? 'flag' : 'ok'}">${Math.round(total)}</span>` +
    `<span class="whatif-flag">${flag ? `⚠ below ${customPreset.passThreshold} → flagged` : `✓ above ${customPreset.passThreshold} pass threshold`}</span>` +
    `<div class="whatif-detail">${parts}</div>`;
}

function selectedPresetId() {
  const checked = document.querySelector('input[name="preset"]:checked');
  return checked ? checked.value : 'level-2';
}

function syncCustomEditorVisibility() {
  const editor = document.getElementById('customEditor');
  const isCustom = selectedPresetId() === 'custom';
  if (editor) {
    editor.classList.toggle('hidden', !isCustom);
    if (isCustom) renderCustomEditor();
  }
  updateActivePresetMetric();
}

function updateActivePresetMetric() {
  const presetId = selectedPresetId();
  const nameEl = document.getElementById('statActivePreset');
  const levelEl = document.getElementById('statPresetLevel');

  const meta = {
    'level-1': { name: 'Relaxed', badge: 'L1' },
    'level-2': { name: 'Standard', badge: 'L2' },
    'level-3': { name: 'Strict', badge: 'L3' },
    'custom':  { name: 'Custom', badge: '⚙ Custom' }
  }[presetId] || { name: 'Standard', badge: 'L2' };

  if (nameEl) nameEl.textContent = meta.name;
  if (levelEl) levelEl.textContent = meta.badge;
}

/* ── Dynamic Time-Based Greeting ─────────────────────────────────────────── */
function updateDynamicGreeting() {
  const greetingEl = document.getElementById('dynamicGreeting');
  if (!greetingEl) return;
  const hour = new Date().getHours();
  let text = 'Good morning, Professor';
  if (hour >= 12 && hour < 17) {
    text = 'Good afternoon, Professor';
  } else if (hour >= 17) {
    text = 'Good evening, Professor';
  }
  greetingEl.textContent = text;
}

/* ── Real Stat Metrics Calculation ───────────────────────────────────────── */
function updateMetrics(codes) {
  const totalEl = document.getElementById('statTotalCodes');
  const activeEl = document.getElementById('statActiveCodes');
  const hitsEl = document.getElementById('statTotalHits');

  const list = codes || [];
  const total = list.length;
  const active = list.filter(c => c.status === 'active').length;
  const totalHits = list.reduce((sum, c) => sum + (c.hitCount || c.hit_count || 0), 0);

  if (totalEl) totalEl.textContent = total.toLocaleString();
  if (activeEl) activeEl.textContent = active.toLocaleString();
  if (hitsEl) hitsEl.textContent = totalHits.toLocaleString();

  updateActivePresetMetric();
}

/* ── Generate Test Code API Call ─────────────────────────────────────────── */
async function generateCode() {
  const input = document.getElementById('linkInput');
  const errorText = document.getElementById('errorText');
  const generateBtn = document.getElementById('generateBtn');
  const url = input.value.trim();

  if (!url) {
    errorText.textContent = 'Please enter a test link.';
    input.focus();
    return;
  }

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
    Generating Code...
  `;

  try {
    const presetId = selectedPresetId();
    const body = { url: fullUrl };
    if (presetId === 'custom') {
      body.preset = {
        baseId: customPreset.baseId || 'level-2',
        grace: customPreset.grace,
        passThreshold: customPreset.passThreshold,
        violations: customPreset.violations,
      };
    } else {
      body.presetId = presetId;
    }

    const response = await fetch(`${API_BASE_URL}/codes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      errorText.textContent = data.error || 'Failed to generate code. Please try again.';
      return;
    }

    lastGeneratedCode = data.code;

    document.getElementById('codeText').textContent = data.code;
    document.getElementById('resultLink').textContent = data.url;
    document.getElementById('resultLink').title = data.url;
    document.getElementById('resultTime').textContent = new Date(data.createdAt).toLocaleString();
    const presetEl = document.getElementById('resultPreset');
    if (presetEl) presetEl.textContent = data.preset ? `${data.preset.name} (${data.presetId})` : (data.presetId || 'level-2');

    document.getElementById('step1').classList.add('hidden');
    document.getElementById('step2').classList.remove('hidden');
    document.getElementById('cardTitle').textContent = 'Code Generated!';
    document.getElementById('cardSubtitle').textContent = 'Your secure access gate is ready. Share it with your students.';

    showToast(`Access code ${data.code} generated successfully!`);
    await fetchAndRenderHistory();
  } catch (err) {
    errorText.textContent = 'Cannot connect to backend server. Verify service is running on http://localhost:3001.';
  } finally {
    generateBtn.disabled = false;
    generateBtn.innerHTML = originalBtnText;
  }
}

/* ── Code Clipboard Actions ──────────────────────────────────────────────── */
function copyCode() {
  const code = lastGeneratedCode;
  if (!code) return;
  copySpecificCode(code);
}

function copySpecificCode(code) {
  if (!code) return;
  navigator.clipboard.writeText(code)
    .then(() => showToast(`Code ${code} copied to clipboard!`))
    .catch(() => {
      const ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast(`Code ${code} copied to clipboard!`);
    });
}

function resetForm() {
  document.getElementById('linkInput').value = '';
  document.getElementById('errorText').textContent = '';
  document.getElementById('step1').classList.remove('hidden');
  document.getElementById('step2').classList.add('hidden');
  document.getElementById('cardTitle').textContent = 'Generate Assessment Code';
  document.getElementById('cardSubtitle').textContent = 'Paste any Google Form, LMS, or quiz URL to issue a secure 6-character access gate.';
  document.getElementById('linkInput').focus();
}

function showToast(msg) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2400);
}

/* ── Revoke Code Action ──────────────────────────────────────────────────── */
async function revokeCode(code) {
  if (!code) return;
  if (!confirm(`Are you sure you want to revoke code "${code}"? Students entering this code will be rejected.`)) {
    return;
  }

  try {
    const res = await fetch(`${API_BASE_URL}/codes/${encodeURIComponent(code)}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to revoke code.');
      return;
    }
    showToast(`Code ${code} has been revoked.`);
    await fetchAndRenderHistory();
  } catch (err) {
    showToast('Failed to revoke code: backend unreachable.');
  }
}

/* ── History Data Fetching & Table Rendering ─────────────────────────────── */
async function fetchAndRenderHistory() {
  let codes = [];
  let isOffline = false;

  try {
    const res = await fetch(`${API_BASE_URL}/codes?limit=50`);
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

  cachedCodes = codes || [];
  updateMetrics(cachedCodes);
  renderFilteredTable(isOffline);
}

function getFilteredCodes() {
  const query = (currentSearchQuery || '').trim().toLowerCase();
  const status = currentStatusFilter || 'all';

  return cachedCodes.filter(item => {
    const itemStatus = item.status || 'active';
    const matchesStatus = status === 'all' || itemStatus === status;
    if (!matchesStatus) return false;

    if (!query) return true;
    const codeMatch = (item.code || '').toLowerCase().includes(query);
    const urlMatch = (item.url || item.target_url || '').toLowerCase().includes(query);
    return codeMatch || urlMatch;
  });
}

function renderFilteredTable(isOffline = false) {
  const container = document.getElementById('historyTable');
  const countBadge = document.getElementById('tableCountBadge');
  if (!container) return;

  const filtered = getFilteredCodes();

  if (countBadge) {
    if (currentSearchQuery || currentStatusFilter !== 'all') {
      countBadge.textContent = `${filtered.length} of ${cachedCodes.length} Codes`;
    } else {
      countBadge.textContent = `${cachedCodes.length} Codes`;
    }
  }

  if (!filtered || filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>${cachedCodes.length === 0 
          ? (isOffline ? 'Offline — No cached codes found. Start server on :3001.' : 'No assessment codes generated yet.') 
          : 'No codes match your search criteria.'}
        </p>
      </div>
    `;
    return;
  }

  let html = '';
  if (isOffline) {
    html += '<p style="color:var(--warning, #D97706);font-size:0.78rem;padding:8px 16px;margin:0;">⚠️ Server unreachable — displaying locally cached codes.</p>';
  }

  html += `<table>
    <thead>
      <tr>
        <th>Code</th>
        <th>Assessment Link</th>
        <th>Strictness</th>
        <th>Status</th>
        <th>Joins</th>
        <th>Created</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>`;

  filtered.forEach(item => {
    const formattedDate = item.createdAt ? new Date(item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    const status = item.status || 'active';
    const presetLabel = { 'level-1': 'Relaxed (L1)', 'level-2': 'Standard (L2)', 'level-3': 'Strict (L3)', 'custom': 'Custom' }[item.presetId] || 'L2';
    const hits = item.hitCount || item.hit_count || 0;
    const isActive = status === 'active';

    html += `<tr>
      <td class="code-cell">
        <span>${item.code}</span>
      </td>
      <td class="link-cell">
        <a href="${item.url}" target="_blank" rel="noopener noreferrer" title="${item.url}">${item.url}</a>
      </td>
      <td>
        <span class="preset-chip">${presetLabel}</span>
      </td>
      <td>
        <span class="status-badge ${status}">${status}</span>
      </td>
      <td>
        <strong>${hits}</strong>
      </td>
      <td>
        <span style="color:var(--text-muted);font-size:0.8rem;">${formattedDate}</span>
      </td>
      <td>
        <div class="table-btn-group">
          <button class="table-btn" onclick="copySpecificCode('${item.code}')" title="Copy code">
            <!-- NeatIcons: copy.svg -->
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <path d="M8.25 11.89C8.25 9.342 9.342 8.25 11.89 8.25L16.61 8.25C19.158 8.25 20.25 9.342 20.25 11.89L20.25 16.61C20.25 19.158 19.158 20.25 16.61 20.25L11.89 20.25C9.342 20.25 8.25 19.158 8.25 16.61L8.25 11.89Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M15.75 8.25L15.75 7.39C15.75 4.842 14.658 3.75 12.11 3.75L7.39 3.75C4.842 3.75 3.75 4.842 3.75 7.39L3.75 12.11C3.75 14.658 4.842 15.75 7.39 15.75L8.25 15.75" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            </svg>
            Copy
          </button>
          ${isActive ? `
            <button class="table-btn danger" onclick="revokeCode('${item.code}')" title="Revoke code access">
              Revoke
            </button>
          ` : `
            <span style="font-size:0.72rem;color:var(--danger);font-weight:600;padding:4px 6px;">Revoked</span>
          `}
        </div>
      </td>
    </tr>`;
  });

  html += `</tbody></table>`;
  container.innerHTML = html;
}

/* ── Real-time Search Synchronization ────────────────────────────────────── */
function onSearchChanged(val) {
  currentSearchQuery = val;
  const topInput = document.getElementById('topSearchInput');
  const tableInput = document.getElementById('tableSearchInput');
  if (topInput && topInput.value !== val) topInput.value = val;
  if (tableInput && tableInput.value !== val) tableInput.value = val;
  renderFilteredTable();
}

/* ── Theme Switcher (Finexy Light / Matte Black Dark) ─────────────────────── */
function applyTheme(theme) {
  const finalTheme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', finalTheme);
  document.body.setAttribute('data-theme', finalTheme);
  try {
    localStorage.setItem('smartbrowser_theme', finalTheme);
  } catch {}

  const topToggle = document.getElementById('topThemeToggle');
  if (topToggle) {
    topToggle.classList.toggle('active', finalTheme === 'dark');
    topToggle.setAttribute('title', finalTheme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode');
  }

  const btnLight = document.getElementById('btnThemeLight');
  const btnDark = document.getElementById('btnThemeDark');
  if (btnLight) btnLight.classList.toggle('active', finalTheme === 'light');
  if (btnDark) btnDark.classList.toggle('active', finalTheme === 'dark');
}

function initTheme() {
  let saved = 'light';
  try {
    saved = localStorage.getItem('smartbrowser_theme') || 'light';
  } catch {}
  applyTheme(saved);

  const topToggle = document.getElementById('topThemeToggle');
  if (topToggle) {
    topToggle.addEventListener('click', () => {
      const current = document.body.getAttribute('data-theme') || 'light';
      applyTheme(current === 'light' ? 'dark' : 'light');
    });
  }

  const btnLight = document.getElementById('btnThemeLight');
  const btnDark = document.getElementById('btnThemeDark');
  if (btnLight) btnLight.addEventListener('click', () => applyTheme('light'));
  if (btnDark) btnDark.addEventListener('click', () => applyTheme('dark'));
}

/* ── DOM Initialization ──────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  updateDynamicGreeting();

  // Preset radio buttons
  document.querySelectorAll('input[name="preset"]').forEach(r => {
    r.addEventListener('change', syncCustomEditorVisibility);
  });

  // Custom preset editor controls
  const customBaseEl = document.getElementById('customBase');
  if (customBaseEl) {
    customBaseEl.addEventListener('change', (e) => {
      customPreset = deepClone(PRESET_DEFS[e.target.value]);
      customPreset.id = 'custom';
      customPreset.baseId = e.target.value;
      const graceEl = document.getElementById('customGrace');
      const passEl = document.getElementById('customPass');
      if (graceEl) {
        graceEl.value = customPreset.grace;
        document.getElementById('customGraceVal').textContent = customPreset.grace;
      }
      if (passEl) {
        passEl.value = customPreset.passThreshold;
        document.getElementById('customPassVal').textContent = customPreset.passThreshold;
      }
      renderCustomEditor();
    });
  }

  const customGraceEl = document.getElementById('customGrace');
  if (customGraceEl) {
    customGraceEl.addEventListener('input', (e) => {
      customPreset.grace = parseInt(e.target.value, 10);
      document.getElementById('customGraceVal').textContent = customPreset.grace;
      updateWhatIf();
    });
  }

  const customPassEl = document.getElementById('customPass');
  if (customPassEl) {
    customPassEl.addEventListener('input', (e) => {
      customPreset.passThreshold = parseInt(e.target.value, 10);
      document.getElementById('customPassVal').textContent = customPreset.passThreshold;
      updateWhatIf();
    });
  }

  const whatifEl = document.getElementById('whatifEvents');
  if (whatifEl) {
    whatifEl.addEventListener('input', updateWhatIf);
  }

  // Search input listeners
  const topSearch = document.getElementById('topSearchInput');
  if (topSearch) {
    topSearch.addEventListener('input', (e) => onSearchChanged(e.target.value));
  }

  const tableSearch = document.getElementById('tableSearchInput');
  if (tableSearch) {
    tableSearch.addEventListener('input', (e) => onSearchChanged(e.target.value));
  }

  // Status filter dropdown
  const statusFilter = document.getElementById('statusFilterSelect');
  if (statusFilter) {
    statusFilter.addEventListener('change', (e) => {
      currentStatusFilter = e.target.value;
      renderFilteredTable();
    });
  }

  // Navigation tab links
  document.querySelectorAll('.topbar-nav .nav-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const href = tab.getAttribute('href');
      if (href && href.startsWith('#')) {
        document.querySelectorAll('.topbar-nav .nav-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
      }
    });
  });

  // Notification button toast
  const notifBtn = document.getElementById('notificationBtn');
  if (notifBtn) {
    notifBtn.addEventListener('click', () => {
      showToast('Live monitoring: WebSocket service is active on :3001');
    });
  }

  // Fetch codes & initialize
  fetchAndRenderHistory();

  // Focus link input
  const linkInput = document.getElementById('linkInput');
  if (linkInput) linkInput.focus();
});
