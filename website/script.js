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

/* ── Platform Choices & Score Normalization State ─────────────────────────── */
let selectedPlatform = 'google-forms';
const PLATFORM_PLACEHOLDERS = {
  'google-forms': 'https://docs.google.com/forms/d/e/... or test link',
  'ms-forms': 'https://forms.office.com/r/... or test link',
  'quizizz': 'https://quizizz.com/join?... or Kahoot link',
  'canvas': 'https://canvas.instructure.com/courses/... or LMS link',
  'custom': 'https://your-testing-platform.com/... or any test URL'
};

function calculateNormalizedGrade(rawScore, fairnessScore, maxScore = 100, rule = 'multiplier') {
  const raw = Number(rawScore) || 0;
  const fairness = Number(fairnessScore) || 0;
  const max = Number(maxScore) || 100;
  let normalized = 0;

  switch (rule) {
    case 'weighted_80_20':
      normalized = (0.8 * raw) + (0.2 * (fairness / 100) * max);
      break;
    case 'penalty_deduction': {
      const deductionPct = Math.max(0, 100 - fairness);
      const pointsLost = (deductionPct / 100) * max;
      normalized = Math.max(0, raw - pointsLost);
      break;
    }
    case 'threshold_gate':
      normalized = fairness >= 70 ? raw : 0;
      break;
    case 'multiplier':
    default:
      normalized = raw * (fairness / 100);
      break;
  }

  normalized = Math.min(max, Math.max(0, Number(normalized.toFixed(1))));
  const gradePct = max > 0 ? Number(((normalized / max) * 100).toFixed(1)) : 0;
  const status = fairness >= 75 ? 'passed' : (fairness >= 50 ? 'flagged' : 'failed');

  return { normalizedScore: normalized, gradePct, status };
}

function updateNormPreview() {
  const rawSlider = document.getElementById('previewRawSlider');
  const fairnessSlider = document.getElementById('previewFairnessSlider');
  const maxInput = document.getElementById('maxScoreInput');
  const ruleSelect = document.getElementById('normRuleSelect');

  if (!rawSlider || !fairnessSlider || !maxInput || !ruleSelect) return;

  const max = Math.max(1, parseInt(maxInput.value, 10) || 100);
  rawSlider.max = max;
  if (parseInt(rawSlider.value, 10) > max) rawSlider.value = max;

  const raw = parseFloat(rawSlider.value) || 0;
  const fairness = parseFloat(fairnessSlider.value) || 0;
  const rule = ruleSelect.value;

  const { normalizedScore, gradePct, status } = calculateNormalizedGrade(raw, fairness, max, rule);

  const rawLabel = document.getElementById('previewRawScoreLabel');
  if (rawLabel) rawLabel.textContent = `${raw} / ${max} pts`;

  const fairnessLabel = document.getElementById('previewFairnessLabel');
  if (fairnessLabel) fairnessLabel.textContent = `${fairness}% (${status.charAt(0).toUpperCase() + status.slice(1)})`;

  const tagEl = document.getElementById('previewRuleTag');
  if (tagEl) {
    const names = {
      'multiplier': 'Multiplier',
      'weighted_80_20': 'Dual 80/20',
      'penalty_deduction': 'Penalty Subtraction',
      'threshold_gate': 'Threshold Gate'
    };
    tagEl.textContent = names[rule] || rule;
  }

  const descEl = document.getElementById('previewFormulaDesc');
  if (descEl) {
    const descs = {
      'multiplier': `Linear scaling: Student raw score (${raw}) × (${fairness}% / 100). Rewards consistent integrity.`,
      'weighted_80_20': `Hybrid grade: 80% weight on academic test (${(0.8 * raw).toFixed(1)} pts) + 20% weight on fairness index.`,
      'penalty_deduction': `Deduction: Subtracts ${(100 - fairness).toFixed(0)}% proctoring deduction directly from raw marks.`,
      'threshold_gate': `Strict barrier: Fairness ≥ 70% preserves full score (${raw}), below 70% zeroes the grade.`
    };
    descEl.textContent = descs[rule] || '';
  }

  const scoreEl = document.getElementById('previewTotalScore');
  if (scoreEl) scoreEl.textContent = normalizedScore;

  const denomEl = document.getElementById('previewTotalDenominator');
  if (denomEl) denomEl.textContent = `/ ${max} pts`;

  const gradeEl = document.getElementById('previewGradePct');
  if (gradeEl) gradeEl.textContent = `${gradePct}%`;

  const statusEl = document.getElementById('previewStatusBadge');
  if (statusEl) {
    statusEl.className = `status-badge ${status}`;
    statusEl.textContent = status;
  }
}

function initPlatformChips() {
  const chips = document.querySelectorAll('.platform-chip');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      selectedPlatform = chip.dataset.platform || 'google-forms';
      const input = document.getElementById('linkInput');
      if (input && PLATFORM_PLACEHOLDERS[selectedPlatform]) {
        input.placeholder = PLATFORM_PLACEHOLDERS[selectedPlatform];
      }
    });
  });
}

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
    const maxScore = Math.max(1, parseInt(document.getElementById('maxScoreInput')?.value, 10) || 100);
    const normalizationRule = document.getElementById('normRuleSelect')?.value || 'multiplier';

    const body = {
      url: fullUrl,
      platformType: selectedPlatform,
      maxScore: maxScore,
      normalizationRule: normalizationRule,
    };

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

    const platEl = document.getElementById('resultPlatform');
    if (platEl) {
      const platLabels = {
        'google-forms': 'Google Forms',
        'ms-forms': 'Microsoft Forms',
        'quizizz': 'Quizizz / Kahoot',
        'canvas': 'Canvas / LMS',
        'custom': 'Custom Platform'
      };
      platEl.textContent = platLabels[data.platformType] || data.platformType || selectedPlatform;
    }

    const normEl = document.getElementById('resultNormalization');
    if (normEl) {
      const normLabels = {
        'multiplier': 'Integrity Multiplier',
        'weighted_80_20': 'Dual Weighted (80/20)',
        'penalty_deduction': 'Penalty Deduction',
        'threshold_gate': 'Threshold Gate'
      };
      normEl.textContent = normLabels[data.normalizationRule] || data.normalizationRule || normalizationRule;
    }

    document.getElementById('step1').classList.add('hidden');
    document.getElementById('step2').classList.remove('hidden');
    document.getElementById('cardTitle').textContent = 'Code Generated!';
    document.getElementById('cardSubtitle').textContent = 'Your secure access gate is ready. Share it with your students.';

    showToast(`Access code ${data.code} generated successfully!`);
    await fetchAndRenderHistory();
    await fetchAndRenderReports();
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
  updateNormPreview();
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

  // Initialize Platform Choice Chips & Normalization Preview
  initPlatformChips();
  updateNormPreview();

  const maxInput = document.getElementById('maxScoreInput');
  if (maxInput) maxInput.addEventListener('input', updateNormPreview);

  const normSelect = document.getElementById('normRuleSelect');
  if (normSelect) normSelect.addEventListener('change', updateNormPreview);

  const rawSlider = document.getElementById('previewRawSlider');
  if (rawSlider) rawSlider.addEventListener('input', updateNormPreview);

  const fairnessSlider = document.getElementById('previewFairnessSlider');
  if (fairnessSlider) fairnessSlider.addEventListener('input', updateNormPreview);

  // Session Reports Listeners
  const repSearch = document.getElementById('reportSearchInput');
  if (repSearch) {
    repSearch.addEventListener('input', (e) => {
      currentReportSearch = e.target.value;
      renderReportsTable();
    });
  }

  const repCode = document.getElementById('reportCodeFilter');
  if (repCode) {
    repCode.addEventListener('change', (e) => {
      currentReportCode = e.target.value;
      renderReportsTable();
    });
  }

  const repStatus = document.getElementById('reportStatusFilter');
  if (repStatus) {
    repStatus.addEventListener('change', (e) => {
      currentReportStatus = e.target.value;
      renderReportsTable();
    });
  }

  const repRefresh = document.getElementById('refreshReportsBtn');
  if (repRefresh) {
    repRefresh.addEventListener('click', () => {
      fetchAndRenderReports();
      showToast('Refreshing student session reports...');
    });
  }

  const repExport = document.getElementById('exportCsvBtn');
  if (repExport) {
    repExport.addEventListener('click', exportReportsCsv);
  }

  // Fetch session reports
  fetchAndRenderReports();

  // Focus link input
  const linkInput = document.getElementById('linkInput');
  if (linkInput) linkInput.focus();
});

/* ── Session Reports & Normalized Grades Management ─────────────────────── */
let cachedSessions = [];
let currentReportSearch = '';
let currentReportCode = 'all';
let currentReportStatus = 'all';

async function fetchAndRenderReports() {
  let sessions = [];
  try {
    const res = await fetch(`${API_BASE_URL}/sessions?limit=100`);
    if (res.ok) {
      sessions = await res.json();
    }
  } catch (err) {
    console.warn('Could not fetch sessions from server:', err);
  }

  cachedSessions = sessions || [];
  populateReportCodeFilter();
  updateReportsSummary();
  renderReportsTable();
}

function populateReportCodeFilter() {
  const select = document.getElementById('reportCodeFilter');
  if (!select) return;

  const currentVal = select.value;
  const uniqueCodes = Array.from(new Set(cachedSessions.map(s => s.code).filter(Boolean)));

  select.innerHTML = '<option value="all">All Assessments</option>';
  uniqueCodes.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = `Code: ${c}`;
    if (c === currentVal) opt.selected = true;
    select.appendChild(opt);
  });
}

function updateReportsSummary() {
  const totalEl = document.getElementById('repSummaryTotal');
  const fairnessEl = document.getElementById('repSummaryFairness');
  const gradeEl = document.getElementById('repSummaryGrade');
  const passRateEl = document.getElementById('repSummaryPassRate');
  const badgeEl = document.getElementById('reportCountBadge');

  const total = cachedSessions.length;
  if (badgeEl) badgeEl.textContent = `${total} Submissions`;
  if (totalEl) totalEl.textContent = total;

  if (total === 0) {
    if (fairnessEl) fairnessEl.textContent = '—';
    if (gradeEl) gradeEl.textContent = '—';
    if (passRateEl) passRateEl.textContent = '—';
    return;
  }

  const avgFairness = cachedSessions.reduce((acc, s) => acc + (s.fairness_score || 0), 0) / total;
  const scoredSessions = cachedSessions.filter(s => s.normalized_score !== null && s.normalized_score !== undefined);
  const avgGrade = scoredSessions.length > 0
    ? (scoredSessions.reduce((acc, s) => acc + (s.normalized_score || 0), 0) / scoredSessions.length).toFixed(1) + ' pts'
    : '—';
  const passedCount = cachedSessions.filter(s => s.status === 'passed').length;
  const passRate = ((passedCount / total) * 100).toFixed(1);

  if (fairnessEl) fairnessEl.textContent = `${avgFairness.toFixed(1)}%`;
  if (gradeEl) gradeEl.textContent = avgGrade;
  if (passRateEl) passRateEl.textContent = `${passRate}%`;
}

function getFilteredSessions() {
  const query = (currentReportSearch || '').trim().toLowerCase();
  const codeFilter = currentReportCode || 'all';
  const statusFilter = currentReportStatus || 'all';

  return cachedSessions.filter(item => {
    if (codeFilter !== 'all' && item.code !== codeFilter) return false;
    if (statusFilter !== 'all' && item.status !== statusFilter) return false;

    if (!query) return true;
    const nameMatch = (item.student_name || '').toLowerCase().includes(query);
    const idMatch = (item.student_id || '').toLowerCase().includes(query);
    const codeMatch = (item.code || '').toLowerCase().includes(query);
    return nameMatch || idMatch || codeMatch;
  });
}

function renderReportsTable() {
  const container = document.getElementById('reportsTableWrap');
  if (!container) return;

  const filtered = getFilteredSessions();

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>${cachedSessions.length === 0 
          ? 'No student sessions recorded yet. Launch assessments to collect fairness scores.' 
          : 'No student sessions match the selected filters.'}
        </p>
      </div>
    `;
    return;
  }

  let html = `<table>
    <thead>
      <tr>
        <th>Candidate</th>
        <th>Assessment</th>
        <th>Platform</th>
        <th>Raw Score</th>
        <th>Fairness Index</th>
        <th>Total Grade</th>
        <th>Status</th>
        <th>Submitted</th>
        <th>Audit</th>
      </tr>
    </thead>
    <tbody>`;

  filtered.forEach(s => {
    const formattedDate = s.submitted_at || s.created_at
      ? new Date(s.submitted_at || s.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '—';

    const platLabels = {
      'google-forms': 'Google Forms',
      'ms-forms': 'MS Forms',
      'quizizz': 'Quizizz',
      'canvas': 'Canvas',
      'custom': 'Custom'
    };
    const platformDisplay = platLabels[s.platform_type] || s.platform_type || 'Google Forms';
    const status = s.status || 'passed';
    const rawDisplay = s.raw_score !== null && s.raw_score !== undefined ? `${s.raw_score} / ${s.max_score}` : `<span style="color:var(--text-dim)">Pending</span>`;
    const normDisplay = s.normalized_score !== null && s.normalized_score !== undefined ? `${s.normalized_score} / ${s.max_score}` : `<span style="color:var(--text-dim)">—</span>`;

    html += `<tr>
      <td>
        <div style="display:flex;flex-direction:column;gap:2px;">
          <strong style="color:var(--text-primary);font-size:0.86rem;">${escapeHtml(s.student_name || 'Anonymous Candidate')}</strong>
          <span style="font-size:0.72rem;color:var(--text-muted);font-family:var(--font-mono);">${escapeHtml(s.student_id || 'ID: —')}</span>
        </div>
      </td>
      <td class="code-cell">
        <span>${escapeHtml(s.code)}</span>
      </td>
      <td>
        <span class="preset-chip">${escapeHtml(platformDisplay)}</span>
      </td>
      <td>
        <span style="font-family:var(--font-mono);font-size:0.82rem;font-weight:700;">${rawDisplay}</span>
      </td>
      <td>
        <span style="font-family:var(--font-mono);font-size:0.84rem;font-weight:800;color:var(--c-yellow);">${s.fairness_score}%</span>
      </td>
      <td>
        <strong style="font-family:var(--font-mono);font-size:0.86rem;color:var(--text-primary);">${normDisplay}</strong>
      </td>
      <td>
        <span class="status-badge ${status}">${status}</span>
      </td>
      <td>
        <span style="color:var(--text-muted);font-size:0.78rem;">${formattedDate}</span>
      </td>
      <td>
        <button class="table-btn" onclick="openAuditModal(${s.id})" title="Inspect fairness deductions and update score">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <path d="M2.75 12L6.267 12C6.78 12 7.074 11.793 7.247 11.31L8.521 7.742C9.206 5.823 9.794 5.823 10.479 7.742L13.521 16.258C14.206 18.177 14.794 18.177 15.479 16.258L16.753 12.69C16.926 12.207 17.22 12 17.733 12L21.25 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Audit
        </button>
      </td>
    </tr>`;
  });

  html += `</tbody></table>`;
  container.innerHTML = html;
}

function exportReportsCsv() {
  const filtered = getFilteredSessions();
  if (filtered.length === 0) {
    showToast('No sessions available to export.');
    return;
  }

  const headers = [
    'Session ID', 'Student Name', 'Student ID', 'Student Email',
    'Assessment Code', 'Platform', 'Raw Score', 'Max Score',
    'Fairness Score %', 'Normalized Score', 'Status',
    'Started At', 'Submitted At', 'Duration Seconds', 'Violations Count'
  ];

  const rows = filtered.map(s => [
    s.id,
    `"${(s.student_name || '').replace(/"/g, '""')}"`,
    `"${(s.student_id || '').replace(/"/g, '""')}"`,
    `"${(s.student_email || '').replace(/"/g, '""')}"`,
    s.code,
    s.platform_type || 'google-forms',
    s.raw_score !== null && s.raw_score !== undefined ? s.raw_score : '',
    s.max_score || 100,
    s.fairness_score,
    s.normalized_score !== null && s.normalized_score !== undefined ? s.normalized_score : '',
    s.status,
    s.started_at || '',
    s.submitted_at || '',
    s.duration_seconds || 0,
    s.violations_count || 0
  ]);

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `SmartBrowser_Report_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast(`Exported ${filtered.length} session records to CSV.`);
}

async function openAuditModal(sessionId) {
  const session = cachedSessions.find(s => s.id === sessionId);
  if (!session) return;

  const modal = document.getElementById('auditModalBackdrop');
  const nameEl = document.getElementById('modalStudentName');
  const metaEl = document.getElementById('modalStudentMeta');
  const contentEl = document.getElementById('auditModalContent');

  if (nameEl) nameEl.textContent = `${session.student_name || 'Candidate'} — Session Report`;
  if (metaEl) {
    const mins = Math.floor((session.duration_seconds || 0) / 60);
    const secs = (session.duration_seconds || 0) % 60;
    metaEl.textContent = `Code: ${session.code} • Duration: ${mins}m ${secs}s • Platform: ${session.platform_type || 'google-forms'}`;
  }

  let violations = {};
  try {
    violations = typeof session.violations_summary === 'string' ? JSON.parse(session.violations_summary) : (session.violations_summary || {});
  } catch {}

  let logs = [];
  try {
    logs = typeof session.url_logs === 'string' ? JSON.parse(session.url_logs) : (session.url_logs || []);
  } catch {}

  const rawVal = session.raw_score !== null && session.raw_score !== undefined ? session.raw_score : '';

  contentEl.innerHTML = `
    <!-- Top KPIs -->
    <div class="audit-overview-grid">
      <div class="audit-metric-box">
        <span class="audit-metric-lbl">Fairness Integrity Score</span>
        <span class="audit-metric-val" style="color:var(--c-yellow);">${session.fairness_score}%</span>
      </div>
      <div class="audit-metric-box">
        <span class="audit-metric-lbl">Normalized Total Grade</span>
        <span class="audit-metric-val">${session.normalized_score !== null && session.normalized_score !== undefined ? session.normalized_score : '—'} / ${session.max_score}</span>
      </div>
      <div class="audit-metric-box">
        <span class="audit-metric-lbl">Session Integrity Status</span>
        <span class="status-badge ${session.status}">${session.status}</span>
      </div>
    </div>

    <!-- Raw Score Editor & Normalizer Sync -->
    <div class="grade-editor-box">
      <div class="grade-editor-head">
        <div>
          <strong style="color:var(--text-primary);font-size:0.86rem;">Exam Raw Marks &amp; Normalization</strong>
          <p style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">
            Update raw test marks fetched from ${escapeHtml(session.platform_type || 'Google Forms')}. Normalized score will recalculate instantly.
          </p>
        </div>
        <span class="norm-formula-tag">${escapeHtml(session.normalization_rule || 'multiplier')}</span>
      </div>
      <div class="grade-editor-inputs">
        <div class="grade-input-wrap">
          <label style="font-size:0.78rem;font-weight:700;color:var(--text-secondary);">Raw Score:</label>
          <input type="number" id="modalRawInput" value="${rawVal}" min="0" max="${session.max_score}" step="0.5" placeholder="85" />
          <span style="font-size:0.78rem;color:var(--text-muted);font-weight:600;">/ ${session.max_score} pts</span>
        </div>
        <button class="btn-update-score" onclick="updateSessionRawScore(${session.id})">
          Save &amp; Recalculate
        </button>
      </div>
    </div>

    <!-- Proctoring Violations Breakdown -->
    <div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <strong style="font-size:0.82rem;color:var(--text-primary);text-transform:uppercase;letter-spacing:0.05em;">
          Proctoring Violations Log (${session.violations_count || 0} Total Events)
        </strong>
      </div>
      <div class="violations-list-box">
        ${renderViolationRows(violations)}
      </div>
    </div>

    <!-- Visited URLs / Navigation Audit -->
    <div>
      <strong style="font-size:0.82rem;color:var(--text-primary);text-transform:uppercase;letter-spacing:0.05em;display:block;margin-bottom:8px;">
        Assessment URL Timeline
      </strong>
      <div class="url-log-box">
        ${logs.length > 0 ? logs.map(l => `<div>• ${escapeHtml(typeof l === 'string' ? l : JSON.stringify(l))}</div>`).join('') : '<span style="color:var(--text-dim)">No external link deviations detected.</span>'}
      </div>
    </div>
  `;

  modal.classList.remove('hidden');
}

async function updateSessionRawScore(sessionId) {
  const input = document.getElementById('modalRawInput');
  if (!input) return;

  const rawVal = parseFloat(input.value);
  if (isNaN(rawVal)) {
    showToast('Please enter a valid raw score number.');
    return;
  }

  try {
    const res = await fetch(`${API_BASE_URL}/sessions/${sessionId}/raw-score`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawScore: rawVal })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to update raw score.');
      return;
    }

    const newNorm = data.normalizedScore !== undefined ? data.normalizedScore : (data.session ? data.session.normalized_score : '');
    showToast(`Updated! New normalized grade: ${newNorm} pts`);
    const idx = cachedSessions.findIndex(s => s.id === sessionId);
    if (idx !== -1) {
      if (data.session) {
        cachedSessions[idx] = data.session;
      } else {
        cachedSessions[idx].raw_score = data.rawScore;
        cachedSessions[idx].normalized_score = data.normalizedScore;
      }
    }
    updateReportsSummary();
    renderReportsTable();
    openAuditModal(sessionId);
  } catch (err) {
    showToast('Cannot connect to server to update score.');
  }
}

function renderViolationRows(violations) {
  const meta = {
    'multiple-faces': 'Multiple Faces Detected',
    'face': 'No Face In Frame',
    'gaze': 'Looking Away / Off-Screen',
    'focus': 'Tab Switch / Window Blur',
    'fullscreen': 'Fullscreen Mode Exited',
    'obstacle': 'Prohibited Object Detected'
  };

  const keys = Object.keys(meta);
  let html = '';

  keys.forEach(k => {
    const count = violations[k] || 0;
    html += `
      <div class="violation-row-item">
        <span class="violation-item-name">
          <span style="width:7px;height:7px;border-radius:50%;background:${count > 0 ? 'var(--danger)' : 'var(--success)'};display:inline-block;"></span>
          ${meta[k]}
        </span>
        <span class="${count > 0 ? 'violation-item-badge' : 'stat-pill'}">
          ${count} ${count === 1 ? 'event' : 'events'}
        </span>
      </div>
    `;
  });

  return html;
}

function closeAuditModal() {
  const modal = document.getElementById('auditModalBackdrop');
  if (modal) modal.classList.add('hidden');
}

function handleBackdropClick(e) {
  if (e.target.id === 'auditModalBackdrop') {
    closeAuditModal();
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
