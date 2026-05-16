// Webcam → MediaPipe Pose → upper-body landmarks in metres.
//
// We only need four landmarks: left/right shoulder and left/right wrist.
// MediaPipe's `worldLandmarks` give us 3D coords in metres with the origin
// at hip-centre, which is exactly the body-anchored frame we want.
//
// Axes (verified empirically against MediaPipe Pose):
//   +X = subject's left   (image right when not mirrored)
//   +Y = down
//   +Z = away from camera
// We re-map to three.js convention in fusion.ts.

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
};

const LM = { LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12, LEFT_WRIST: 15, RIGHT_WRIST: 16 } as const;
const MIN_VISIBILITY = 0.5;

export async function startVision(
  video: HTMLVideoElement,
  onFrame: (frame: BodyFrame) => void,
): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: 'user' },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();

  const fileset = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm',
  );
  // CPU delegate is slower than GPU but dramatically more stable in browsers
  // (GPU has been observed to throw 'index out of bounds' from the WASM
  // finishProcessing path on certain driver/browser combos).
  const landmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
      delegate: 'CPU',
    },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  // Wait until the video element has real frame data and dimensions.
  // Calling detectForVideo before this gives 'index out of bounds' from WASM.
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
    // Timestamps must be strictly monotonic in VIDEO mode.
    if (tsMs <= lastTimestamp) return;
    lastTimestamp = tsMs;

    inFlight = true;
    try {
      const result = landmarker.detectForVideo(video, tsMs);
      const world = result.worldLandmarks?.[0];
      const screen = result.landmarks?.[0]; // image-normalized, has `visibility`
      if (world && screen) {
        onFrame({
          leftShoulder: toVec(world[LM.LEFT_SHOULDER]),
          rightShoulder: toVec(world[LM.RIGHT_SHOULDER]),
          leftWrist: toVec(world[LM.LEFT_WRIST]),
          rightWrist: toVec(world[LM.RIGHT_WRIST]),
          leftWristVisible: (screen[LM.LEFT_WRIST].visibility ?? 0) > MIN_VISIBILITY,
          rightWristVisible: (screen[LM.RIGHT_WRIST].visibility ?? 0) > MIN_VISIBILITY,
          timeSec: tsMs / 1000,
        });
      }
    } catch (err) {
      console.error('[vision] detectForVideo failed', err);
    } finally {
      inFlight = false;
    }
  };
  tick();

  return () => {
    stopped = true;
    stream.getTracks().forEach((t) => t.stop());
    landmarker.close();
  };
}

function toVec(lm: { x: number; y: number; z: number }): Vec3 {
  return { x: lm.x, y: lm.y, z: lm.z };
}
