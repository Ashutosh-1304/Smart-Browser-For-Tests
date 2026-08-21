// Read-only dashboard: Camera / Face / Focus / Fullscreen + violations feed + Fairness Score.

function StatusCard({ label, value, tone }) {
  return (
    <div className={`status-card tone-${tone}`}>
      <div className="status-label">{label}</div>
      <div className="status-value">{value}</div>
    </div>
  );
}

const TYPE_LABEL = {
  focus: 'FOCUS',
  minimize: 'MINIMIZE',
  fullscreen: 'FULLSCREEN',
  face: 'NO FACE',
  'multiple-faces': 'MULTIPLE PEOPLE',
  'suspicious-object': 'SUSPICIOUS OBJECT',
  gaze: 'LOOKING AWAY',
  obstacle: 'OBSTACLE',
};

// ── Score gauge helper ──────────────────────────────────────────────────────

function getScoreTone(score) {
  if (score >= 80) return 'good';
  if (score >= 50) return 'warn';
  return 'bad';
}

function getScoreColor(score) {
  if (score >= 80) return '#22c55e';
  if (score >= 50) return '#eab308';
  return '#ef4444';
}

function ScoreGauge({ score }) {
  const tone = getScoreTone(score);
  const color = getScoreColor(score);

  // SVG circular progress — 251.2 is the circumference of a circle with r=40
  const circumference = 251.2;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className={`score-gauge tone-${tone}`}>
      <svg viewBox="0 0 100 100" className="gauge-svg">
        {/* Background track */}
        <circle
          cx="50" cy="50" r="40"
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="8"
        />
        {/* Foreground arc */}
        <circle
          cx="50" cy="50" r="40"
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="gauge-progress"
        />
      </svg>
      <div className="gauge-text">
        <span className="gauge-value">{Math.round(score)}</span>
        <span className="gauge-label">Fairness</span>
      </div>
    </div>
  );
}

function BreakdownBar({ item }) {
  const color = getScoreColor(item.score);
  const priorityBadge = item.priority === 'HIGH' ? '🔴' : item.priority === 'MEDIUM' ? '🟡' : '🟢';

  return (
    <div className="breakdown-item">
      <div className="breakdown-header">
        <span className="breakdown-label">
          {priorityBadge} {item.label}
        </span>
        <span className="breakdown-meta">
          <span className="breakdown-score" style={{ color }}>{item.score}</span>
          <span className="breakdown-weight">×{item.weight.toFixed(2)}</span>
          <span className="breakdown-weighted" style={{ color }}>= {item.weighted}</span>
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
          {item.violations} violation{item.violations !== 1 ? 's' : ''} (−{item.violations * (100 - item.score) / Math.max(item.violations, 1)} each)
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

  const face =
    faceDetected == null
      ? { value: 'Detecting…', tone: 'warn' }
      : faceDetected === 0 || faceDetected === false
      ? { value: 'No Face', tone: 'bad' }
      : faceDetected === 1 || faceDetected === true
      ? { value: 'Face Detected', tone: 'good' }
      : { value: `Multiple (${faceDetected})`, tone: 'bad' };

  return (
    <div className="dashboard">
      <h3 className="dash-title">Monitoring Dashboard</h3>

      {/* ── Fairness Score ─────────────────────────────────── */}
      <div className="fairness-section">
        <ScoreGauge score={fairnessScore} />
        <div className="breakdown-list">
          {fairnessBreakdown.map((item) => (
            <BreakdownBar key={item.type} item={item} />
          ))}
        </div>
      </div>

      <div className="status-grid">
        <StatusCard label="Camera" value={cam.value} tone={cam.tone} />
        <StatusCard label="Face" value={face.value} tone={face.tone} />
        <StatusCard
          label="Window Focus"
          value={focused ? 'Focused' : 'Not Focused'}
          tone={focused ? 'good' : 'bad'}
        />
        <StatusCard
          label="Fullscreen"
          value={fullscreen ? 'On' : 'Off'}
          tone={fullscreen ? 'good' : 'warn'}
        />
      </div>

      {cameraStatus === 'error' && (
        <div className="cam-error">Camera error: {cameraError}</div>
      )}

      <div className="violations">
        <div className="violations-head">
          <span>Violations</span>
          <span className="count">{violations.length}</span>
        </div>
        <div className="violations-list">
          {violations.length === 0 ? (
            <div className="empty">No violations yet ✅</div>
          ) : (
            violations.map((v) => (
              <div key={v.id} className={`violation type-${v.type}`}>
                <span className="v-time">{v.time}</span>
                <span className="v-type">{TYPE_LABEL[v.type] || v.type}</span>
                <span className="v-msg">{v.message}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="url-logs">
        <div className="url-logs-head">
          <span>URL Logs</span>
          <span className="count">{urlLogs.length}</span>
        </div>
        <div className="url-logs-list">
          {urlLogs.length === 0 ? (
            <div className="empty">No URLs loaded yet</div>
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
