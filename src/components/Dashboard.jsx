// Read-only dashboard: Camera / Face / Focus / Fullscreen + violations feed.

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
  face: 'FACE',
};

export default function Dashboard({
  cameraStatus,
  cameraError,
  faceDetected,
  focused,
  fullscreen,
  violations,
  urlLogs = [],
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
      : faceDetected
      ? { value: 'Face Detected', tone: 'good' }
      : { value: 'No Face', tone: 'bad' };

  return (
    <div className="dashboard">
      <h3 className="dash-title">Monitoring Dashboard</h3>

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
