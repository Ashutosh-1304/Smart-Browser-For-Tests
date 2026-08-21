import { useEffect, useRef } from 'react';
import { FilesetResolver, FaceDetector, ObjectDetector, FaceLandmarker } from '@mediapipe/tasks-vision';

// MediaPipe assets. Loaded from CDN for zero-setup (needs internet on first run;
// files are then HTTP-cached). See the guide for an offline/local option.
const WASM_PATH =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
const OBJ_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite';
const LANDMARK_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

async function createDetector(vision) {
  // Try GPU first; some Electron/GPU combos fail, so fall back to CPU.
  try {
    return await FaceDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
    });
  } catch (err) {
    console.warn('GPU delegate failed, falling back to CPU:', err);
    return await FaceDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
      runningMode: 'VIDEO',
    });
  }
}

async function createObjectDetector(vision) {
  try {
    return await ObjectDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: OBJ_MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      scoreThreshold: 0.18,
    });
  } catch (err) {
    console.warn('GPU delegate for ObjectDetector failed, falling back to CPU:', err);
    return await ObjectDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: OBJ_MODEL_URL, delegate: 'CPU' },
      runningMode: 'VIDEO',
      scoreThreshold: 0.18,
    });
  }
}

async function createLandmarker(vision) {
  try {
    return await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: LANDMARK_MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numFaces: 2,
    });
  } catch (err) {
    console.warn('GPU delegate for FaceLandmarker failed, falling back to CPU:', err);
    return await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: LANDMARK_MODEL_URL, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numFaces: 2,
    });
  }
}

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

function analyzeGaze(landmarks) {
  if (!landmarks || landmarks.length < 478) {
    return { isLookingAway: false, direction: 'Center', ratioH: 0.5, ratioV: 0.5 };
  }

  const rOuter = landmarks[33];
  const rInner = landmarks[133];
  const rIris = landmarks[468];

  const lOuter = landmarks[263];
  const lInner = landmarks[362];
  const lIris = landmarks[473];

  // Horizontal gaze ratio for right eye (normalized x)
  const rMinX = Math.min(rOuter.x, rInner.x);
  const rMaxX = Math.max(rOuter.x, rInner.x);
  const rWidth = rMaxX - rMinX || 0.001;
  const rRatioH = (rIris.x - rMinX) / rWidth;

  // Horizontal gaze ratio for left eye
  const lMinX = Math.min(lOuter.x, lInner.x);
  const lMaxX = Math.max(lOuter.x, lInner.x);
  const lWidth = lMaxX - lMinX || 0.001;
  const lRatioH = (lIris.x - lMinX) / lWidth;

  const avgRatioH = (rRatioH + lRatioH) / 2;

  // Vertical gaze ratio
  const rTop = landmarks[159];
  const rBottom = landmarks[145];
  const rMinY = Math.min(rTop.y, rBottom.y);
  const rMaxY = Math.max(rTop.y, rBottom.y);
  const rHeight = rMaxY - rMinY || 0.001;
  const rRatioV = (rIris.y - rMinY) / rHeight;

  const lTop = landmarks[386];
  const lBottom = landmarks[374];
  const lMinY = Math.min(lTop.y, lBottom.y);
  const lMaxY = Math.max(lTop.y, lBottom.y);
  const lHeight = lMaxY - lMinY || 0.001;
  const lRatioV = (lIris.y - lMinY) / lHeight;

  const avgRatioV = (rRatioV + lRatioV) / 2;

  // Nose / Head turn ratio
  const nose = landmarks[1];
  const rCheek = landmarks[234];
  const lCheek = landmarks[454];
  const faceWidth = Math.abs(lCheek.x - rCheek.x) || 0.001;
  const noseRatioH = (nose.x - Math.min(rCheek.x, lCheek.x)) / faceWidth;

  let isLookingAway = false;
  let direction = 'Center';

  if (avgRatioH < 0.28 || noseRatioH < 0.28) {
    isLookingAway = true;
    direction = 'Looking Right';
  } else if (avgRatioH > 0.72 || noseRatioH > 0.72) {
    isLookingAway = true;
    direction = 'Looking Left';
  } else if (avgRatioV < 0.12) {
    isLookingAway = true;
    direction = 'Looking Up';
  } else if (avgRatioV > 0.88) {
    isLookingAway = true;
    direction = 'Looking Down';
  }

  return { isLookingAway, direction, ratioH: avgRatioH, ratioV: avgRatioV };
}

export default function FaceMonitor({ onCameraStatus, onFaceStatus, onDetectionUpdate }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const detectorRef = useRef(null);
  const objDetectorRef = useRef(null);
  const landmarkerRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    function drawBoxes(faceDetections, obstacleDetections, gazeInfo, landmarksList) {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video || !video.videoWidth) return;
      if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
      if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;

      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 1) Draw Face Detections
      const faceCount = faceDetections?.length || 0;
      const faceColor = faceCount > 1 ? '#ef4444' : '#22c55e'; // Red for multiple faces, Green for single face
      
      ctx.lineWidth = 3;
      ctx.font = 'bold 14px sans-serif';
      
      (faceDetections || []).forEach((d) => {
        const b = d.boundingBox;
        ctx.strokeStyle = faceColor;
        ctx.fillStyle = faceColor;
        ctx.strokeRect(b.originX, b.originY, b.width, b.height);
        
        const score = d.categories?.[0]?.score;
        let label = faceCount > 1 ? '⚠️ Multiple People' : 'Person';
        if (score != null) {
          label += ` (${Math.round(score * 100)}%)`;
        }
        ctx.fillText(label, b.originX, b.originY - 6);
      });

      // 2) Draw Iris Points
      if (landmarksList && landmarksList.length > 0) {
        const primaryLandmarks = landmarksList[0];
        const gazeColor = gazeInfo.isLookingAway ? '#ef4444' : '#22c55e';

        [468, 473].forEach((idx) => {
          const pt = primaryLandmarks[idx];
          if (pt) {
            ctx.beginPath();
            ctx.arc(pt.x * canvas.width, pt.y * canvas.height, 3, 0, 2 * Math.PI);
            ctx.fillStyle = gazeColor;
            ctx.fill();
          }
        });
      }

      // 3) Draw Obstacle Detections
      (obstacleDetections || []).forEach((d) => {
        const categoryRaw = d.categories?.[0]?.categoryName || d.categories?.[0]?.displayName;
        if (!categoryRaw) return;
        
        const category = categoryRaw.toLowerCase().trim();
        const score = d.categories?.[0]?.score || 0;
        const b = d.boundingBox;

        // Draw obstacle bounding box in Red
        ctx.strokeStyle = '#ef4444';
        ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
        ctx.lineWidth = 3;
        ctx.fillRect(b.originX, b.originY, b.width, b.height);
        ctx.strokeRect(b.originX, b.originY, b.width, b.height);

        ctx.fillStyle = '#ef4444';
        const friendlyName = FRIENDLY_NAMES[category] || categoryRaw.charAt(0).toUpperCase() + categoryRaw.slice(1);
        const label = `⚠️ Obstacle: ${friendlyName} (${Math.round(score * 100)}%)`;
        ctx.fillText(label, b.originX, b.originY - 6);
      });
    }

    async function init() {
      try {
        onCameraStatus?.('idle');

        // 1) Load MediaPipe vision fileset + face detector + object detector + landmarker.
        const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
        if (cancelled) return;
        detectorRef.current = await createDetector(vision);
        if (cancelled) return;
        objDetectorRef.current = await createObjectDetector(vision);
        if (cancelled) return;
        landmarkerRef.current = await createLandmarker(vision);
        if (cancelled) return;

        // 2) Start the webcam.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();
        onCameraStatus?.('running');

        // 3) Per-frame detection loop.
        const loop = () => {
          if (cancelled) return;
          const v = videoRef.current;
          const detector = detectorRef.current;
          const objDetector = objDetectorRef.current;
          const landmarker = landmarkerRef.current;

          if (v && detector && v.readyState >= 2) {
            try {
              let timestamp = performance.now();
              const faceResult = detector.detectForVideo(v, timestamp);
              const faceDetections = faceResult.detections || [];
              const faceCount = faceDetections.length;

              let objectDetections = [];
              if (objDetector) {
                timestamp += 0.01;
                const objResult = objDetector.detectForVideo(v, timestamp);
                objectDetections = objResult.detections || [];
              }

              let landmarksList = [];
              let gazeInfo = { isLookingAway: false, direction: 'Center' };
              if (landmarker && faceCount > 0) {
                timestamp += 0.01;
                const landmarkerResult = landmarker.detectForVideo(v, timestamp);
                landmarksList = landmarkerResult.faceLandmarks || [];
                if (landmarksList.length > 0) {
                  gazeInfo = analyzeGaze(landmarksList[0]);
                }
              }

              // Obstacles = any detected object except candidate/person
              const obstacleDetections = objectDetections.filter(d => {
                const catName = d.categories?.[0]?.categoryName || d.categories?.[0]?.displayName;
                return catName && catName.toLowerCase().trim() !== 'person';
              });

              drawBoxes(faceDetections, obstacleDetections, gazeInfo, landmarksList);

              const detectedObstacles = obstacleDetections.map(d => {
                const catName = d.categories[0].categoryName || d.categories[0].displayName || 'object';
                return {
                  category: catName.toLowerCase().trim(),
                  rawName: catName,
                  score: d.categories[0].score,
                };
              });

              onFaceStatus?.(faceCount > 0);
              onDetectionUpdate?.({
                faceCount,
                detectedObstacles,
                isLookingAway: gazeInfo.isLookingAway,
                gazeDirection: gazeInfo.direction,
              });
            } catch (err) {
              console.error('detectForVideo error:', err);
            }
          }
          rafRef.current = requestAnimationFrame(loop);
        };
        loop();
      } catch (err) {
        console.error('FaceMonitor init failed:', err);
        onCameraStatus?.('error', err?.message || String(err));
      }
    }

    init();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      if (detectorRef.current) {
        detectorRef.current.close?.();
        detectorRef.current = null;
      }
      if (objDetectorRef.current) {
        objDetectorRef.current.close?.();
        objDetectorRef.current = null;
      }
      if (landmarkerRef.current) {
        landmarkerRef.current.close?.();
        landmarkerRef.current = null;
      }
    };
  }, [onCameraStatus, onFaceStatus, onDetectionUpdate]);

  return (
    <div className="face-monitor">
      <div className="cam-wrap">
        <video ref={videoRef} className="cam-video" playsInline muted />
        <canvas ref={canvasRef} className="cam-canvas" />
      </div>
    </div>
  );
}

