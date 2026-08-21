import { useEffect, useRef } from 'react';
import { FilesetResolver, FaceDetector, ObjectDetector } from '@mediapipe/tasks-vision';

// MediaPipe assets. Loaded from CDN for zero-setup (needs internet on first run;
// files are then HTTP-cached). See the guide for an offline/local option.
const WASM_PATH =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
const OBJ_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite';

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
      scoreThreshold: 0.30,
    });
  } catch (err) {
    console.warn('GPU delegate for ObjectDetector failed, falling back to CPU:', err);
    return await ObjectDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: OBJ_MODEL_URL, delegate: 'CPU' },
      runningMode: 'VIDEO',
      scoreThreshold: 0.30,
    });
  }
}

export default function FaceMonitor({ onCameraStatus, onFaceStatus, onDetectionUpdate }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const detectorRef = useRef(null);
  const objDetectorRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    const FORBIDDEN_OBJECTS = ['cell phone', 'laptop', 'book'];
    const FRIENDLY_NAMES = {
      'cell phone': 'Mobile Phone',
      'laptop': 'Laptop',
      'book': 'Book',
    };

    function drawBoxes(faceDetections, objectDetections) {
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

      // 2) Draw Object Detections
      (objectDetections || []).forEach((d) => {
        const categoryRaw = d.categories?.[0]?.categoryName;
        if (!categoryRaw) return;
        
        const category = categoryRaw.toLowerCase().trim();
        const score = d.categories?.[0]?.score || 0;
        const b = d.boundingBox;

        if (FORBIDDEN_OBJECTS.includes(category)) {
          // Highlight forbidden objects in RED
          ctx.strokeStyle = '#ef4444';
          ctx.fillStyle = '#ef4444';
          ctx.lineWidth = 3;
          ctx.strokeRect(b.originX, b.originY, b.width, b.height);

          const friendlyName = FRIENDLY_NAMES[category] || categoryRaw;
          const label = `⚠️ Suspicious: ${friendlyName} (${Math.round(score * 100)}%)`;
          ctx.fillText(label, b.originX, b.originY - 6);
        } else {
          // Draw other normal objects in a subtle, thin gray/blue color
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
          ctx.fillStyle = 'rgba(148, 163, 184, 0.6)';
          ctx.lineWidth = 1;
          ctx.strokeRect(b.originX, b.originY, b.width, b.height);

          // Capitalize first letter of category for display
          const capitalized = categoryRaw.charAt(0).toUpperCase() + categoryRaw.slice(1);
          const label = `${capitalized} (${Math.round(score * 100)}%)`;
          ctx.fillText(label, b.originX, b.originY - 4);
        }
      });
    }

    async function init() {
      try {
        onCameraStatus?.('idle');

        // 1) Load MediaPipe vision fileset + face detector + object detector.
        const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
        if (cancelled) return;
        detectorRef.current = await createDetector(vision);
        if (cancelled) return;
        objDetectorRef.current = await createObjectDetector(vision);
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
          if (v && detector && v.readyState >= 2) {
            try {
              const timestamp = performance.now();
              const faceResult = detector.detectForVideo(v, timestamp);
              const faceDetections = faceResult.detections || [];
              const faceCount = faceDetections.length;

              let objectDetections = [];
              if (objDetector) {
                const objResult = objDetector.detectForVideo(v, timestamp);
                objectDetections = objResult.detections || [];
              }

              drawBoxes(faceDetections, objectDetections);

              // Filter out object detections that are forbidden
              const detectedForbidden = objectDetections
                .filter(d => {
                  const catName = d.categories?.[0]?.categoryName;
                  return catName && FORBIDDEN_OBJECTS.includes(catName.toLowerCase().trim());
                })
                .map(d => ({
                  category: d.categories[0].categoryName.toLowerCase().trim(),
                  score: d.categories[0].score,
                }));

              onFaceStatus?.(faceCount > 0);
              onDetectionUpdate?.(faceCount, detectedForbidden);
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
