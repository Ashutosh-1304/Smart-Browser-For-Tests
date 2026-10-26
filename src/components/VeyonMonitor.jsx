import { useEffect, useState } from 'react';

export default function VeyonMonitor({
  candidateName = 'Candidate Machine',
  enrollmentNumber = 'N/A',
  batch = 'N/A',
  autoPoll = false,
}) {
  const [status, setStatus] = useState('connecting');
  const [errorDetails, setErrorDetails] = useState('');
  const [endpoint, setEndpoint] = useState('127.0.0.1:11080');
  const [screenUrl, setScreenUrl] = useState(null);

  const checkVeyonHealth = async () => {
    setStatus('connecting');
    setErrorDetails('');

    try {
      const res = await fetch('/api/veyon/health');
      const data = await res.json();

      if (data.available && data.webapi === 'reachable') {
        setStatus('connected');
        setEndpoint(data.endpoint || '127.0.0.1:11080');
        setStatus('screen_unavailable');
      } else {
        setStatus('unavailable');
        setEndpoint(data.endpoint || '127.0.0.1:11080');
        setErrorDetails(data.error || 'Veyon WebAPI unreachable');
      }
    } catch (err) {
      setStatus('unavailable');
      setErrorDetails(err.message || 'Network error fetching Veyon health status');
    }
  };

  useEffect(() => {
    checkVeyonHealth();

    if (autoPoll) {
      const interval = setInterval(checkVeyonHealth, 10000);
      return () => clearInterval(interval);
    }
  }, [autoPoll]);

  return (
    <div className="candidate-screen-card" style={cardStyles.card}>
      <div style={cardStyles.header}>
        <div>
          <h4 style={cardStyles.title}>{candidateName}</h4>
          <span style={cardStyles.meta}>
            Enrollment: {enrollmentNumber} | Batch: {batch}
          </span>
        </div>
        <div style={cardStyles.badgeContainer}>
          <StatusBadge status={status} />
        </div>
      </div>

      <div className="screen-frame-container" style={cardStyles.screenWrapper}>
        {screenUrl ? (
          <img
            src={screenUrl}
            alt={`${candidateName} live screen`}
            style={cardStyles.screenImg}
          />
        ) : (
          <div style={cardStyles.placeholderBox}>
            <PlaceholderIcon status={status} />
            <p style={cardStyles.placeholderText}>
              {status === 'connecting' && 'Connecting to Veyon WebAPI...'}
              {status === 'unavailable' && 'Veyon Service Unavailable'}
              {status === 'connected' && 'Connected to Veyon'}
              {status === 'screen_unavailable' && 'Screen Unavailable'}
            </p>
            <p style={cardStyles.subText}>
              {status === 'unavailable' &&
                `Endpoint (${endpoint}) is offline or uninstalled. Ensure Veyon Service & WebAPI plugin are active.`}
              {status === 'screen_unavailable' &&
                `WebAPI at ${endpoint} is online, but requires an authenticated Veyon session to stream framebuffer frames.`}
              {status === 'connecting' && `Checking ${endpoint}...`}
            </p>
            {errorDetails && (
              <span style={cardStyles.errorDetails}>Details: {errorDetails}</span>
            )}
          </div>
        )}
      </div>

      <div style={cardStyles.footer}>
        <span style={cardStyles.endpointLabel}>Target: {endpoint}</span>
        <button
          onClick={checkVeyonHealth}
          style={cardStyles.refreshBtn}
          title="Re-check Veyon WebAPI connectivity"
        >
          ↻ Check Connection
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  let label = 'Unknown';
  let bg = '#475569';

  switch (status) {
    case 'connecting':
      label = 'Connecting...';
      bg = '#eab308';
      break;
    case 'connected':
      label = 'Veyon Online';
      bg = '#22c55e';
      break;
    case 'screen_unavailable':
      label = 'WebAPI Online (No Frame)';
      bg = '#3b82f6';
      break;
    case 'unavailable':
      label = 'Veyon Offline';
      bg = '#ef4444';
      break;
    default:
      break;
  }

  return (
    <span
      style={{
        ...cardStyles.badge,
        backgroundColor: bg,
      }}
    >
      {label}
    </span>
  );
}

function PlaceholderIcon({ status }) {
  if (status === 'connecting') {
    return (
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#eab308" strokeWidth="2">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
      </svg>
    );
  }
  if (status === 'unavailable') {
    return (
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
        <line x1="2" y1="2" x2="22" y2="22" stroke="#ef4444" strokeWidth="2" />
      </svg>
    );
  }
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

const cardStyles = {
  card: {
    backgroundColor: '#1e293b',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '12px',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    maxWidth: '480px',
    color: '#f8fafc',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
    fontFamily: 'Inter, system-ui, sans-serif',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  title: {
    margin: 0,
    fontSize: '1rem',
    fontWeight: '600',
    color: '#f1f5f9',
  },
  meta: {
    fontSize: '0.75rem',
    color: '#94a3b8',
  },
  badgeContainer: {
    display: 'flex',
    alignItems: 'center',
  },
  badge: {
    fontSize: '0.7rem',
    fontWeight: '600',
    padding: '3px 8px',
    borderRadius: '999px',
    color: '#ffffff',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  screenWrapper: {
    width: '100%',
    aspectRatio: '16 / 9',
    backgroundColor: '#0f172a',
    borderRadius: '8px',
    overflow: 'hidden',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  screenImg: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    display: 'block',
  },
  placeholderBox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    padding: '16px',
  },
  placeholderText: {
    margin: '8px 0 4px',
    fontSize: '0.9rem',
    fontWeight: '600',
    color: '#e2e8f0',
  },
  subText: {
    margin: 0,
    fontSize: '0.75rem',
    color: '#64748b',
    maxWidth: '320px',
    lineHeight: 1.4,
  },
  errorDetails: {
    marginTop: '6px',
    fontSize: '0.7rem',
    color: '#f87171',
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: '8px',
    borderTop: '1px solid rgba(255, 255, 255, 0.06)',
  },
  endpointLabel: {
    fontSize: '0.75rem',
    color: '#64748b',
    fontFamily: 'monospace',
  },
  refreshBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    color: '#f1f5f9',
    borderRadius: '6px',
    padding: '4px 10px',
    fontSize: '0.75rem',
    cursor: 'pointer',
    transition: 'background-color 0.15s ease',
  },
};
