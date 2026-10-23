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
  } catch {
  }
}

let lastGeneratedCode = '';

// ── Proctoring preset editor (Custom) ───────────────────────────────────────
// Local mirror of the built-in presets (kept in sync with
// src/engine/proctoringPresets.js) so the website can offer a full custom
// editor without importing app internals.
const PRESET_DEFS = {
  'level-1': { name: 'Relaxed', passThreshold: 50, grace: 3, violations: {
    'multiple-faces': { enabled: true,  priority: 'HIGH', deduction: 15, dwellMs: 3000, cooldownMs: 5000 },
    'face':           { enabled: true,  priority: 'HIGH', deduction: 8,  dwellMs: 5000, cooldownMs: 5000 },
    'gaze':           { enabled: false, priority: 'MEDIUM_HIGH', deduction: 8, dwellMs: 1500, cooldownMs: 5000 },
    'focus':          { enabled: true,  priority: 'MEDIUM', deduction: 5,  dwellMs: 2000, cooldownMs: 2000 },
    'fullscreen':     { enabled: true,  priority: 'MEDIUM', deduction: 5,  dwellMs: 1000, cooldownMs: 5000 },
    'obstacle':       { enabled: false, priority: 'MEDIUM', deduction: 10, dwellMs: 800,  cooldownMs: 5000 },
  }},
  'level-2': { name: 'Standard', passThreshold: 70, grace: 1, violations: {
    'multiple-faces': { enabled: true, priority: 'HIGH',        deduction: 20, dwellMs: 3000, cooldownMs: 5000 },
    'face':           { enabled: true, priority: 'HIGH',        deduction: 15, dwellMs: 3000, cooldownMs: 5000 },
    'gaze':           { enabled: true, priority: 'MEDIUM_HIGH', deduction: 12, dwellMs: 1500, cooldownMs: 5000 },
    'focus':          { enabled: true, priority: 'MEDIUM',      deduction: 10, dwellMs: 2000, cooldownMs: 2000 },
    'fullscreen':     { enabled: true, priority: 'MEDIUM',      deduction: 10, dwellMs: 1000, cooldownMs: 5000 },
    'obstacle':       { enabled: true, priority: 'MEDIUM',      deduction: 8,  dwellMs: 1000, cooldownMs: 5000 },
  }},
  'level-3': { name: 'Strict', passThreshold: 85, grace: 0, violations: {
    'multiple-faces': { enabled: true, priority: 'HIGH',        deduction: 30, dwellMs: 2000, cooldownMs: 4000 },
    'face':           { enabled: true, priority: 'HIGH',        deduction: 20, dwellMs: 2000, cooldownMs: 4000 },
    'gaze':           { enabled: true, priority: 'MEDIUM_HIGH', deduction: 15, dwellMs: 1000, cooldownMs: 4000 },
    'focus':          { enabled: true, priority: 'MEDIUM',      deduction: 20, dwellMs: 1500, cooldownMs: 1500 },
    'fullscreen':     { enabled: true, priority: 'MEDIUM',      deduction: 20, dwellMs: 800,  cooldownMs: 4000 },
    'obstacle':       { enabled: true, priority: 'MEDIUM',      deduction: 20, dwellMs: 500,  cooldownMs: 4000 },
  }},
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

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

// Recompute fairness score for N events of each enabled type with grace.
function simulatePreset(preset, events) {
  const types = Object.keys(preset.violations).filter(t => preset.violations[t].enabled);
  const totalPri = types.reduce((s, t) => s + (PRIORITY_VALUES[preset.violations[t].priority] || 1), 0);
  let total = 0;
  const rows = types.map(t => {
    const v = preset.violations[t];
    const weight = (PRIORITY_VALUES[v.priority] || 1) / totalPri;
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
  const events = parseInt(document.getElementById('whatifEvents').value, 10);
  document.getElementById('whatifEventsVal').textContent = events;
  const { total, rows } = simulatePreset(customPreset, events);
  const flag = total < customPreset.passThreshold;
  const parts = rows.map(r => `${VIOLATION_META[r.t]} ${r.score}`).join(' · ');
  document.getElementById('whatifResult').innerHTML =
    `<span class="whatif-score ${flag ? 'flag' : 'ok'}">${Math.round(total)}</span>` +
    `<span class="whatif-flag">${flag ? `⚠ below ${customPreset.passThreshold} → flagged` : `✓ above ${customPreset.passThreshold} pass threshold`}</span>` +
    `<div class="whatif-detail">${parts}</div>`;
}

function selectedPresetId() {
  return (document.querySelector('input[name="preset"]:checked') || {}).value || 'level-2';
}

function syncCustomEditorVisibility() {
  const editor = document.getElementById('customEditor');
  const isCustom = selectedPresetId() === 'custom';
  editor.classList.toggle('hidden', !isCustom);
  if (isCustom) renderCustomEditor();
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('input[name="preset"]').forEach(r => r.addEventListener('change', syncCustomEditorVisibility));
  document.getElementById('customBase').addEventListener('change', (e) => {
    customPreset = deepClone(PRESET_DEFS[e.target.value]);
    customPreset.id = 'custom';
    customPreset.baseId = e.target.value;
    document.getElementById('customGrace').value = customPreset.grace;
    document.getElementById('customGraceVal').textContent = customPreset.grace;
    document.getElementById('customPass').value = customPreset.passThreshold;
    document.getElementById('customPassVal').textContent = customPreset.passThreshold;
    renderCustomEditor();
  });
  document.getElementById('customGrace').addEventListener('input', (e) => {
    customPreset.grace = parseInt(e.target.value, 10);
    document.getElementById('customGraceVal').textContent = customPreset.grace;
    updateWhatIf();
  });
  document.getElementById('customPass').addEventListener('input', (e) => {
    customPreset.passThreshold = parseInt(e.target.value, 10);
    document.getElementById('customPassVal').textContent = customPreset.passThreshold;
    updateWhatIf();
  });
  document.getElementById('whatifEvents').addEventListener('input', updateWhatIf);
  // init global slider labels
  document.getElementById('customGrace').value = customPreset.grace;
  document.getElementById('customGraceVal').textContent = customPreset.grace;
  document.getElementById('customPass').value = customPreset.passThreshold;
  document.getElementById('customPassVal').textContent = customPreset.passThreshold;
});

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
    Generating...
  `;

  try {
    const presetId = selectedPresetId();
    const body = { url: fullUrl };
    if (presetId === 'custom') {
      // Send the fully-edited custom profile; the server validates each field.
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
      headers: {
        'Content-Type': 'application/json',
      },
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
    document.getElementById('cardSubtitle').textContent =
      'Your test code is ready. Share it with your students.';

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

  html += '<table><thead><tr><th>Code</th><th>Link</th><th>Level</th><th>Status</th><th>Created</th></tr></thead><tbody>';
  codes.forEach((item) => {
    const formattedDate = item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '';
    const statusColor = item.status === 'active' ? '#10b981' : item.status === 'revoked' ? '#ef4444' : '#f59e0b';
    const presetLabel = { 'level-1': 'L1', 'level-2': 'L2', 'level-3': 'L3', 'custom': 'Custom' }[item.presetId] || 'L2';

    html += `<tr>
      <td class="code-cell" title="${item.code}">${item.code}</td>
      <td class="link-cell" title="${item.url}">${item.url}</td>
      <td><span style="display:inline-block;padding:2px 8px;border-radius:8px;font-size:0.72rem;font-weight:700;background:rgba(56,189,248,0.12);color:#38bdf8">${presetLabel}</span></td>
      <td><span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:600;background:rgba(255,255,255,0.06);color:${statusColor}">${item.status || 'active'}</span></td>
      <td>${formattedDate}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

document.addEventListener('DOMContentLoaded', () => {
  renderHistory();
  document.getElementById('linkInput').focus();
});
