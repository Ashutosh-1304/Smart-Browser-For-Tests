import { useCallback, useEffect, useRef, useState } from 'react';
import SiteFrame from './components/SiteFrame.jsx';
import FaceMonitor from './components/FaceMonitor.jsx';
import Dashboard from './components/Dashboard.jsx';
import { useWindowEvents } from './hooks/useWindowEvents.js';

// Default assessment URL loaded on startup.
const DEFAULT_URL = 'https://google.com';

// Simple incrementing ids for log rows.
let violationId = 0;
let urlLogId = 0;

export default function App() {
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
  const [fullscreen, setFullscreen] = useState(false);
  const [violations, setViolations] = useState([]);

  const addViolation = useCallback((type, message) => {
    setViolations((prev) =>
      [
        { id: ++violationId, time: new Date().toLocaleTimeString(), type, message },
        ...prev,
      ].slice(0, 200)
    );
  }, []);

  // ----- Phase 3: OS window events from the main process -----
  useWindowEvents(
    useCallback(
      (data) => {
        switch (data.type) {
          case 'focus':
            setFocused(true);
            break;
          case 'blur':
            setFocused(false);
            addViolation('focus', 'Window lost focus (possible app/tab switch)');
            break;
          case 'minimize':
            addViolation('minimize', 'Window was minimized');
            break;
          case 'restore':
            break;
          case 'enter-full-screen':
            setFullscreen(true);
            break;
          case 'leave-full-screen':
            setFullscreen(false);
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

  const suspiciousObjectSince = useRef({}); // category -> timestamp
  const lastObjectViolation = useRef({});   // category -> timestamp

  const handleFaceStatus = useCallback((isFace) => {
    // Keep for backward compatibility or direct calls
    setFaceDetected(isFace ? 1 : 0);
  }, []);

  const handleDetectionUpdate = useCallback((faceCount, forbiddenObjects) => {
    setFaceDetected(faceCount);
    currentFaceCount.current = faceCount;

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

    // -- Suspicious objects --
    const activeCategories = forbiddenObjects.map(obj => obj.category);
    
    // Clean up objects that are no longer present
    Object.keys(suspiciousObjectSince.current).forEach(cat => {
      if (!activeCategories.includes(cat)) {
        delete suspiciousObjectSince.current[cat];
      }
    });

    // Mark start time for newly detected objects
    activeCategories.forEach(cat => {
      if (suspiciousObjectSince.current[cat] == null) {
        suspiciousObjectSince.current[cat] = now;
      }
    });
  }, []);

  const FRIENDLY_NAMES = {
    'cell phone': 'Mobile Phone',
    'laptop': 'Laptop',
    'book': 'Book',
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

      // 3) Suspicious Objects (1+ second, cooldown 5 seconds per category)
      Object.keys(suspiciousObjectSince.current).forEach((cat) => {
        const detectedAt = suspiciousObjectSince.current[cat];
        const lastViolatedAt = lastObjectViolation.current[cat] || 0;

        if (
          detectedAt &&
          now - detectedAt > 1000 &&
          now - lastViolatedAt > 5000
        ) {
          lastObjectViolation.current[cat] = now;
          const friendlyName = FRIENDLY_NAMES[cat] || cat;
          addViolation('suspicious-object', `Suspicious object detected (${friendlyName}) for 1+ second`);
        }
      });

    }, 1000);
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
            focused={focused}
            fullscreen={fullscreen}
            violations={violations}
            urlLogs={urlLogs}
          />
        </aside>
      </div>
    </div>
  );
}
