import { useCallback, useEffect, useRef, useState } from 'react';
import SiteFrame from './components/SiteFrame.jsx';
import FaceMonitor from './components/FaceMonitor.jsx';
import Dashboard from './components/Dashboard.jsx';
import { useWindowEvents } from './hooks/useWindowEvents.js';

// Simple incrementing id for violation rows.
let violationId = 0;

export default function App() {
  const [urlInput, setUrlInput] = useState('https://google.com');
  const [activeUrl, setActiveUrl] = useState('https://google.com');

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

  // ----- Phase 2: face status + "no face" violation (debounced) -----
  const noFaceSince = useRef(null);
  const lastNoFaceViolation = useRef(0);

  const handleFaceStatus = useCallback((isFace) => {
    setFaceDetected(isFace);
    if (isFace) {
      noFaceSince.current = null;
    } else if (noFaceSince.current == null) {
      noFaceSince.current = Date.now();
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      if (
        noFaceSince.current &&
        now - noFaceSince.current > 3000 &&
        now - lastNoFaceViolation.current > 5000
      ) {
        lastNoFaceViolation.current = now;
        addViolation('face', 'No face detected for 3+ seconds');
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [addViolation]);

  const handleCameraStatus = useCallback((status, errMsg) => {
    setCameraStatus(status);
    if (errMsg) setCameraError(errMsg);
  }, []);

  const loadUrl = () => {
    let next = urlInput.trim();
    if (!next) return;
    if (!/^https?:\/\//i.test(next)) next = 'https://' + next;
    setActiveUrl(next);
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
        <SiteFrame url={activeUrl} />
        <aside className="sidebar">
          <FaceMonitor
            onCameraStatus={handleCameraStatus}
            onFaceStatus={handleFaceStatus}
          />
          <Dashboard
            cameraStatus={cameraStatus}
            cameraError={cameraError}
            faceDetected={faceDetected}
            focused={focused}
            fullscreen={fullscreen}
            violations={violations}
          />
        </aside>
      </div>
    </div>
  );
}
