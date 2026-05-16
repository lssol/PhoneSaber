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

export type Scene = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  saber: THREE.Group;
  updateSaberTrail: (nowMs: number) => void;
  render: () => void;
};

const SABER_URL = '/lightsaber.glb';
const SABER_LENGTH = 1.0;
const BLADE_COLOR = 0x36a3ff;

export function createScene(): Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  // Body at origin; the saber hilt orbits within ~1.1 m (arm reach × position
  // gain) and stabs add another ~0.6 m of forward travel before the blade
  // tip extends a further ~1 m. Camera pulled back enough to fit both a
  // fully-stabbed tip in Z and a saber-up tip in Y, aimed slightly above
  // origin since the action lives there.
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.01, 100);
  camera.position.set(0, 0.3, 3.2);
  camera.lookAt(0, 0.6, 0);

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
  let trail: SaberTrail | null = null;

  new GLTFLoader().load(
    SABER_URL,
    (gltf) => {
      const mesh = gltf.scene.children[1] ?? gltf.scene.children[0];
      normalizeSaberMesh(mesh);
      tintExistingBlade(mesh);
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

function normalizeSaberMesh(mesh: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(mesh);
  const size = new THREE.Vector3();
  box.getSize(size);

  // Identify which mesh-local axis the blade extends along (the longest one).
  const longest = Math.max(size.x, size.y, size.z);
  const bladeAxis: 'x' | 'y' | 'z' =
    size.x >= size.y && size.x >= size.z ? 'x' :
    size.y >= size.z ? 'y' : 'z';

  // Scale so the blade is ~SABER_LENGTH long. Setting scale before rotating is
  // fine because uniform scale commutes with rotation.
  mesh.scale.setScalar(SABER_LENGTH / longest);

  // Rotate so the blade axis becomes mesh-local +Y. Rotations chosen so the
  // chosen positive axis ends up at +Y after the transform.
  if (bladeAxis === 'x') mesh.rotation.z = Math.PI / 2;
  else if (bladeAxis === 'z') mesh.rotation.x = -Math.PI / 2;

  // After the rotation, drop the hilt to the group origin: translate the mesh
  // up so that its minimum Y in world space sits at y=0.
  mesh.updateMatrixWorld();
  const aligned = new THREE.Box3().setFromObject(mesh);
  mesh.position.y = -aligned.min.y;
}

function tintExistingBlade(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial) && !(material instanceof THREE.MeshPhysicalMaterial)) continue;
      if (!isBladeMaterial(material)) continue;

      material.color.setHex(BLADE_COLOR);
      material.emissive.setHex(BLADE_COLOR);
      material.needsUpdate = true;
    }
  });
}

function isBladeMaterial(material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial): boolean {
  const name = material.name.toLowerCase();
  const emissiveStrength =
    material.emissive.r * material.emissive.r +
    material.emissive.g * material.emissive.g +
    material.emissive.b * material.emissive.b;
  const isNamedBlade = /(blade|light|glow|emissive|laser)/.test(name);
  const isOriginalGlowingBlade = material.transparent && emissiveStrength > 0.1 && material.metalness === 0;
  return isNamedBlade || isOriginalGlowingBlade;
}
