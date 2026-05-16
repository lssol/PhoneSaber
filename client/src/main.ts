// Entry point. Wires sensors + vision into the fusion pipeline and renders.
//
// Two-pose calibration: each volume-down (or `c` / Space) press captures one
// pose. The HUD walks the user through it. After pose B we have the rotation
// that maps IMU-world to scene, and we're "ready".
// Calibration also doubles as the user-gesture that unlocks Web Audio.

import * as THREE from 'three';
import { createScene } from './scene';
import { connectSensors } from './sensors';
import { startVision, type BodyFrame } from './vision';
import { Fusion, defaultCalibration } from './fusion';
import { maybeTriggerSwing, startHum, unlockAudio } from './audio';

const WS_URL = `ws://${location.hostname}:8080`;

const hud = document.getElementById('hud')!;
const video = document.getElementById('cam') as HTMLVideoElement;

const { saber, updateSaberTrail, render } = createScene();

const imuQuat = new THREE.Quaternion(0, 0, 0, 1);
let latestBody: BodyFrame | null = null;

const fusion = new Fusion(defaultCalibration());

const stats = { rot: 0, acc: 0, vis: 0 };
const frameStats = {
  frames: 0,
  lastSampleAt: 0,
  fps: 0,
  frameMs: 0,
};
const latency = {
  lastImuMs: 0,
  lastVisionMs: 0,
  mediapipeMs: 0,
  imuAgeMs: 0,
  visionAgeMs: 0,
};
let connectionState = 'connecting…';
let visionState = 'starting…';

const doCalibrate = () => {
  fusion.capturePose(imuQuat, latestBody);
  unlockAudio().then(startHum);
};

connectSensors(WS_URL, {
  onState: (s) => (connectionState = s),
  onRotation: (f) => {
    stats.rot++;
    imuQuat.set(f.x, f.y, f.z, f.w);
    latency.lastImuMs = performance.now();
  },
  onAcceleration: (f) => {
    stats.acc++;
    maybeTriggerSwing(Math.hypot(f.x, f.y, f.z));
    fusion.integrateAccel(f.x, f.y, f.z, imuQuat, performance.now() / 1000);
  },
  onCalibrate: doCalibrate,
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyC' || e.code === 'Space') doCalibrate();
  if (e.code === 'KeyR') fusion.resetCalibration();
});

startVision(video, (frame) => {
  stats.vis++;
  latestBody = frame;
  fusion.updatePosition(frame);
  latency.lastVisionMs = performance.now();
  latency.mediapipeMs = frame.processingMs;
}).then(
  ({ delegate }) => (visionState = `tracking (${delegate})`),
  (err) => {
    visionState = `error: ${err.message ?? err}`;
    console.error('[vision]', err);
  },
);

function calibrationPrompt(): string {
  switch (fusion.stage) {
    case 'idle':
      return 'Calibrate: press volume-down (or c / Space) to start.';
    case 'awaiting-up':
      return 'Calibration 1/2: hold the saber pointing UP (toward the ceiling). Press to capture.';
    case 'awaiting-forward':
      return 'Calibration 2/2: hold the saber pointing FORWARD (toward the screen), arms in your resting stance. Press to capture.';
    case 'ready':
      return 'Calibrated. Press volume-down to redo. R to clear.';
  }
}

setInterval(() => {
  const now = performance.now();
  latency.imuAgeMs = latency.lastImuMs > 0 ? now - latency.lastImuMs : NaN;
  latency.visionAgeMs = latency.lastVisionMs > 0 ? now - latency.lastVisionMs : NaN;

  const fmt = (v: number, unit: string) => isNaN(v) ? '—' : `${v.toFixed(1)}${unit}`;
  hud.textContent =
    `${WS_URL}  ${connectionState}\n` +
    `vision: ${visionState}\n` +
    `three ${frameStats.fps.toFixed(1)} fps   ${frameStats.frameMs.toFixed(1)} ms\n` +
    `rot ${stats.rot}/s   acc ${stats.acc}/s   vis ${stats.vis}/s\n` +
    `── latency ──────────────────────────\n` +
    `imu age    ${fmt(latency.imuAgeMs, 'ms')}\n` +
    `vision age ${fmt(latency.visionAgeMs, 'ms')}   mp ${fmt(latency.mediapipeMs, 'ms')}\n` +
    `correction ${fusion.lastCorrectionDeltaM.toFixed(4)} m\n` +
    `${calibrationPrompt()}`;
  stats.rot = 0;
  stats.acc = 0;
  stats.vis = 0;
}, 250);

function animate(now: number) {
  requestAnimationFrame(animate);

  frameStats.frames++;
  if (frameStats.lastSampleAt === 0) {
    frameStats.lastSampleAt = now;
  } else {
    const elapsed = now - frameStats.lastSampleAt;
    if (elapsed >= 500) {
      frameStats.fps = (frameStats.frames * 1000) / elapsed;
      frameStats.frameMs = elapsed / frameStats.frames;
      frameStats.frames = 0;
      frameStats.lastSampleAt = now;
    }
  }

  fusion.updateOrientation(imuQuat);
  saber.position.copy(fusion.position);
  saber.quaternion.copy(fusion.orientation);
  updateSaberTrail(now);
  render();
}
requestAnimationFrame(animate);
