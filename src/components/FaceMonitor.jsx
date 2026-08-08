import { useEffect, useRef } from 'react';
import { FilesetResolver, FaceDetector } from '@mediapipe/tasks-vision';

// MediaPipe assets. Loaded from CDN for zero-setup (needs internet on first run;
// files are then HTTP-cached). See the guide for an offline/local option.
const WASM_PATH =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

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

export default function FaceMonitor({ onCameraStatus, onFaceStatus }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const detectorRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    function drawBoxes(detections) {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video || !video.videoWidth) return;
      if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
      if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;

      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 3;
      ctx.font = '14px sans-serif';
      ctx.fillStyle = '#22c55e';
      (detections || []).forEach((d) => {
        const b = d.boundingBox;
        ctx.strokeRect(b.originX, b.originY, b.width, b.height);
        const score = d.categories?.[0]?.score;
        if (score != null) {
          ctx.fillText(`${Math.round(score * 100)}%`, b.originX, b.originY - 6);
        }
      });
    }

    async function init() {
      try {
        onCameraStatus?.('idle');

        // 1) Load MediaPipe vision fileset + face detector.
        const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
        if (cancelled) return;
        detectorRef.current = await createDetector(vision);
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
          if (v && detector && v.readyState >= 2) {
            try {
              const result = detector.detectForVideo(v, performance.now());
              const count = result.detections?.length || 0;
              drawBoxes(result.detections);
              onFaceStatus?.(count > 0);
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
    };
  }, [onCameraStatus, onFaceStatus]);

  return (
    <div className="face-monitor">
      <div className="cam-wrap">
        <video ref={videoRef} className="cam-video" playsInline muted />
        <canvas ref={canvasRef} className="cam-canvas" />
      </div>
    </div>
  );
}
