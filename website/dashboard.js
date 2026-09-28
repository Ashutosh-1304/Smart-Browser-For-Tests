/**
 * Smart Browser — Invigilator Sidecar Console (Approach A)
 * WebSocket client, live grid rendering, and Veyon bridge action dispatching.
 */

(function () {
  'use strict';

  // --- State ---
  let ws = null;
  let students = [];
  let actions = [];
  let bridgeStatus = { mockMode: true, isCliAvailable: false };
  let autoRules = { enabled: true, autoLockThreshold: 50, autoWarnThreshold: 70, cooldownSeconds: 30 };
  let selectedStudentId = null;
  let activeFilter = 'all';
  let searchQuery = '';
  let pendingMessageStudentId = null;

  // --- DOM Elements ---
  const wsIndicator = document.getElementById('wsStatusIndicator');
  const wsText = document.getElementById('wsStatusText');
  const bridgeText = document.getElementById('bridgeStatusText');
  const studentGrid = document.getElementById('studentGrid');
  const emptyState = document.getElementById('emptyState');
  const searchInput = document.getElementById('searchInput');
  const auditDrawer = document.getElementById('auditDrawer');
  const terminalLog = document.getElementById('terminalLog');
  const auditCount = document.getElementById('auditCount');

  // Metrics
  const mActive = document.getElementById('metricActiveCount');
  const mFlagged = document.getElementById('metricFlaggedCount');
  const mLocked = document.getElementById('metricLockedCount');
  const mAvg = document.getElementById('metricAvgScore');

  // Filter counters
  const fAll = document.getElementById('filterAllCount');
  const fOnline = document.getElementById('filterOnlineCount');
  const fFlagged = document.getElementById('filterFlaggedCount');
  const fLocked = document.getElementById('filterLockedCount');

  // Modals
  const modalRules = document.getElementById('modalAutoRules');
  const modalInspector = document.getElementById('modalInspector');
  const modalMessage = document.getElementById('modalMessage');
  const modalScreenshot = document.getElementById('modalScreenshot');

  // --- WebSocket Connection ---
  function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws/dashboard?role=dashboard`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      wsIndicator.classList.add('connected');
      wsText.textContent = 'Live Monitored';
      logTerminal('system', 'Connected to Central Integrity WebSocket.');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleWsMessage(msg);
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };

    ws.onclose = () => {
      wsIndicator.classList.remove('connected');
      wsText.textContent = 'Reconnecting...';
      logTerminal('warn', 'WebSocket disconnected. Retrying in 2.5s...');
      setTimeout(connectWebSocket, 2500);
    };

    ws.onerror = () => {
      wsIndicator.classList.remove('connected');
      wsText.textContent = 'Connection Error';
    };
  }

  // --- Message Dispatcher ---
  function handleWsMessage(msg) {
    const { type, payload } = msg;

    switch (type) {
      case 'snapshot':
        students = payload.students || [];
        actions = payload.actions || [];
        if (payload.bridgeStatus) updateBridgeStatus(payload.bridgeStatus);
        render();
        renderAuditLogs();
        break;

      case 'student:joined':
        upsertStudent(payload);
        logTerminal('info', `Candidate connected: ${payload.studentName} (${payload.studentId}) on host ${payload.hostname}`);
        render();
        break;

      case 'student:telemetry':
      case 'student:updated':
        upsertStudent(payload);
        render();
        if (selectedStudentId === payload.studentId) renderInspector(payload);
        break;

      case 'student:violation':
        upsertStudent(payload.student);
        logTerminal('violation', `[${payload.student.studentName}] Violation: ${payload.violation.message}`);
        render();
        if (selectedStudentId === payload.studentId) renderInspector(payload.student);
        break;

      case 'student:removed':
        students = students.filter(s => s.studentId !== payload.studentId);
        render();
        break;

      case 'action:logged':
        actions.unshift(payload);
        if (actions.length > 500) actions.pop();
        logTerminal(payload.simulated ? 'simulated' : 'action', `[${payload.action.toUpperCase()}] Host: ${payload.host} -> ${payload.command}`);
        auditCount.textContent = actions.length;
        break;

      case 'rules:updated':
        autoRules = payload;
        syncRulesToUi();
        logTerminal('system', `Auto-rules updated: Lock < ${autoRules.autoLockThreshold}, Warn < ${autoRules.autoWarnThreshold}`);
        break;

      case 'screenshot:captured':
        if (payload.screenshotUrl) {
          showScreenshotModal(payload.screenshotUrl, payload.studentId);
        }
        break;

      case 'autorules:triggered':
        payload.results.forEach(res => {
          logTerminal('autorule', `⚡ [Auto-Rule Triggered] ${payload.studentName}: ${res.action.toUpperCase()} (${res.reason})`);
        });
        break;

      default:
        break;
    }
  }

  function upsertStudent(data) {
    const idx = students.findIndex(s => s.studentId === data.studentId);
    if (idx >= 0) {
      students[idx] = { ...students[idx], ...data };
    } else {
      students.unshift(data);
    }
  }

  function updateBridgeStatus(status) {
    bridgeStatus = status;
    const isMock = status.mockMode;
    bridgeText.textContent = isMock ? 'Veyon: Simulated LAN' : 'Veyon-CLI: Detected';
    const chk = document.getElementById('chkMockMode');
    if (chk) chk.checked = isMock;
  }

  // --- Rendering ---
  function render() {
    updateMetrics();

    const filtered = filterStudents();
    if (filtered.length === 0) {
      studentGrid.style.display = 'none';
      emptyState.style.display = 'block';
      return;
    }

    studentGrid.style.display = 'grid';
    emptyState.style.display = 'none';

    // Diff / Render tiles
    studentGrid.innerHTML = filtered.map(createStudentCardHtml).join('');
    bindCardEvents();
  }

  function filterStudents() {
    const q = searchQuery.toLowerCase().trim();
    return students.filter(s => {
      // Query filter
      if (q) {
        const matchesName = (s.studentName || '').toLowerCase().includes(q);
        const matchesId = (s.studentId || '').toLowerCase().includes(q);
        const matchesHost = (s.hostname || '').toLowerCase().includes(q);
        const matchesCode = (s.testCode || '').toLowerCase().includes(q);
        if (!matchesName && !matchesId && !matchesHost && !matchesCode) return false;
      }

      // Tab filter
      if (activeFilter === 'online') return s.status === 'online';
      if (activeFilter === 'flagged') return s.fairnessScore < 70;
      if (activeFilter === 'locked') return s.status === 'locked';
      return true;
    });
  }

  function updateMetrics() {
    const active = students.filter(s => s.status === 'online').length;
    const flagged = students.filter(s => s.fairnessScore < 70).length;
    const locked = students.filter(s => s.status === 'locked').length;
    
    let avg = 100;
    if (students.length > 0) {
      const sum = students.reduce((acc, s) => acc + (s.fairnessScore ?? 100), 0);
      avg = Math.round(sum / students.length);
    }

    mActive.textContent = active;
    mFlagged.textContent = flagged;
    mLocked.textContent = locked;
    mAvg.textContent = `${avg}%`;

    fAll.textContent = students.length;
    fOnline.textContent = active;
    fFlagged.textContent = flagged;
    fLocked.textContent = locked;
    auditCount.textContent = actions.length;
  }

  function createStudentCardHtml(s) {
    const score = s.fairnessScore ?? 100;
    const scoreClass = score >= 80 ? 'good' : score >= 50 ? 'warn' : 'bad';
    const cardStatusClass = s.status === 'locked' ? 'is-locked' : score < 50 ? 'status-critical' : score < 70 ? 'status-flagged' : '';
    
    // Status badge
    let statusBadge = `<span class="card-status-badge badge-online">● Online</span>`;
    if (s.status === 'locked') {
      statusBadge = `<span class="card-status-badge badge-locked">🔒 Locked</span>`;
    } else if (s.status === 'offline') {
      statusBadge = `<span class="card-status-badge badge-offline">○ Offline</span>`;
    }

    // Telemetry items
    const faceText = s.faceDetected === 0 ? 'No Face' : s.faceDetected > 1 ? `${s.faceDetected} Faces` : '1 Face';
    const faceFlag = s.faceDetected !== 1;

    const isAway = s.gazeState && s.gazeState.isLookingAway;
    const gazeText = isAway ? `Away (${s.gazeState.direction || 'Gaze'})` : 'Gaze: Screen';
    
    const obsCount = s.obstaclesCount || 0;
    const obsText = obsCount > 0 ? `${obsCount} Object` : 'No Objects';

    const focusText = s.focused ? 'Focused' : 'Tab Switched';
    const focusFlag = !s.focused;

    // Recent violation
    let violationHtml = `<div class="no-violations">✓ No recent integrity flags</div>`;
    if (s.violations && s.violations.length > 0) {
      const latest = s.violations[0];
      violationHtml = `
        <div class="violation-snippet" title="${escapeHtml(latest.message)}">
          <span>⚠️ ${escapeHtml(latest.message.slice(0, 32))}${latest.message.length > 32 ? '...' : ''}</span>
          <span class="time">${latest.time || ''}</span>
        </div>
      `;
    }

    const host = s.hostname || s.ip || '127.0.0.1';

    return `
      <div class="student-card ${cardStatusClass}" data-id="${s.studentId}">
        <div class="card-header">
          <div class="candidate-profile">
            <div class="avatar">${escapeHtml((s.studentName || 'S').charAt(0).toUpperCase())}</div>
            <div class="candidate-info">
              <h4>${escapeHtml(s.studentName || 'Student')}</h4>
              <div class="candidate-id-badge">${escapeHtml(s.studentId)} • ${escapeHtml(s.testCode || 'TEST')}</div>
            </div>
          </div>
          <div>${statusBadge}</div>
        </div>

        <div class="host-mapping-bar">
          <div class="host-label">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
              <line x1="8" y1="21" x2="16" y2="21"/>
              <line x1="12" y1="17" x2="12" y2="21"/>
            </svg>
            <span>Host: <strong>${escapeHtml(host)}</strong></span>
          </div>
          <button class="btn-edit-host" data-action="edit-host" data-id="${s.studentId}">Edit</button>
        </div>

        <div class="score-row">
          <div class="score-metric">
            <div class="score-number ${scoreClass}">${score}</div>
            <div class="score-title">Fairness Score</div>
          </div>
          <div class="telemetry-matrix">
            <div class="telemetry-chip ${faceFlag ? 'flag' : ''}">👤 ${faceText}</div>
            <div class="telemetry-chip ${isAway ? 'flag' : ''}">👀 ${gazeText}</div>
            <div class="telemetry-chip ${obsCount > 0 ? 'flag' : ''}">📦 ${obsText}</div>
            <div class="telemetry-chip ${focusFlag ? 'flag' : ''}">🖥️ ${focusText}</div>
          </div>
        </div>

        ${violationHtml}

        <div class="card-actions">
          ${s.status === 'locked' 
            ? `<button class="act-unlock" data-action="unlock" data-id="${s.studentId}" title="Unlock Student Screen">🔓 Unlock</button>`
            : `<button class="act-lock" data-action="lock" data-id="${s.studentId}" title="Lock Screen via Veyon">🔒 Lock</button>`
          }
          <button data-action="message" data-id="${s.studentId}" title="Send Direct Warning Message">💬 Msg</button>
          <button data-action="screenshot" data-id="${s.studentId}" title="Capture Screen via Veyon">📸 Shot</button>
          <button data-action="inspect" data-id="${s.studentId}" title="View Details & Violations">🔍 Inspect</button>
        </div>
      </div>
    `;
  }

  function bindCardEvents() {
    document.querySelectorAll('.student-card button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const studentId = btn.dataset.id;
        handleCardAction(action, studentId);
      });
    });

    document.querySelectorAll('.student-card').forEach(card => {
      card.addEventListener('click', () => {
        const studentId = card.dataset.id;
        openInspector(studentId);
      });
    });
  }

  // --- Actions Handling ---
  async function handleCardAction(action, studentId) {
    const student = students.find(s => s.studentId === studentId);
    if (!student) return;

    switch (action) {
      case 'lock':
        sendAction(studentId, 'lock', { message: 'Assessment locked by invigilator.' });
        break;

      case 'unlock':
        sendAction(studentId, 'unlock');
        break;

      case 'message':
        openMessageModal(studentId);
        break;

      case 'screenshot':
        sendAction(studentId, 'screenshot');
        break;

      case 'inspect':
        openInspector(studentId);
        break;

      case 'edit-host':
        const newHost = prompt(`Enter Veyon LAN Hostname or IP for ${student.studentName}:`, student.hostname || student.ip || '');
        if (newHost && newHost.trim()) {
          updateStudentMapping(studentId, newHost.trim());
        }
        break;

      default:
        break;
    }
  }

  async function sendAction(studentId, action, options = {}) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'invigilator:action',
        payload: { studentId, action, options },
      }));
    } else {
      // Fallback to REST API
      try {
        await fetch(`/api/integrity/students/${encodeURIComponent(studentId)}/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, ...options }),
        });
      } catch (err) {
        alert('Failed to dispatch action: ' + err.message);
      }
    }
  }

  async function updateStudentMapping(studentId, hostname) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'invigilator:update_mapping',
        payload: { studentId, mapping: { hostname } },
      }));
    } else {
      await fetch(`/api/integrity/students/${encodeURIComponent(studentId)}/mapping`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostname }),
      });
    }
  }

  // --- Inspector Modal ---
  function openInspector(studentId) {
    selectedStudentId = studentId;
    const student = students.find(s => s.studentId === studentId);
    if (!student) return;
    renderInspector(student);
    modalInspector.classList.add('open');
  }

  function renderInspector(s) {
    document.getElementById('inspectAvatar').textContent = (s.studentName || 'S').charAt(0).toUpperCase();
    document.getElementById('inspectName').textContent = s.studentName || 'Student';
    document.getElementById('inspectMeta').textContent = `ID: ${s.studentId} • Score: ${s.fairnessScore ?? 100} • Status: ${s.status}`;
    document.getElementById('inspectHostInput').value = s.hostname || s.ip || '';

    // Score Breakdown
    const breakdownEl = document.getElementById('inspectBreakdown');
    const bd = s.fairnessBreakdown || {};
    breakdownEl.innerHTML = `
      <div style="font-size:0.8rem; display:flex; flex-direction:column; gap:6px;">
        <div style="display:flex; justify-content:space-between;"><span>Face Presence:</span><strong>${bd.face ?? 0} pts</strong></div>
        <div style="display:flex; justify-content:space-between;"><span>Gaze & Focus:</span><strong>${bd.gaze ?? 0} pts</strong></div>
        <div style="display:flex; justify-content:space-between;"><span>Prohibited Objects:</span><strong>${bd.obstacles ?? 0} pts</strong></div>
        <div style="display:flex; justify-content:space-between;"><span>Window / Fullscreen:</span><strong>${(bd.focus ?? 0) + (bd.fullscreen ?? 0)} pts</strong></div>
      </div>
    `;

    // Timeline
    const timelineEl = document.getElementById('inspectTimeline');
    if (!s.violations || s.violations.length === 0) {
      timelineEl.innerHTML = `<div style="color:var(--text-sub); font-size:0.85rem; padding:20px 0;">No violations recorded for this candidate.</div>`;
    } else {
      timelineEl.innerHTML = s.violations.map(v => `
        <div class="timeline-item ${escapeHtml(v.type || '')}">
          <div class="timeline-top">
            <strong>${escapeHtml(v.type || 'Event').toUpperCase()}</strong>
            <span>${v.time || ''}</span>
          </div>
          <div class="timeline-msg">${escapeHtml(v.message)}</div>
        </div>
      `).join('');
    }
  }

  // Inspector Action Buttons
  document.getElementById('btnSaveMapping').addEventListener('click', () => {
    if (!selectedStudentId) return;
    const host = document.getElementById('inspectHostInput').value.trim();
    if (host) updateStudentMapping(selectedStudentId, host);
  });
  document.getElementById('btnInspectLock').addEventListener('click', () => {
    if (selectedStudentId) sendAction(selectedStudentId, 'lock', { message: 'Locked by invigilator.' });
  });
  document.getElementById('btnInspectUnlock').addEventListener('click', () => {
    if (selectedStudentId) sendAction(selectedStudentId, 'unlock');
  });
  document.getElementById('btnInspectMsg').addEventListener('click', () => {
    if (selectedStudentId) openMessageModal(selectedStudentId);
  });
  document.getElementById('btnInspectShot').addEventListener('click', () => {
    if (selectedStudentId) sendAction(selectedStudentId, 'screenshot');
  });
  document.getElementById('btnCloseInspector').addEventListener('click', () => {
    modalInspector.classList.remove('open');
    selectedStudentId = null;
  });

  // --- Message Modal ---
  function openMessageModal(studentId) {
    pendingMessageStudentId = studentId;
    const s = students.find(st => st.studentId === studentId);
    document.getElementById('msgModalTitle').textContent = `Send Warning to ${s ? s.studentName : 'Candidate'}`;
    document.getElementById('txtMessage').value = '';
    modalMessage.classList.add('open');
  }

  document.querySelectorAll('.preset-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.getElementById('txtMessage').value = chip.dataset.msg;
    });
  });

  document.getElementById('btnSendMessage').addEventListener('click', () => {
    const text = document.getElementById('txtMessage').value.trim();
    if (!text) return alert('Please enter message text');
    if (pendingMessageStudentId) {
      sendAction(pendingMessageStudentId, 'message', { message: text });
    }
    modalMessage.classList.remove('open');
    pendingMessageStudentId = null;
  });
  document.getElementById('btnCancelMessage').addEventListener('click', () => modalMessage.classList.remove('open'));
  document.getElementById('btnCloseMessage').addEventListener('click', () => modalMessage.classList.remove('open'));

  // --- Screenshot Modal ---
  function showScreenshotModal(url, studentId) {
    const img = document.getElementById('screenshotImg');
    img.src = url;
    document.getElementById('screenshotTitle').textContent = `Veyon Screen Capture — Candidate ${studentId}`;
    modalScreenshot.classList.add('open');
  }
  document.getElementById('btnCloseScreenshot').addEventListener('click', () => modalScreenshot.classList.remove('open'));

  // --- Auto-Rules Modal ---
  document.getElementById('btnAutoRules').addEventListener('click', () => {
    syncRulesToUi();
    modalRules.classList.add('open');
  });
  document.getElementById('btnCloseRules').addEventListener('click', () => modalRules.classList.remove('open'));
  document.getElementById('btnCancelRules').addEventListener('click', () => modalRules.classList.remove('open'));

  const rangeLock = document.getElementById('rangeLock');
  const rangeWarn = document.getElementById('rangeWarn');
  const rangeCooldown = document.getElementById('rangeCooldown');
  const valLock = document.getElementById('valLock');
  const valWarn = document.getElementById('valWarn');
  const valCooldown = document.getElementById('valCooldown');

  rangeLock.addEventListener('input', () => valLock.textContent = rangeLock.value);
  rangeWarn.addEventListener('input', () => valWarn.textContent = rangeWarn.value);
  rangeCooldown.addEventListener('input', () => valCooldown.textContent = rangeCooldown.value);

  function syncRulesToUi() {
    document.getElementById('ruleEnabled').checked = !!autoRules.enabled;
    rangeLock.value = autoRules.autoLockThreshold || 50;
    valLock.textContent = rangeLock.value;
    rangeWarn.value = autoRules.autoWarnThreshold || 70;
    valWarn.textContent = rangeWarn.value;
    rangeCooldown.value = autoRules.cooldownSeconds || 30;
    valCooldown.textContent = rangeCooldown.value;
    document.getElementById('ruleScreenshot').checked = autoRules.autoScreenshotOnCritical !== false;
  }

  document.getElementById('btnSaveRules').addEventListener('click', async () => {
    const updated = {
      enabled: document.getElementById('ruleEnabled').checked,
      autoLockThreshold: parseInt(rangeLock.value, 10),
      autoWarnThreshold: parseInt(rangeWarn.value, 10),
      cooldownSeconds: parseInt(rangeCooldown.value, 10),
      autoScreenshotOnCritical: document.getElementById('ruleScreenshot').checked,
    };

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'invigilator:update_rules', payload: updated }));
    } else {
      await fetch('/api/integrity/rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
    }

    modalRules.classList.remove('open');
  });

  // --- Terminal Audit Log ---
  function logTerminal(type, text) {
    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    const time = new Date().toLocaleTimeString();
    line.innerHTML = `<span style="color:#64748b;">[${time}]</span> ${escapeHtml(text)}`;
    terminalLog.appendChild(line);
    terminalLog.scrollTop = terminalLog.scrollHeight;
  }

  function renderAuditLogs() {
    terminalLog.innerHTML = '';
    actions.slice().reverse().forEach(act => {
      const line = document.createElement('div');
      line.className = `log-entry ${act.success ? 'success' : 'failed'}`;
      line.innerHTML = `
        <div class="time">${act.timestamp || ''} • Target: ${escapeHtml(act.host)} (${act.durationMs || 0}ms)</div>
        <div class="cmd">${escapeHtml(act.command)}</div>
        <div class="out">${escapeHtml(act.output || act.error || '')}</div>
      `;
      terminalLog.appendChild(line);
    });
    terminalLog.scrollTop = terminalLog.scrollHeight;
  }

  document.getElementById('btnOpenAudit').addEventListener('click', () => {
    auditDrawer.classList.toggle('open');
  });
  document.getElementById('btnCloseAudit').addEventListener('click', () => {
    auditDrawer.classList.remove('open');
  });

  // --- Simulate Candidate Button (For Testing!) ---
  async function spawnSimulatedCandidate() {
    const num = Math.floor(10 + Math.random() * 90);
    const mockCandidate = {
      studentId: `SIM-${num}`,
      studentName: `Alex Rivera #${num}`,
      hostname: `lab-pc-${num}`,
      ip: `192.168.1.${100 + num}`,
      testCode: 'TEST-CS101',
      fairnessScore: 95,
      faceDetected: 1,
      focused: true,
      fullscreen: true,
    };

    try {
      const res = await fetch('/api/integrity/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mockCandidate),
      });
      const data = await res.json();
      if (data.student) {
        logTerminal('info', `Spawned test candidate ${data.student.studentName}`);
      }
    } catch (e) {
      console.error('Failed to spawn candidate:', e);
    }
  }

  document.getElementById('btnSimulateStudent').addEventListener('click', spawnSimulatedCandidate);
  document.getElementById('btnEmptySimulate').addEventListener('click', spawnSimulatedCandidate);

  // --- Broadcast Alert ---
  document.getElementById('btnBroadcast').addEventListener('click', () => {
    const text = prompt('Enter announcement to broadcast to all active candidates:');
    if (!text || !text.trim()) return;
    students.forEach(s => {
      sendAction(s.studentId, 'message', { message: text.trim() });
    });
    logTerminal('info', `Broadcast sent to ${students.length} candidates: "${text}"`);
  });

  // --- Filters & Search ---
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeFilter = chip.dataset.filter;
      render();
    });
  });

  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    render();
  });

  // --- Utilities ---
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // --- Init ---
  connectWebSocket();
})();
