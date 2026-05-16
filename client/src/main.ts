import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { decode } from '@phonesaber/protocol';
import {
  maybeTriggerSwing,
  setHumIntensity,
  startHum,
  unlockAudio,
} from './audio';

const WS_URL = `ws://${location.hostname}:8080`;
const SABER_URL = '/lightsaber.glb';

// --- HUD ---------------------------------------------------------------
const hud = document.getElementById('hud')!;
const stats = { rot: 0, acc: 0, dropped: 0 };
let connectionState = 'connecting…';
setInterval(() => {
  hud.textContent =
    `${WS_URL}  ${connectionState}\n` +
    `rot ${stats.rot}/s   acc ${stats.acc}/s   dropped ${stats.dropped}\n` +
    `space: calibrate + start sound`;
  stats.rot = 0;
  stats.acc = 0;
}, 1000);

// --- Scene -------------------------------------------------------------
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);
camera.position.set(0, 0, 30);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

scene.add(new THREE.AmbientLight(0xffffff, 2));
const light = new THREE.PointLight(0xffffff, 200, 50);
light.position.set(5, 5, 10);
scene.add(light);
scene.add(new THREE.AxesHelper());

let saber: THREE.Object3D | null = null;
new GLTFLoader().load(
  SABER_URL,
  (gltf) => {
    saber = gltf.scene.children[1];
    saber.scale.multiplyScalar(0.1);
    scene.add(saber);
    console.log('[scene] saber loaded');
  },
  undefined,
  (err) => console.error('[scene] failed to load saber', err),
);

// --- Sensor state ------------------------------------------------------
// Latest phone rotation, and a calibration baseline captured on spacebar.
// The displayed orientation is calibration⁻¹ · quaternion, so the saber
// is at rest when the phone is in its calibration pose.
const phoneRotation = new THREE.Quaternion(0, 0, 0, 1);
const calibration = new THREE.Quaternion(0, 0, 0, 1);

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    calibration.copy(phoneRotation);
    console.log('[calibrate] baseline set');
    // Spacebar doubles as the user gesture that unlocks audio + starts the hum.
    unlockAudio().then(startHum);
  }
});

// --- WebSocket ---------------------------------------------------------
const ws = new WebSocket(WS_URL);
ws.addEventListener('open', () => {
  connectionState = 'open';
  console.log('[ws] open');
});
ws.addEventListener('close', (e) => {
  connectionState = `closed (${e.code})`;
  console.warn('[ws] closed', e.code, e.reason);
});
ws.addEventListener('error', (e) => {
  connectionState = 'error';
  console.error('[ws] error', e);
});
ws.addEventListener('message', (e) => {
  if (typeof e.data !== 'string') return;
  const frame = decode(e.data);
  if (!frame) {
    stats.dropped++;
    return;
  }
  if (frame.kind === 'rotation') {
    stats.rot++;
    phoneRotation.set(frame.x, frame.y, frame.z, frame.w);
  } else {
    stats.acc++;
    const intensity = Math.hypot(frame.x, frame.y, frame.z);
    maybeTriggerSwing(intensity);
    setHumIntensity(intensity);
  }
});

// --- Render loop -------------------------------------------------------
const displayRotation = new THREE.Quaternion();
const calibrationInverse = new THREE.Quaternion();

function animate() {
  requestAnimationFrame(animate);
  if (saber) {
    calibrationInverse.copy(calibration).invert();
    displayRotation.copy(calibrationInverse).multiply(phoneRotation);
    saber.setRotationFromQuaternion(displayRotation);
  }
  renderer.render(scene, camera);
}
animate();
