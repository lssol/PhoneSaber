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

const { saber, render } = createScene();

const imuQuat = new THREE.Quaternion(0, 0, 0, 1);
let latestBody: BodyFrame | null = null;

const fusion = new Fusion(defaultCalibration());

const stats = { rot: 0, acc: 0, vis: 0 };
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
  },
  onAcceleration: (f) => {
    stats.acc++;
    maybeTriggerSwing(Math.hypot(f.x, f.y, f.z));
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
}).then(
  () => (visionState = 'tracking'),
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
      return 'Calibration 1/2: hold the saber pointing UP (toward the ceiling). Press again to capture.';
    case 'awaiting-forward':
      return 'Calibration 2/2: hold the saber pointing FORWARD (toward the screen). Press again to capture.';
    case 'ready':
      return 'Calibrated. Press volume-down to redo. R to clear.';
  }
}

setInterval(() => {
  hud.textContent =
    `${WS_URL}  ${connectionState}\n` +
    `vision: ${visionState}\n` +
    `rot ${stats.rot}/s   acc ${stats.acc}/s   vis ${stats.vis}/s\n` +
    `${calibrationPrompt()}`;
  stats.rot = 0;
  stats.acc = 0;
  stats.vis = 0;
}, 250);

function animate() {
  requestAnimationFrame(animate);
  fusion.updateOrientation(imuQuat);
  saber.position.copy(fusion.position);
  saber.quaternion.copy(fusion.orientation);
  render();
}
animate();
