import { useCallback, useEffect, useRef, useState } from 'react';
import SiteFrame from './components/SiteFrame.jsx';
import FaceMonitor from './components/FaceMonitor.jsx';
import Dashboard from './components/Dashboard.jsx';
import { useWindowEvents } from './hooks/useWindowEvents.js';
import { useFairnessScore } from './hooks/useFairnessScore.js';
import { resolvePreset, engineConfigFromPreset, DEFAULT_PRESET_ID } from './engine/proctoringPresets.js';
import { calculateNormalizedScore } from './engine/scoreNormalizer.js';

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
const API_BASE_URL = 'http://localhost:3001/api';

let violationId = 0;
let urlLogId = 0;

export default function App() {
  const [started, setStarted] = useState(false);
  const [testCode, setTestCode] = useState('');
  const [studentName, setStudentName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [studentEmail, setStudentEmail] = useState('');
  const [sessionStartTime, setSessionStartTime] = useState(null);
  const [activeCodeData, setActiveCodeData] = useState(null);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [isSubmittingSession, setIsSubmittingSession] = useState(false);
  const [studentRawScoreInput, setStudentRawScoreInput] = useState('');
  const [completedSessionResult, setCompletedSessionResult] = useState(null);
  const [codeError, setCodeError] = useState('');
  const [isValidatingCode, setIsValidatingCode] = useState(false);

  const [activePreset, setActivePreset] = useState(() => resolvePreset(DEFAULT_PRESET_ID));
  const activePresetRef = useRef(activePreset);
  activePresetRef.current = activePreset;

  const applyPreset = (rawPreset) => {
    const resolved = resolvePreset(rawPreset);
    setActivePreset(resolved);
    return resolved;
  };

  const handleStartWithCode = async () => {
    const trimmed = testCode.trim();
    if (!trimmed) {
      setCodeError('Please enter an assessment code.');
      return;
    }

    setCodeError('');
    setIsValidatingCode(true);

    try {
      const res = await fetch(`${API_BASE_URL}/codes/${encodeURIComponent(trimmed)}`);
      
      if (res.ok) {
        const data = await res.json();
        if (data.url) {
          applyPreset(data.preset || data.presetId || data.proctoringLevel);
          setUrlInput(data.url);
          setActiveUrl(data.url);
          setUrlLogs([{ id: ++urlLogId, time: new Date().toLocaleTimeString(), url: data.url }]);
          setActiveCodeData(data);
          setSessionStartTime(Date.now());
          setStarted(true);
          return;
        }
      } else if (res.status === 404) {
        const legacyDecoded = decodeTestCode(trimmed);
        if (legacyDecoded) {
          try {
            new URL(legacyDecoded);
            applyPreset(null);
            setUrlInput(legacyDecoded);
            setActiveUrl(legacyDecoded);
            setUrlLogs([{ id: ++urlLogId, time: new Date().toLocaleTimeString(), url: legacyDecoded }]);
            setActiveCodeData({ code: trimmed, url: legacyDecoded, maxScore: 100, normalizationRule: 'multiplier' });
            setSessionStartTime(Date.now());
            setStarted(true);
            return;
          } catch {
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
      const legacyDecoded = decodeTestCode(trimmed);
      if (legacyDecoded) {
        try {
          new URL(legacyDecoded);
          applyPreset(null);
          setUrlInput(legacyDecoded);
          setActiveUrl(legacyDecoded);
          setUrlLogs([{ id: ++urlLogId, time: new Date().toLocaleTimeString(), url: legacyDecoded }]);
          setActiveCodeData({ code: trimmed, url: legacyDecoded, maxScore: 100, normalizationRule: 'multiplier' });
          setSessionStartTime(Date.now());
          setStarted(true);
          return;
        } catch {
        }
      }
      setCodeError('Cannot reach assessment server. Ensure backend is running on http://localhost:3001.');
    } finally {
      setIsValidatingCode(false);
    }
  };

  const handleStartWithoutCode = () => {
    applyPreset(null);
    setActiveCodeData({ code: 'MANUAL', url: DEFAULT_URL, maxScore: 100, normalizationRule: 'multiplier' });
    setSessionStartTime(Date.now());
    setStarted(true);
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

  const { score: fairnessScore, breakdown: fairnessBreakdown, recordViolation } = useFairnessScore(
    engineConfigFromPreset(activePreset),
    { grace: activePreset.grace }
  );

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
      const pv = activePresetRef.current.violations || {};
      const setting = (type, fallbackDwell, fallbackCooldown) => {
        const cfg = pv[type];
        if (cfg && cfg.enabled === false) return null;
        return {
          dwell: cfg?.dwellMs ?? fallbackDwell,
          cooldown: cfg?.cooldownMs ?? fallbackCooldown,
        };
      };

      const faceCfg = setting('face', 3000, 5000);
      if (
        faceCfg &&
        noFaceSince.current &&
        now - noFaceSince.current > faceCfg.dwell &&
        now - lastNoFaceViolation.current > faceCfg.cooldown
      ) {
        lastNoFaceViolation.current = now;
        addViolation('face', `No face detected for ${Math.round(faceCfg.dwell / 100) / 10}+ seconds`);
      }

      const multiCfg = setting('multiple-faces', 3000, 5000);
      if (
        multiCfg &&
        multipleFacesSince.current &&
        now - multipleFacesSince.current > multiCfg.dwell &&
        now - lastMultipleFacesViolation.current > multiCfg.cooldown
      ) {
        lastMultipleFacesViolation.current = now;
        const count = currentFaceCount.current;
        addViolation('multiple-faces', `Multiple people detected (${count} faces)`);
      }

      const gazeCfg = setting('gaze', 1500, 5000);
      if (
        gazeCfg &&
        gazeAwaySince.current &&
        now - gazeAwaySince.current > gazeCfg.dwell &&
        now - lastGazeViolation.current > gazeCfg.cooldown
      ) {
        lastGazeViolation.current = now;
        const dir = currentGazeDirection.current || 'Away';
        addViolation('gaze', `Looking away from screen (${dir})`);
      }

      const obstacleCfg = setting('obstacle', 1000, 5000);
      if (obstacleCfg) {
        Object.keys(obstacleSince.current).forEach((cat) => {
          const detectedAt = obstacleSince.current[cat];
          const lastViolatedAt = lastObstacleViolation.current[cat] || 0;

          if (
            detectedAt &&
            now - detectedAt > obstacleCfg.dwell &&
            now - lastViolatedAt > obstacleCfg.cooldown
          ) {
            lastObstacleViolation.current[cat] = now;
            const friendlyName = FRIENDLY_NAMES[cat] || cat.charAt(0).toUpperCase() + cat.slice(1);
            addViolation('obstacle', `[OBJECT DETECTED] ${friendlyName} present for ${Math.round(obstacleCfg.dwell / 100) / 10}+ second`);
          }
        });
      }

      const focusCfg = setting('focus', 2000, 2000);
      if (
        focusCfg &&
        unfocusedSince.current &&
        now - unfocusedSince.current > focusCfg.dwell &&
        now - lastFocusViolation.current > focusCfg.cooldown
      ) {
        lastFocusViolation.current = now;
        const secs = Math.round((now - unfocusedSince.current) / 1000);
        addViolation('focus', `Window still unfocused (${secs}s)`);
      }

      const fullscreenCfg = setting('fullscreen', 1000, 5000);
      if (
        fullscreenCfg &&
        notFullscreenSince.current &&
        now - notFullscreenSince.current > fullscreenCfg.dwell &&
        now - lastNotFullscreenViolation.current > fullscreenCfg.cooldown
      ) {
        lastNotFullscreenViolation.current = now;
        addViolation('fullscreen', 'Fullscreen not enabled');
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

  const handleSubmitSession = async () => {
    setIsSubmittingSession(true);
    try {
      const rawNum = studentRawScoreInput.trim() !== '' ? Number(studentRawScoreInput) : null;
      const duration = Math.max(1, Math.round((Date.now() - (sessionStartTime || Date.now())) / 1000));
      const finalStudentName = studentName.trim() || 'Candidate';
      const finalStudentId = studentId.trim() || '';

      let result = null;
      if (activeCodeData?.code && activeCodeData.code !== 'MANUAL') {
        const res = await fetch(`${API_BASE_URL}/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: activeCodeData.code,
            studentName: finalStudentName,
            studentId: finalStudentId,
            studentEmail: studentEmail.trim() || null,
            rawScore: rawNum,
            fairnessScore: Math.round(fairnessScore),
            violationsCount: violations.length,
            violationsSummary: fairnessBreakdown,
            urlLogs: urlLogs,
            durationSeconds: duration,
            startedAt: sessionStartTime ? new Date(sessionStartTime).toISOString() : new Date().toISOString(),
            submittedAt: new Date().toISOString(),
          }),
        });
        if (res.ok) {
          result = await res.json();
        }
      }

      if (!result) {
        const max = activeCodeData?.maxScore || 100;
        const normScore = calculateNormalizedScore({
          rule: activeCodeData?.normalizationRule || 'multiplier',
          rawScore: rawNum !== null ? rawNum : max,
          fairnessScore: Math.round(fairnessScore),
          maxScore: max,
          passThreshold: activePreset?.passThreshold || 70,
        });
        result = {
          id: 'sess-' + Math.random().toString(36).substring(2, 9),
          code: activeCodeData?.code || 'LOCAL',
          studentName: finalStudentName,
          studentId: finalStudentId,
          rawScore: rawNum,
          maxScore: max,
          fairnessScore: Math.round(fairnessScore),
          normalizedScore: normScore,
          status: fairnessScore >= (activePreset?.passThreshold || 70) ? 'passed' : 'flagged',
          durationSeconds: duration,
          violationsCount: violations.length,
          platformType: activeCodeData?.platformType || 'google-forms',
          normalizationRule: activeCodeData?.normalizationRule || 'multiplier',
        };
      }

      setShowSubmitModal(false);
      setCompletedSessionResult(result);
    } catch (err) {
      console.error('Session submit error:', err);
      const max = activeCodeData?.maxScore || 100;
      const rawNum = studentRawScoreInput.trim() !== '' ? Number(studentRawScoreInput) : null;
      const normScore = calculateNormalizedScore({
        rule: activeCodeData?.normalizationRule || 'multiplier',
        rawScore: rawNum !== null ? rawNum : max,
        fairnessScore: Math.round(fairnessScore),
        maxScore: max,
        passThreshold: activePreset?.passThreshold || 70,
      });
      setCompletedSessionResult({
        id: 'local-' + Date.now(),
        code: activeCodeData?.code || testCode || 'MANUAL',
        studentName: studentName.trim() || 'Candidate',
        studentId: studentId.trim() || '',
        rawScore: rawNum,
        maxScore: max,
        fairnessScore: Math.round(fairnessScore),
        normalizedScore: normScore,
        status: fairnessScore >= (activePreset?.passThreshold || 70) ? 'passed' : 'flagged',
        durationSeconds: Math.max(1, Math.round((Date.now() - (sessionStartTime || Date.now())) / 1000)),
        violationsCount: violations.length,
        platformType: activeCodeData?.platformType || 'google-forms',
        normalizationRule: activeCodeData?.normalizationRule || 'multiplier',
      });
      setShowSubmitModal(false);
    } finally {
      setIsSubmittingSession(false);
    }
  };

  const handleResetToStart = () => {
    setStarted(false);
    setCompletedSessionResult(null);
    setShowSubmitModal(false);
    setTestCode('');
    setStudentRawScoreInput('');
    setViolations([]);
    setUrlLogs([{ id: ++urlLogId, time: new Date().toLocaleTimeString(), url: DEFAULT_URL }]);
    setActiveUrl(DEFAULT_URL);
    setUrlInput(DEFAULT_URL);
  };

  if (completedSessionResult) {
    const isPass = completedSessionResult.status === 'passed';
    return (
      <div className="code-entry-screen">
        <div className="code-entry-card session-completed-card">
          <div className="success-icon-wrap">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <span className="code-entry-badge" style={{ background: isPass ? 'rgba(34,197,94,0.15)' : 'rgba(234,179,8,0.15)', borderColor: isPass ? 'rgba(34,197,94,0.35)' : 'rgba(234,179,8,0.35)', color: isPass ? '#4ade80' : '#facc15' }}>
            {isPass ? 'SESSION COMPLETED & REPORT TRANSMITTED' : 'SESSION FLAGGED FOR INSTRUCTOR REVIEW'}
          </span>
          <h1 className="code-entry-title">Assessment Submitted</h1>
          <p className="code-entry-subtitle">
            Candidate: <strong style={{ color: '#fff' }}>{completedSessionResult.studentName}</strong>
            {completedSessionResult.studentId ? ` (${completedSessionResult.studentId})` : ''} · Code: <code style={{ color: '#f59e0b' }}>{completedSessionResult.code}</code>
          </p>

          <div className="report-summary-box">
            <div className="report-score-row">
              <div className="score-block">
                <span className="score-label">Fairness Engine Score</span>
                <span className="score-number" style={{ color: isPass ? '#22c55e' : '#eab308' }}>
                  {Math.round(completedSessionResult.fairnessScore)}%
                </span>
                <span className="score-subtext">Status: {completedSessionResult.status.toUpperCase()}</span>
              </div>
              <div className="score-divider" />
              <div className="score-block">
                <span className="score-label">Normalized Total Score</span>
                <span className="score-number highlight">
                  {completedSessionResult.normalizedScore} <small style={{ fontSize: '0.8rem', color: '#94a3b8' }}>/ {completedSessionResult.maxScore}</small>
                </span>
                <span className="score-subtext">{completedSessionResult.normalizationRule?.replace(/_/g, ' ') || 'Normalized'}</span>
              </div>
            </div>

            <div className="report-meta-grid">
              <div><span>Duration:</span> {Math.floor(completedSessionResult.durationSeconds / 60)}m {completedSessionResult.durationSeconds % 60}s</div>
              <div><span>Violations:</span> {completedSessionResult.violationsCount} logged</div>
              <div><span>Platform:</span> {completedSessionResult.platformType || 'Web Form'}</div>
              <div><span>Session ID:</span> {completedSessionResult.id.slice(0, 8)}...</div>
            </div>
          </div>

          <p style={{ color: '#94a3b8', fontSize: '0.84rem', marginTop: '16px', lineHeight: '1.4' }}>
            Your proctoring integrity metrics and normalized score have been transmitted to your instructor.
          </p>

          <button
            className="code-entry-btn"
            style={{ marginTop: '20px' }}
            onClick={handleResetToStart}
          >
            Finish &amp; Close Session
          </button>
        </div>
      </div>
    );
  }

  if (!started) {
    return (
      <div className="code-entry-screen">
        <div className="code-entry-card">
          <div className="code-entry-header">
            <div className="code-entry-icon">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4.75 11.5L4.75 7.295C4.75 6.038 5.253 5.309 6.428 4.864L11.078 3.1C11.723 2.855 12.277 2.855 12.922 3.1L17.572 4.864C18.747 5.309 19.25 6.038 19.25 7.295L19.25 11.5C19.25 16.25 15.75 19.75 12 21.25C8.25 19.75 4.75 16.25 4.75 11.5Z" />
              </svg>
            </div>
            <span className="code-entry-badge">Secure Assessment Browser</span>
            <h1 className="code-entry-title">Smart Browser</h1>
            <p className="code-entry-subtitle">Enter your assessment code to start</p>
          </div>

          <div className="code-entry-form">
            <label className="code-entry-label">Assessment Access Code</label>
            <div className="code-entry-input-wrap">
              <input
                className="code-entry-input"
                type="text"
                value={testCode}
                onChange={(e) => { setTestCode(e.target.value); setCodeError(''); }}
                onKeyDown={(e) => e.key === 'Enter' && handleStartWithCode()}
                placeholder="e.g. 7X9K2M"
                autoFocus
                spellCheck={false}
              />
            </div>

            <div className="student-reg-fields" style={{ display: 'flex', gap: '10px' }}>
              <div style={{ flex: 1.3 }}>
                <label className="code-entry-label">Student Name</label>
                <input
                  className="code-entry-input"
                  type="text"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  placeholder="e.g. Alex Morgan"
                  spellCheck={false}
                />
              </div>
              <div style={{ flex: 0.9 }}>
                <label className="code-entry-label">Roll / ID</label>
                <input
                  className="code-entry-input"
                  type="text"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  placeholder="e.g. 2026-042"
                  spellCheck={false}
                />
              </div>
            </div>

            {codeError && (
              <div className="code-entry-error">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{codeError}</span>
              </div>
            )}
            <button 
              className="code-entry-btn" 
              onClick={handleStartWithCode}
              disabled={isValidatingCode}
              style={{ opacity: isValidatingCode ? 0.7 : 1, cursor: isValidatingCode ? 'wait' : 'pointer' }}
            >
              {isValidatingCode ? 'Verifying...' : 'Start Assessment'}
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
          <span className="preset-badge" title={`Proctoring level: ${activePreset.name} (pass < ${activePreset.passThreshold})`}>
            {activePreset.name} · L{activePreset.level ?? 'C'}
          </span>
          {activeCodeData?.platformType && (
            <span className="platform-tag" title="Target form/platform">
              {activeCodeData.platformType}
            </span>
          )}
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
          <button
            className="btn-submit-exam"
            onClick={() => setShowSubmitModal(true)}
            title="Finish exam and transmit session report to instructor"
          >
            Submit Assessment
          </button>
          <button onClick={() => window.electronAPI?.toggleFullscreen(true)}>
            Fullscreen
          </button>
          <button onClick={() => window.electronAPI?.toggleFullscreen(false)}>
            Exit
          </button>
        </div>
      </header>

      {showSubmitModal && (
        <div className="modal-backdrop">
          <div className="submit-modal-card">
            <h3 style={{ fontSize: '1.25rem', color: '#fff', marginBottom: '6px' }}>Finish &amp; Submit Assessment</h3>
            <p style={{ color: '#94a3b8', fontSize: '0.86rem', lineHeight: '1.4' }}>
              Are you sure you have completed your assessment? Your proctoring fairness score and logs will be calculated and reported to your instructor.
            </p>

            <div className="submit-modal-stats">
              <div className="mini-stat">
                <span className="mini-label">Fairness Score</span>
                <span className="mini-val" style={{ color: fairnessScore >= (activePreset?.passThreshold || 70) ? '#22c55e' : '#eab308' }}>
                  {Math.round(fairnessScore)}%
                </span>
              </div>
              <div className="mini-stat">
                <span className="mini-label">Time Elapsed</span>
                <span className="mini-val">
                  {Math.floor((Date.now() - (sessionStartTime || Date.now())) / 60000)}m
                </span>
              </div>
              <div className="mini-stat">
                <span className="mini-label">Violations</span>
                <span className="mini-val">{violations.length}</span>
              </div>
            </div>

            <div style={{ marginTop: '16px', textAlign: 'left' }}>
              <label style={{ fontSize: '0.78rem', color: '#cbd5e1', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                Exam Raw Score (Optional — if shown upon form submission)
              </label>
              <input
                type="number"
                step="0.5"
                min="0"
                max={activeCodeData?.maxScore || 100}
                value={studentRawScoreInput}
                onChange={(e) => setStudentRawScoreInput(e.target.value)}
                placeholder={`e.g. 85 (out of ${activeCodeData?.maxScore || 100})`}
                className="code-entry-input"
                style={{ padding: '10px 14px', fontSize: '0.95rem' }}
              />
              <small style={{ color: '#64748b', fontSize: '0.74rem', marginTop: '4px', display: 'block' }}>
                Normalized via {activeCodeData?.normalizationRule ? activeCodeData.normalizationRule.replace(/_/g, ' ') : 'Integrity Multiplier'} rule.
              </small>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '20px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowSubmitModal(false)}
                className="btn-cancel"
                disabled={isSubmittingSession}
                style={{ background: 'transparent', border: '1px solid #475569', color: '#cbd5e1', padding: '10px 18px', borderRadius: '8px', cursor: 'pointer' }}
              >
                Continue Exam
              </button>
              <button
                onClick={handleSubmitSession}
                className="btn-confirm-submit"
                disabled={isSubmittingSession}
                style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none', color: '#000', fontWeight: 700, padding: '10px 20px', borderRadius: '8px', cursor: 'pointer' }}
              >
                {isSubmittingSession ? 'Transmitting...' : 'Confirm & Submit'}
              </button>
            </div>
          </div>
        </div>
      )}

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
