import { useMemo } from 'react';

// Status icons (SVGs) for visual polish
const ICONS = {
  camera: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
      <circle cx="12" cy="13" r="4"/>
    </svg>
  ),
  face: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
      <line x1="9" y1="9" x2="9.01" y2="9"/>
      <line x1="15" y1="9" x2="15.01" y2="9"/>
    </svg>
  ),
  focus: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
      <line x1="9" y1="3" x2="9" y2="21"/>
      <line x1="3" y1="9" x2="21" y2="9"/>
    </svg>
  ),
  fullscreen: (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
    </svg>
  )
};

function StatusCard({ label, value, tone, iconKey }) {
  return (
    <div className={`status-card tone-${tone}`}>
      <div className="status-card-header">
        <span className="status-icon-wrapper">{ICONS[iconKey]}</span>
        <span className="status-label">{label}</span>
      </div>
      <div className="status-value">{value}</div>
    </div>
  );
}

const TYPE_LABEL = {
  focus: 'FOCUS LOST',
  minimize: 'APP MINIMIZED',
  fullscreen: 'FULLSCREEN EXIT',
  face: 'NO FACE',
  'multiple-faces': 'MULTIPLE PEOPLE',
  gaze: 'LOOKING AWAY',
  obstacle: 'OBSTACLE DETECTED',
  'suspicious-object': 'SUSPICIOUS OBJECT',
};

// ── Score gauge helper ──────────────────────────────────────────────────────

function getScoreTone(score) {
  if (score >= 80) return 'good';
  if (score >= 50) return 'warn';
  return 'bad';
}

function getScoreColor(score) {
  if (score >= 80) return '#10b981'; // Emerald
  if (score >= 50) return '#f59e0b'; // Amber
  return '#ef4444'; // Rose
}

function ScoreGauge({ score }) {
  const tone = getScoreTone(score);
  const color = getScoreColor(score);

  // SVG circular progress — 251.2 is the circumference of a circle with r=40
  const circumference = 251.2;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className={`score-gauge tone-${tone}`}>
      <div className="gauge-glow-layer" style={{ color }} />
      <svg viewBox="0 0 100 100" className="gauge-svg">
        {/* Background track with gradient */}
        <circle
          cx="50" cy="50" r="40"
          fill="none"
          stroke="rgba(255,255,255,0.04)"
          strokeWidth="7"
        />
        {/* Foreground progress arc */}
        <circle
          cx="50" cy="50" r="40"
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="gauge-progress"
        />
      </svg>
      <div className="gauge-text">
        <span className="gauge-value">{Math.round(score)}%</span>
        <span className="gauge-label">FAIRNESS</span>
      </div>
    </div>
  );
}

function BreakdownBar({ item }) {
  const color = getScoreColor(item.score);

  const priorityLabel = useMemo(() => {
    switch (item.priority) {
      case 'HIGH':
        return <span className="priority-badge p-high">High Impact</span>;
      case 'MEDIUM_HIGH':
        return <span className="priority-badge p-med-high">Medium High</span>;
      case 'MEDIUM':
        return <span className="priority-badge p-medium">Medium</span>;
      default:
        return <span className="priority-badge p-low">Low Impact</span>;
    }
  }, [item.priority]);

  return (
    <div className="breakdown-item">
      <div className="breakdown-header">
        <div className="breakdown-title-row">
          <span className="breakdown-label">{item.label}</span>
          {priorityLabel}
        </div>
        <span className="breakdown-meta">
          <span className="breakdown-score" style={{ color }}>{item.score}</span>
          <span className="breakdown-multiplier">× {item.weight.toFixed(2)}</span>
          <span className="breakdown-contribution" style={{ color }}>= {item.weighted}</span>
        </span>
      </div>
      <div className="breakdown-track">
        <div
          className="breakdown-fill"
          style={{ width: `${item.score}%`, backgroundColor: color }}
        />
      </div>
      {item.violations > 0 && (
        <div className="breakdown-violations">
          ⚠️ {item.violations} event{item.violations !== 1 ? 's' : ''} recorded (−{item.violations * (100 - item.score) / Math.max(item.violations, 1)} pts total)
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function Dashboard({
  cameraStatus,
  cameraError,
  faceDetected,
  gazeState,
  obstaclesCount,
  focused,
  fullscreen,
  violations,
  urlLogs = [],
  fairnessScore = 100,
  fairnessBreakdown = [],
}) {
  const cam =
    cameraStatus === 'running'
      ? { value: 'Active', tone: 'good' }
      : cameraStatus === 'error'
      ? { value: 'Error', tone: 'bad' }
      : { value: 'Starting…', tone: 'warn' };

  const face = useMemo(() => {
    if (faceDetected == null) {
      return { value: 'Detecting…', tone: 'warn' };
    }
    if (faceDetected === 0 || faceDetected === false) {
      return { value: 'No Face', tone: 'bad' };
    }
    if (faceDetected === 1 || faceDetected === true) {
      return { value: '1 Face', tone: 'good' };
    }
    return { value: `${faceDetected} Faces`, tone: 'bad' };
  }, [faceDetected]);

  return (
    <div className="dashboard">
      <div className="dashboard-top">
        <h3 className="dash-title">PROCTORING MONITOR</h3>
        <span className="secure-badge">
          <span className="pulse-dot" /> SECURED ACTIVE
        </span>
      </div>

      {/* ── Fairness Score Dashboard Card ── */}
      <div className="fairness-card">
        <div className="fairness-card-title">FAIRNESS INTEGRITY INDEX</div>
        <div className="fairness-content">
          <ScoreGauge score={fairnessScore} />
          <div className="breakdown-list">
            {fairnessBreakdown.map((item) => (
              <BreakdownBar key={item.type} item={item} />
            ))}
          </div>
        </div>
      </div>

      {/* ── Status Grid ── */}
      <div className="status-grid">
        <StatusCard label="Camera Feed" value={cam.value} tone={cam.tone} iconKey="camera" />
        <StatusCard label="Face Count" value={face.value} tone={face.tone} iconKey="face" />
        <StatusCard
          label="Window Focus"
          value={focused ? 'Focused' : 'Lost Focus'}
          tone={focused ? 'good' : 'bad'}
          iconKey="focus"
        />
        <StatusCard
          label="Fullscreen Mode"
          value={fullscreen ? 'Enabled' : 'Disabled'}
          tone={fullscreen ? 'good' : 'warn'}
          iconKey="fullscreen"
        />
      </div>

      {cameraStatus === 'error' && (
        <div className="cam-error">
          <svg className="error-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span>Camera failure: {cameraError}</span>
        </div>
      )}

      {/* ── Violations Log Feed ── */}
      <div className="violations">
        <div className="violations-head">
          <span className="sec-title-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            Violations Feed
          </span>
          <span className={`count ${violations.length > 0 ? 'active' : ''}`}>{violations.length}</span>
        </div>
        <div className="violations-list">
          {violations.length === 0 ? (
            <div className="empty">
              <svg className="ok-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              No violations recorded. Candidate is fully compliant.
            </div>
          ) : (
            violations.map((v) => (
              <div key={v.id} className={`violation type-${v.type}`}>
                <div className="v-indicator" />
                <span className="v-time">{v.time}</span>
                <span className="v-type">{TYPE_LABEL[v.type] || v.type}</span>
                <span className="v-msg">{v.message}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Web Nav Logs ── */}
      <div className="url-logs">
        <div className="url-logs-head">
          <span className="sec-title-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            Candidate Navigation Log
          </span>
          <span className="count logs-count">{urlLogs.length}</span>
        </div>
        <div className="url-logs-list">
          {urlLogs.length === 0 ? (
            <div className="empty">No navigation history yet.</div>
          ) : (
            urlLogs.map((u) => (
              <div key={u.id} className="url-log">
                <span className="v-time">{u.time}</span>
                <span className="u-url">{u.url}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
