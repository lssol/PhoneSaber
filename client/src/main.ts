// Entry point. Wires sensors + vision into the fusion pipeline and renders.
//
// Calibration is triggered by the phone's volume-down button (which the
// native module forwards over WebSocket as a `cal` frame) or by pressing
// 'c' / Space in the browser. At calibration we snapshot:
//   - the current IMU quaternion (becomes saber's rest orientation),
//   - the current shoulder→wrist distance (becomes the reach clamp).
// Calibration also doubles as the user-gesture that unlocks Web Audio.

import * as THREE from 'three';
import { createScene } from './scene';
import { connectSensors } from './sensors';
import { startVision, type BodyFrame } from './vision';
import { Fusion, calibrate, defaultCalibration } from './fusion';
import {
  maybeTriggerSwing,
  setHumIntensity,
  startHum,
  unlockAudio,
} from './audio';

const WS_URL = `ws://${location.hostname}:8080`;

const hud = document.getElementById('hud')!;
const video = document.getElementById('cam') as HTMLVideoElement;

const { saber, render } = createScene();

const imuQuat = new THREE.Quaternion(0, 0, 0, 1);
let latestBody: BodyFrame | null = null;

const fusion = new Fusion(defaultCalibration());

const stats = { rot: 0, acc: 0, vis: 0, calibrations: 0 };
let connectionState = 'connecting…';
let visionState = 'starting…';

const doCalibrate = () => {
  fusion.setCalibration(calibrate(imuQuat, latestBody));
  stats.calibrations++;
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
    const intensity = Math.hypot(f.x, f.y, f.z);
    maybeTriggerSwing(intensity);
    setHumIntensity(intensity);
  },
  onCalibrate: doCalibrate,
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyC' || e.code === 'Space') doCalibrate();
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

setInterval(() => {
  hud.textContent =
    `${WS_URL}  ${connectionState}\n` +
    `vision: ${visionState}\n` +
    `rot ${stats.rot}/s   acc ${stats.acc}/s   vis ${stats.vis}/s   calibrations ${stats.calibrations}\n` +
    `volume-down on phone (or 'c' / Space) to calibrate`;
  stats.rot = 0;
  stats.acc = 0;
  stats.vis = 0;
}, 1000);

function animate() {
  requestAnimationFrame(animate);
  fusion.updateOrientation(imuQuat);
  saber.position.copy(fusion.position);
  saber.quaternion.copy(fusion.orientation);
  render();
}
animate();
