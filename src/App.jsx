import { useCallback, useEffect, useRef, useState } from 'react';
import SiteFrame from './components/SiteFrame.jsx';
import FaceMonitor from './components/FaceMonitor.jsx';
import Dashboard from './components/Dashboard.jsx';
import { useWindowEvents } from './hooks/useWindowEvents.js';
import { useFairnessScore } from './hooks/useFairnessScore.js';

const CODES_STORAGE_KEY = 'smartbrowser_codes';

async function verifyTestCode(code) {
  if (!code) return { valid: false, error: 'Please enter a test code.' };
  const cleanCode = code.trim().toUpperCase();

  if (typeof window !== 'undefined' && window.electronAPI && typeof window.electronAPI.verifyCode === 'function') {
    try {
      const ipcResult = await window.electronAPI.verifyCode(cleanCode);
      if (ipcResult && (ipcResult.valid || ipcResult.expired)) {
        return ipcResult;
      }
    } catch {
    }
  }

  try {
    const apiTarget = window.location.port === '5173'
      ? `/api/codes/${encodeURIComponent(cleanCode)}`
      : `http://127.0.0.1:5173/api/codes/${encodeURIComponent(cleanCode)}`;
    const res = await fetch(apiTarget);
    const data = await res.json();
    if (res.ok && data.valid) return data;
    if (data.expired) return data;
    if (data.error && res.status !== 404) return data;
  } catch {
  }

  let codes = [];
  try {
    codes = JSON.parse(localStorage.getItem(CODES_STORAGE_KEY) || '[]');
  } catch {
    codes = [];
  }

  const record = codes.find((entry) => entry.code === cleanCode);
  if (record) {
    const now = Date.now();
    const expiry = record.expiresTimestamp || (record.expiresAt ? new Date(record.expiresAt).getTime() : 0);
    if (expiry && now > expiry) {
      return {
        valid: false,
        error: 'This test code has expired. Codes are only valid for 20 seconds.',
        expired: true,
      };
    }
    return { valid: true, url: record.url, code: record.code, record };
  }

  const legacyUrl = decodeTestCode(code.trim());
  if (legacyUrl) {
    return { valid: true, url: legacyUrl, code: cleanCode };
  }

  return { valid: false, error: 'Invalid test code. Please check and try again.' };
}

function decodeTestCode(code) {
  const sep = code.indexOf('-');
  if (sep === -1) return null;

  const b64part = code.slice(sep + 1);

  let b64 = b64part.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';

  try {
    return decodeURIComponent(escape(atob(b64)));
  } catch {
    return null;
  }
}

const DEFAULT_URL = 'https://google.com';

let violationId = 0;
let urlLogId = 0;

export default function App() {
  const [started, setStarted] = useState(false);
  const [authStep, setAuthStep] = useState('code');
  const [testCode, setTestCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [verifiedUrl, setVerifiedUrl] = useState('');
  const [verifiedCode, setVerifiedCode] = useState('');

  const [enrollmentNumber, setEnrollmentNumber] = useState('');
  const [batch, setBatch] = useState('');
  const [studentError, setStudentError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const handleStartWithCode = async () => {
    const trimmed = testCode.trim();
    if (!trimmed) {
      setCodeError('Please enter a test code.');
      return;
    }
    setVerifyingCode(true);
    setCodeError('');
    try {
      const result = await verifyTestCode(trimmed);
      if (!result.valid) {
        setCodeError(result.error || 'Invalid code. Please check and try again.');
        return;
      }
      try {
        new URL(result.url);
      } catch {
        setCodeError('Invalid code. Could not extract a valid URL.');
        return;
      }
      setCodeError('');
      setVerifiedCode(result.code);
      setVerifiedUrl(result.url);
      setAuthStep('student_form');
    } finally {
      setVerifyingCode(false);
    }
  };

  const handleStudentSubmit = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const trimmedEnrollment = enrollmentNumber.trim();
    const trimmedBatch = batch.trim();

    if (!trimmedEnrollment && !trimmedBatch) {
      setStudentError('Enrollment Number and Batch are required.');
      return;
    }
    if (!trimmedEnrollment) {
      setStudentError('Enrollment Number is required.');
      return;
    }
    if (!trimmedBatch) {
      setStudentError('Batch is required.');
      return;
    }

    setStudentError('');
    setSuccessMessage('Student details verified! Starting assessment...');

    const studentData = {
      enrollmentNumber: trimmedEnrollment,
      batch: trimmedBatch,
      testCode: verifiedCode,
      url: verifiedUrl,
      timestamp: Date.now(),
      submittedAt: new Date().toISOString(),
    };

    try {
      localStorage.setItem('smartbrowser_student', JSON.stringify(studentData));
      const history = JSON.parse(localStorage.getItem('smartbrowser_students') || '[]');
      history.unshift(studentData);
      localStorage.setItem('smartbrowser_students', JSON.stringify(history));

      const codes = JSON.parse(localStorage.getItem(CODES_STORAGE_KEY) || '[]');
      const target = codes.find((c) => c.code === verifiedCode);
      if (target) {
        if (!target.students) target.students = [];
        target.students.push({
          enrollmentNumber: trimmedEnrollment,
          batch: trimmedBatch,
          submittedAt: new Date().toISOString(),
        });
        localStorage.setItem(CODES_STORAGE_KEY, JSON.stringify(codes));
      }
    } catch (err) {
      console.error('Failed to save student details to localStorage:', err);
    }

    setTimeout(() => {
      setUrlInput(verifiedUrl);
      setActiveUrl(verifiedUrl);
      setUrlLogs([{ id: ++urlLogId, time: new Date().toLocaleTimeString(), url: verifiedUrl }]);
      setStarted(true);
    }, 600);
  };

  const handleStartWithoutCode = () => {
    setVerifiedUrl(urlInput);
    setVerifiedCode('MANUAL');
    setAuthStep('student_form');
  };

  const [urlInput, setUrlInput] = useState(DEFAULT_URL);
  const [activeUrl, setActiveUrl] = useState(DEFAULT_URL);

  const [urlLogs, setUrlLogs] = useState(() => [
    { id: ++urlLogId, time: new Date().toLocaleTimeString(), url: DEFAULT_URL },
  ]);

  const [cameraStatus, setCameraStatus] = useState('idle');
  const [cameraError, setCameraError] = useState('');
  const [faceDetected, setFaceDetected] = useState(null);

  const [focused, setFocused] = useState(true);
  const [fullscreen, setFullscreen] = useState(true);
  const [violations, setViolations] = useState([]);

  const { score: fairnessScore, breakdown: fairnessBreakdown, recordViolation } = useFairnessScore();

  const addViolation = useCallback((type, message) => {
    setViolations((prev) =>
      [
        { id: ++violationId, time: new Date().toLocaleTimeString(), type, message },
        ...prev,
      ].slice(0, 200)
    );
    recordViolation(type);
  }, [recordViolation]);

  const addWarning = useCallback((type, message) => {
    setViolations((prev) =>
      [
        { id: ++violationId, time: new Date().toLocaleTimeString(), type, message },
        ...prev,
      ].slice(0, 200)
    );
  }, []);

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

  const obstacleSince = useRef({});
  const lastSeenObstacle = useRef({});
  const lastObstacleViolation = useRef({});
  const [obstaclesCount, setObstaclesCount] = useState(0);

  const unfocusedSince = useRef(null);
  const lastFocusViolation = useRef(0);

  const notFullscreenSince = useRef(null);
  const lastNotFullscreenViolation = useRef(0);

  const handleFaceStatus = useCallback((isFace) => {
    setFaceDetected(isFace ? 1 : 0);
  }, []);

  const handleDetectionUpdate = useCallback((data) => {
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

    if (faceCount > 0) {
      noFaceSince.current = null;
    } else if (noFaceSince.current == null) {
      noFaceSince.current = now;
    }

    if (faceCount <= 1) {
      multipleFacesSince.current = null;
    } else if (multipleFacesSince.current == null) {
      multipleFacesSince.current = now;
    }

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

    const activeCategories = detectedObstacles.map(obj => obj.category);
    
    activeCategories.forEach(cat => {
      lastSeenObstacle.current[cat] = now;
      if (obstacleSince.current[cat] == null) {
        obstacleSince.current[cat] = now;
      }
    });

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

      if (
        noFaceSince.current &&
        now - noFaceSince.current > 3000 &&
        now - lastNoFaceViolation.current > 5000
      ) {
        lastNoFaceViolation.current = now;
        addViolation('face', 'No face detected for 3+ seconds');
      }

      if (
        multipleFacesSince.current &&
        now - multipleFacesSince.current > 3000 &&
        now - lastMultipleFacesViolation.current > 5000
      ) {
        lastMultipleFacesViolation.current = now;
        const count = currentFaceCount.current;
        addViolation('multiple-faces', `Multiple people detected (${count} faces) for 3+ seconds`);
      }

      if (
        gazeAwaySince.current &&
        now - gazeAwaySince.current > 1500 &&
        now - lastGazeViolation.current > 5000
      ) {
        lastGazeViolation.current = now;
        const dir = currentGazeDirection.current || 'Away';
        addViolation('gaze', `Looking away from screen (${dir})`);
      }

      Object.keys(obstacleSince.current).forEach((cat) => {
        const detectedAt = obstacleSince.current[cat];
        const lastViolatedAt = lastObstacleViolation.current[cat] || 0;

        if (
          detectedAt &&
          now - detectedAt > 1000 &&
          now - lastViolatedAt > 5000
        ) {
          lastObstacleViolation.current[cat] = now;
          const friendlyName = FRIENDLY_NAMES[cat] || cat.charAt(0).toUpperCase() + cat.slice(1);
          addViolation('obstacle', `[OBJECT DETECTED] ${friendlyName} present for 1+ second`);
        }
      });

      if (
        unfocusedSince.current &&
        now - unfocusedSince.current > 2000 &&
        now - lastFocusViolation.current > 2000
      ) {
        lastFocusViolation.current = now;
        const secs = Math.round((now - unfocusedSince.current) / 1000);
        addViolation('focus', `Window still unfocused (${secs}s)`);
      }

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
  };

  if (!started) {
    return (
      <div className="code-entry-screen">
        <div className="code-entry-card">
          <div className="code-entry-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          {authStep === 'code' ? (
            <>
              <h1 className="code-entry-title">Smart Browser</h1>
              <p className="code-entry-subtitle">Secure Assessment Platform</p>

              <div className="code-entry-form">
                <label className="code-entry-label" htmlFor="testCodeInput">Enter Test Code</label>
                <input
                  id="testCodeInput"
                  className="code-entry-input"
                  type="text"
                  value={testCode}
                  onChange={(e) => { setTestCode(e.target.value); setCodeError(''); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleStartWithCode()}
                  placeholder="e.g. A7X9K2"
                  autoFocus
                  spellCheck={false}
                />
                {codeError && <p className="code-entry-error">{codeError}</p>}
                <button className="code-entry-btn" id="verifyCodeBtn" onClick={handleStartWithCode} disabled={verifyingCode}>
                  {verifyingCode ? 'Verifying...' : 'Start Test'}
                </button>
                <button className="code-entry-skip" onClick={handleStartWithoutCode}>
                  Skip — enter URL manually
                </button>
              </div>
            </>
          ) : (
            <form className="code-entry-form" onSubmit={handleStudentSubmit} id="studentDetailsForm">
              <div className="code-verified-badge">
                <span>Code: <strong>{verifiedCode}</strong> Verified</span>
              </div>
              <h1 className="code-entry-title">Student Details</h1>
              <p className="code-entry-subtitle">Enter your information to proceed</p>

              <div className="form-field">
                <label className="code-entry-label" htmlFor="enrollmentInput">Enrollment Number</label>
                <input
                  id="enrollmentInput"
                  className="code-entry-input"
                  type="text"
                  value={enrollmentNumber}
                  onChange={(e) => { setEnrollmentNumber(e.target.value); setStudentError(''); }}
                  placeholder="e.g. 0101IT211025"
                  autoFocus
                />
              </div>

              <div className="form-field">
                <label className="code-entry-label" htmlFor="batchInput">Batch</label>
                <input
                  id="batchInput"
                  className="code-entry-input"
                  type="text"
                  value={batch}
                  onChange={(e) => { setBatch(e.target.value); setStudentError(''); }}
                  placeholder="e.g. 2021-2025"
                />
              </div>

              {studentError && <p className="code-entry-error" id="studentErrorText">{studentError}</p>}
              {successMessage && <p className="code-entry-success" id="studentSuccessText">{successMessage}</p>}

              <button className="code-entry-btn" id="continueBtn" type="submit">
                Continue
              </button>
              <button
                type="button"
                className="code-entry-skip"
                onClick={() => { setAuthStep('code'); setStudentError(''); setSuccessMessage(''); }}
              >
                ← Back to Code Entry
              </button>
            </form>
          )}
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
            setUrlInput(navUrl);
            logUrl(navUrl);
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

