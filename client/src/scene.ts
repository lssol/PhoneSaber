// three.js scene + saber.
//
// Scene units = metres, in shoulder-centred body coordinates. The camera sits
// where the webcam roughly is (~2.5 m in front of the user) so that the
// saber, held in front of the body, fills a reasonable fraction of the view
// without going off-screen on big swings.
//
// Saber is parented to a positionable group. On load we
//   - rescale the mesh so its longest axis is ~1 m (blade ~= 1 m),
//   - rotate it so the blade direction is mesh-local +Y,
//   - translate it so the hilt's base sits at the group's origin.
// These three transforms let downstream code treat the saber's local +Y
// as "blade direction" regardless of how the GLB was authored.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createSaberTrail, type SaberTrail } from './saberTrail';
import { createSaberModel, isBladeMaterial, SABER_URL } from './saberModel';

export type Scene = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  saber: THREE.Group;
  updateSaberTrail: (nowMs: number) => void;
  render: () => void;
};

export function createScene(container: HTMLElement = document.body): Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  // Body at origin; the saber hilt orbits within ~1.1 m (arm reach × position
  // gain) and stabs add another ~0.6 m of forward travel before the blade
  // tip extends a further ~1 m. Camera pulled back enough to fit both a
  // fully-stabbed tip in Z and a saber-up tip in Y, aimed slightly above
  // origin since the action lives there.
  const bounds = container.getBoundingClientRect();
  const width = bounds.width || window.innerWidth;
  const height = bounds.height || window.innerHeight;
  const camera = new THREE.PerspectiveCamera(55, width / height, 0.01, 100);
  camera.position.set(0, 1.45, 3.2);
  camera.lookAt(0, 1.75, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  window.addEventListener('resize', () => {
    const nextBounds = container.getBoundingClientRect();
    const nextWidth = nextBounds.width || window.innerWidth;
    const nextHeight = nextBounds.height || window.innerHeight;
    camera.aspect = nextWidth / nextHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(nextWidth, nextHeight);
  });

  scene.add(new THREE.AmbientLight(0xffffff, 1.0));
  const point = new THREE.PointLight(0xffffff, 8, 5);
  point.position.set(0.5, 0.5, 1);
  scene.add(point);
  scene.add(new THREE.AxesHelper(0.3));

  const saber = new THREE.Group();
  scene.add(saber);
  let trail: SaberTrail | null = null;

  new GLTFLoader().load(
    SABER_URL,
    (gltf) => {
      const mesh = createSaberModel(gltf.scene);
      saber.add(mesh);
      trail = createSaberTrail(scene, mesh, isBladeMaterial);
    },
    undefined,
    (err) => console.error('[scene] failed to load saber', err),
  );

  return {
    scene,
    camera,
    renderer,
    saber,
    updateSaberTrail: (nowMs) => trail?.update(nowMs),
    render: () => renderer.render(scene, camera),
  };
}
