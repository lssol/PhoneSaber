// three.js scene + saber.
//
// Scene units = metres, in shoulder-centred body coordinates. The camera sits
// where the webcam roughly is (~80 cm in front of the user, slightly above
// origin), looking at the body. Saber is parented to a positionable group.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type Scene = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  saber: THREE.Group; // saber mesh is parented under this; we move/rotate the group
  render: () => void;
};

const SABER_URL = '/lightsaber.glb';
const SABER_SCALE = 0.015; // tuned so the blade is ~1m long at this scene scale

export function createScene(): Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 100);
  // Body at origin, camera looking back at it from ~80 cm in front.
  camera.position.set(0, 0, 0.8);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  document.body.appendChild(renderer.domElement);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  scene.add(new THREE.AmbientLight(0xffffff, 1.0));
  const point = new THREE.PointLight(0xffffff, 8, 5);
  point.position.set(0.5, 0.5, 1);
  scene.add(point);
  scene.add(new THREE.AxesHelper(0.3));

  const saber = new THREE.Group();
  scene.add(saber);

  new GLTFLoader().load(
    SABER_URL,
    (gltf) => {
      const mesh = gltf.scene.children[1] ?? gltf.scene.children[0];
      mesh.scale.setScalar(SABER_SCALE);
      saber.add(mesh);
    },
    undefined,
    (err) => console.error('[scene] failed to load saber', err),
  );

  return {
    scene,
    camera,
    renderer,
    saber,
    render: () => renderer.render(scene, camera),
  };
}
