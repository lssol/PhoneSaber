// Webcam → MediaPipe Pose → upper-body landmarks in metres.
//
// Runs on the main thread (MediaPipe internally uses importScripts() in its
// WASM loader, which is incompatible with both module and classic web workers).
// GPU delegate is tried first; falls back to CPU on failure.
//
// Axes (MediaPipe world frame, verified empirically):
//   +X = subject's left   (image right when not mirrored)
//   +Y = down
//   +Z = away from camera
// Re-mapped to three.js convention in fusion.ts.

import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export type Vec3 = { x: number; y: number; z: number };

export type BodyFrame = {
  leftShoulder: Vec3;
  rightShoulder: Vec3;
  leftWrist: Vec3;
  rightWrist: Vec3;
  leftWristVisible: boolean;
  rightWristVisible: boolean;
  timeSec: number;
  processingMs: number;
};

const LM = { LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12, LEFT_WRIST: 15, RIGHT_WRIST: 16 } as const;
const MIN_VISIBILITY = 0.5;

export async function startVision(
  video: HTMLVideoElement,
  onFrame: (frame: BodyFrame) => void,
): Promise<{ stop: () => void; delegate: string }> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 320, height: 240, facingMode: 'user' },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();

  const fileset = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm',
  );

  const MODEL_URL =
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

  const opts = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO' as const,
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  let landmarker: PoseLandmarker;
  let delegate: 'GPU' | 'CPU';
  try {
    landmarker = await PoseLandmarker.createFromOptions(fileset, opts('GPU'));
    delegate = 'GPU';
  } catch {
    landmarker = await PoseLandmarker.createFromOptions(fileset, opts('CPU'));
    delegate = 'CPU';
  }

  // Wait until the video element has real frame data and dimensions.
  if (video.readyState < 2 || video.videoWidth === 0) {
    await new Promise<void>((resolve) => {
      const ok = () => {
        if (video.readyState >= 2 && video.videoWidth > 0) {
          video.removeEventListener('loadeddata', ok);
          resolve();
        }
      };
      video.addEventListener('loadeddata', ok);
      ok();
    });
  }

  let stopped = false;
  let lastTimestamp = -1;
  let inFlight = false;

  const tick = () => {
    if (stopped) return;
    requestAnimationFrame(tick);
    if (inFlight) return;
    if (video.readyState < 2 || video.videoWidth === 0) return;

    const tsMs = performance.now();
    if (tsMs <= lastTimestamp) return;
    lastTimestamp = tsMs;

    inFlight = true;
    try {
      const t0 = performance.now();
      const result = landmarker.detectForVideo(video, tsMs);
      const processingMs = performance.now() - t0;
      const world = result.worldLandmarks?.[0];
      const screen = result.landmarks?.[0];
      if (world && screen) {
        onFrame({
          leftShoulder: toVec(world[LM.LEFT_SHOULDER]),
          rightShoulder: toVec(world[LM.RIGHT_SHOULDER]),
          leftWrist: toVec(world[LM.LEFT_WRIST]),
          rightWrist: toVec(world[LM.RIGHT_WRIST]),
          leftWristVisible: (screen[LM.LEFT_WRIST].visibility ?? 0) > MIN_VISIBILITY,
          rightWristVisible: (screen[LM.RIGHT_WRIST].visibility ?? 0) > MIN_VISIBILITY,
          timeSec: tsMs / 1000,
          processingMs,
        });
      }
    } catch (err) {
      console.error('[vision] detectForVideo failed', err);
    } finally {
      inFlight = false;
    }
  };
  tick();

  return {
    stop: () => {
      stopped = true;
      stream.getTracks().forEach((t) => t.stop());
      landmarker.close();
    },
    delegate,
  };
}

function toVec(lm: { x: number; y: number; z: number }): Vec3 {
  return { x: lm.x, y: lm.y, z: lm.z };
}
