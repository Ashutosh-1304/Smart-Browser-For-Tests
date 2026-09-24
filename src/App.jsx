import { useCallback, useEffect, useRef, useState } from 'react';
import SiteFrame from './components/SiteFrame.jsx';
import FaceMonitor from './components/FaceMonitor.jsx';
import Dashboard from './components/Dashboard.jsx';
import { useWindowEvents } from './hooks/useWindowEvents.js';
import { useFairnessScore } from './hooks/useFairnessScore.js';

// ── Code → URL decoder (mirrors website/script.js encoding) ──────────────
function decodeTestCode(code) {
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

// Default assessment URL loaded on startup.
const DEFAULT_URL = 'https://google.com';
const API_BASE_URL = 'http://localhost:3001/api';

// Simple incrementing ids for log rows.
let violationId = 0;
let urlLogId = 0;

export default function App() {
  // ── Code-entry gate ─────────────────────────────────────────────────────
  const [started, setStarted] = useState(false);
  const [testCode, setTestCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [isValidatingCode, setIsValidatingCode] = useState(false);

  const handleStartWithCode = async () => {
    const trimmed = testCode.trim();
    if (!trimmed) {
      setCodeError('Please enter a test code.');
      return;
    }

    setCodeError('');
    setIsValidatingCode(true);

    try {
      // 1. First attempt to resolve via backend API
      const res = await fetch(`${API_BASE_URL}/codes/${encodeURIComponent(trimmed)}`);
      
      if (res.ok) {
        const data = await res.json();
        if (data.url) {
          setUrlInput(data.url);
          setActiveUrl(data.url);
          setUrlLogs([{ id: ++urlLogId, time: new Date().toLocaleTimeString(), url: data.url }]);
          setStarted(true);
          return;
        }
      } else if (res.status === 404) {
        // Fallback check for legacy client-side encoded code before throwing
        const legacyDecoded = decodeTestCode(trimmed);
        if (legacyDecoded) {
          try {
            new URL(legacyDecoded);
            setUrlInput(legacyDecoded);
            setActiveUrl(legacyDecoded);
            setUrlLogs([{ id: ++urlLogId, time: new Date().toLocaleTimeString(), url: legacyDecoded }]);
            setStarted(true);
            return;
          } catch {
            // invalid URL in legacy payload
          }
        }
        setCodeError('Invalid code. Test code not found.');
        return;
      } else if (res.status === 410) {
        const errData = await res.json().catch(() => ({}));
        setCodeError(errData.error || 'This test code has expired or has been revoked.');
        return;
      } else {
        const errData = await res.json().catch(() => ({}));
        setCodeError(errData.error || 'Unable to resolve test code. Please try again.');
        return;
      }
    } catch {
      // Backend is unreachable; check if legacy code format works offline
      const legacyDecoded = decodeTestCode(trimmed);
      if (legacyDecoded) {
        try {
          new URL(legacyDecoded);
          setUrlInput(legacyDecoded);
          setActiveUrl(legacyDecoded);
          setUrlLogs([{ id: ++urlLogId, time: new Date().toLocaleTimeString(), url: legacyDecoded }]);
          setStarted(true);
          return;
        } catch {
          // Ignore
        }
      }
      setCodeError('Cannot reach the assessment server. Please ensure the server is running on http://localhost:3001.');
    } finally {
      setIsValidatingCode(false);
    }
  };

  const handleStartWithoutCode = () => {
    setStarted(true);
  };

  const [urlInput, setUrlInput] = useState(DEFAULT_URL);
  const [activeUrl, setActiveUrl] = useState(DEFAULT_URL);

  // Every URL loaded into the assessment frame, newest first.
  const [urlLogs, setUrlLogs] = useState(() => [
    { id: ++urlLogId, time: new Date().toLocaleTimeString(), url: DEFAULT_URL },
  ]);

  const [cameraStatus, setCameraStatus] = useState('idle'); // idle | running | error
  const [cameraError, setCameraError] = useState('');
  const [faceDetected, setFaceDetected] = useState(null);   // null=unknown, true, false

  const [focused, setFocused] = useState(true);
  const [fullscreen, setFullscreen] = useState(true);
  const [violations, setViolations] = useState([]);

  // ─── Fairness Score Engine ───
  const { score: fairnessScore, breakdown: fairnessBreakdown, recordViolation } = useFairnessScore();

  const addViolation = useCallback((type, message) => {
    setViolations((prev) =>
      [
        { id: ++violationId, time: new Date().toLocaleTimeString(), type, message },
        ...prev,
      ].slice(0, 200)
    );
    // Feed the violation into the fairness score engine.
    recordViolation(type);
  }, [recordViolation]);

  // addWarning: logs to the violations feed but does NOT affect the fairness score.
  // Used for object-detection events — YOLO detections are logged here so they are
  // visible in the audit trail, but scoring is intentionally excluded until the
  // object-detection fairness weights are properly calibrated.
  const addWarning = useCallback((type, message) => {
    setViolations((prev) =>
      [
        { id: ++violationId, time: new Date().toLocaleTimeString(), type, message },
        ...prev,
      ].slice(0, 200)
    );
    // ⚠️ Intentionally NOT calling recordViolation — object detection warnings
    //    are excluded from the fairness score for now.
  }, []);

  // ----- Phase 3: OS window events from the main process -----
  useWindowEvents(
    useCallback(
      (data) => {
        switch (data.type) {
          case 'focus':
            setFocused(true);
            unfocusedSince.current = null;
            break;
          case 'blur':
            setFocused(false);
            unfocusedSince.current = Date.now();
            addViolation('focus', 'Window lost focus (possible app/tab switch)');
            break;
          case 'minimize':
            addViolation('minimize', 'Window was minimized');
            break;
          case 'restore':
            break;
          case 'enter-full-screen':
            setFullscreen(true);
            notFullscreenSince.current = null;
            break;
          case 'leave-full-screen':
            setFullscreen(false);
            notFullscreenSince.current = Date.now();
            addViolation('fullscreen', 'Exited fullscreen mode');
            break;
          default:
            break;
        }
      },
      [addViolation]
    )
  );

  // ----- Phase 2: detection status & violation debouncing -----
  const noFaceSince = useRef(null);
  const lastNoFaceViolation = useRef(0);
  const multipleFacesSince = useRef(null);
  const lastMultipleFacesViolation = useRef(0);
  const currentFaceCount = useRef(0);

  const gazeAwaySince = useRef(null);
  const lastSeenGazeAway = useRef(0);
  const lastGazeViolation = useRef(0);
  const currentGazeDirection = useRef('Center');
  const [gazeState, setGazeState] = useState({ isLookingAway: false, direction: 'Center' });

  const obstacleSince = useRef({}); // category -> timestamp
  const lastSeenObstacle = useRef({}); // category -> timestamp
  const lastObstacleViolation = useRef({});   // category -> timestamp
  const [obstaclesCount, setObstaclesCount] = useState(0);

  const unfocusedSince = useRef(null);
  const lastFocusViolation = useRef(0);

  const notFullscreenSince = useRef(null); // starts in fullscreen
  const lastNotFullscreenViolation = useRef(0);

  const handleFaceStatus = useCallback((isFace) => {
    setFaceDetected(isFace ? 1 : 0);
  }, []);

  const handleDetectionUpdate = useCallback((data) => {
    // Handle both object format and direct face count
    const faceCount = typeof data === 'object' ? data.faceCount : data;
    const detectedObstacles = typeof data === 'object' ? (data.detectedObstacles || []) : [];
    const isLookingAway = typeof data === 'object' ? !!data.isLookingAway : false;
    const gazeDirection = typeof data === 'object' ? (data.gazeDirection || 'Center') : 'Center';

    setFaceDetected(faceCount);
    currentFaceCount.current = faceCount;
    setGazeState({ isLookingAway, direction: gazeDirection });
    currentGazeDirection.current = gazeDirection;
    setObstaclesCount(detectedObstacles.length);

    const now = Date.now();

    // -- No face --
    if (faceCount > 0) {
      noFaceSince.current = null;
    } else if (noFaceSince.current == null) {
      noFaceSince.current = now;
    }

    // -- Multiple faces --
    if (faceCount <= 1) {
      multipleFacesSince.current = null;
    } else if (multipleFacesSince.current == null) {
      multipleFacesSince.current = now;
    }

    // -- Eye Gaze / Looking Away --
    if (isLookingAway) {
      lastSeenGazeAway.current = now;
      if (gazeAwaySince.current == null) {
        gazeAwaySince.current = now;
      }
    } else {
      if (lastSeenGazeAway.current && now - lastSeenGazeAway.current > 800) {
        gazeAwaySince.current = null;
      }
    }

    // -- Obstacle Detections --
    const activeCategories = detectedObstacles.map(obj => obj.category);
    
    activeCategories.forEach(cat => {
      lastSeenObstacle.current[cat] = now;
      if (obstacleSince.current[cat] == null) {
        obstacleSince.current[cat] = now;
      }
    });

    // Clean up objects that haven't been seen for 800ms
    Object.keys(obstacleSince.current).forEach(cat => {
      const lastSeen = lastSeenObstacle.current[cat] || 0;
      if (now - lastSeen > 800) {
        delete obstacleSince.current[cat];
        delete lastSeenObstacle.current[cat];
      }
    });
  }, []);

  const FRIENDLY_NAMES = {
    'cell phone': 'Mobile Phone',
    'laptop': 'Laptop',
    'book': 'Book',
    'bottle': 'Bottle',
    'cup': 'Cup / Mug',
    'scissors': 'Scissors',
    'mouse': 'Computer Mouse',
    'keyboard': 'Keyboard',
    'tv': 'Monitor / Display',
    'remote': 'Remote Control',
  };

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();

      // 1) No Face (3+ seconds, cooldown 5 seconds)
      if (
        noFaceSince.current &&
        now - noFaceSince.current > 3000 &&
        now - lastNoFaceViolation.current > 5000
      ) {
        lastNoFaceViolation.current = now;
        addViolation('face', 'No face detected for 3+ seconds');
      }

      // 2) Multiple People (3+ seconds, cooldown 5 seconds)
      if (
        multipleFacesSince.current &&
        now - multipleFacesSince.current > 3000 &&
        now - lastMultipleFacesViolation.current > 5000
      ) {
        lastMultipleFacesViolation.current = now;
        const count = currentFaceCount.current;
        addViolation('multiple-faces', `Multiple people detected (${count} faces) for 3+ seconds`);
      }

      // 3) Eye Gaze / Looking Away (1.5+ seconds, cooldown 5 seconds)
      if (
        gazeAwaySince.current &&
        now - gazeAwaySince.current > 1500 &&
        now - lastGazeViolation.current > 5000
      ) {
        lastGazeViolation.current = now;
        const dir = currentGazeDirection.current || 'Away';
        addViolation('gaze', `Looking away from screen (${dir})`);
      }

      // 4) Obstacle / Object Detections
      //    Dwell threshold : 1 000 ms  — object must be present for 1 second
      //    before logging a violation.
      //    Cooldown        : 5 000 ms  — at most one violation every 5 s per category.
      //    Scoring         : addViolation() deducts from the fairness score.
      Object.keys(obstacleSince.current).forEach((cat) => {
        const detectedAt = obstacleSince.current[cat];
        const lastViolatedAt = lastObstacleViolation.current[cat] || 0;

        if (
          detectedAt &&
          now - detectedAt > 1000 &&   // ← 1-second dwell before violation
          now - lastViolatedAt > 5000
        ) {
          lastObstacleViolation.current[cat] = now;
          const friendlyName = FRIENDLY_NAMES[cat] || cat.charAt(0).toUpperCase() + cat.slice(1);
          addViolation('obstacle', `[OBJECT DETECTED] ${friendlyName} present for 1+ second`);
        }
      });

      // 5) Tab still switched (every 2 seconds while unfocused)
      if (
        unfocusedSince.current &&
        now - unfocusedSince.current > 2000 &&
        now - lastFocusViolation.current > 2000
      ) {
        lastFocusViolation.current = now;
        const secs = Math.round((now - unfocusedSince.current) / 1000);
        addViolation('focus', `Window still unfocused (${secs}s)`);
      }

      // 6) Not in fullscreen (1+ second, cooldown 5 seconds)
      if (
        notFullscreenSince.current &&
        now - notFullscreenSince.current > 1000 &&
        now - lastNotFullscreenViolation.current > 5000
      ) {
        lastNotFullscreenViolation.current = now;
        addViolation('fullscreen', 'Fullscreen not enabled for 1+ second');
      }

    }, 500);
    return () => clearInterval(interval);
  }, [addViolation]);

  const handleCameraStatus = useCallback((status, errMsg) => {
    setCameraStatus(status);
    if (errMsg) setCameraError(errMsg);
  }, []);

  const lastLoggedUrl = useRef('');

  const logUrl = useCallback((url) => {
    // Skip consecutive duplicate URLs (redirects, re-fires)
    if (url === lastLoggedUrl.current) return;
    lastLoggedUrl.current = url;
    setUrlLogs((prev) =>
      [
        { id: ++urlLogId, time: new Date().toLocaleTimeString(), url },
        ...prev,
      ].slice(0, 200)
    );
  }, []);

  const loadUrl = () => {
    let next = urlInput.trim();
    if (!next) return;
    if (!/^https?:\/\//i.test(next)) next = 'https://' + next;
    setActiveUrl(next);
    // Don't logUrl here — the webview's did-navigate event will log it
  };

  // ── Code-entry landing screen ──────────────────────────────────────────
  if (!started) {
    return (
      <div className="code-entry-screen">
        <div className="code-entry-card">
          <div className="code-entry-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <h1 className="code-entry-title">Smart Browser</h1>
          <p className="code-entry-subtitle">Secure Assessment Platform</p>

          <div className="code-entry-form">
            <label className="code-entry-label">Enter Test Code</label>
            <input
              className="code-entry-input"
              type="text"
              value={testCode}
              onChange={(e) => { setTestCode(e.target.value); setCodeError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && handleStartWithCode()}
              placeholder="Paste your test code here..."
              autoFocus
              spellCheck={false}
            />
            {codeError && <p className="code-entry-error">{codeError}</p>}
            <button 
              className="code-entry-btn" 
              onClick={handleStartWithCode}
              disabled={isValidatingCode}
              style={{ opacity: isValidatingCode ? 0.7 : 1, cursor: isValidatingCode ? 'wait' : 'pointer' }}
            >
              {isValidatingCode ? 'Verifying...' : 'Start Test'}
            </button>
            <button className="code-entry-skip" onClick={handleStartWithoutCode} disabled={isValidatingCode}>
              Skip — enter URL manually
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="dot" /> Secure Assessment <small>PoC</small>
        </div>
        <div className="url-bar">
          <input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadUrl()}
            placeholder="Enter assessment URL (Google Form, website...)"
          />
          <button onClick={loadUrl}>Load</button>
        </div>
        <div className="fs-controls">
          <button onClick={() => window.electronAPI?.toggleFullscreen(true)}>
            Enter Fullscreen
          </button>
          <button onClick={() => window.electronAPI?.toggleFullscreen(false)}>
            Exit
          </button>
        </div>
      </header>

      <div className="body">
        <SiteFrame
          url={activeUrl}
          onNavigate={(navUrl) => {
            setUrlInput(navUrl);   // update the URL bar to reflect the current page
            logUrl(navUrl);        // log every in-webview navigation
          }}
        />
        <aside className="sidebar">
          <FaceMonitor
            onCameraStatus={handleCameraStatus}
            onFaceStatus={handleFaceStatus}
            onDetectionUpdate={handleDetectionUpdate}
          />
          <Dashboard
            cameraStatus={cameraStatus}
            cameraError={cameraError}
            faceDetected={faceDetected}
            gazeState={gazeState}
            obstaclesCount={obstaclesCount}
            focused={focused}
            fullscreen={fullscreen}
            violations={violations}
            urlLogs={urlLogs}
            fairnessScore={fairnessScore}
            fairnessBreakdown={fairnessBreakdown}
          />
        </aside>
      </div>
    </div>
  );
}

