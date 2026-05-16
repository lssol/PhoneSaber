import * as THREE from 'three';

export const SABER_URL = '/lightsaber.glb';
export const SABER_LENGTH = 1.0;
export const BLADE_COLOR = 0x36a3ff;

export function createSaberModel(source: THREE.Object3D): THREE.Object3D {
  const root = source.clone(true);

  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = true;
    child.receiveShadow = true;
    child.frustumCulled = false;

    if (Array.isArray(child.material)) {
      child.material = child.material.map((material) => material.clone());
    } else {
      child.material = child.material.clone();
    }
  });

  const mesh = root.children[1] ?? root.children[0] ?? root;
  normalizeSaberMesh(mesh);
  tintExistingBlade(mesh);
  return mesh;
}

export function normalizeSaberMesh(mesh: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(mesh);
  const size = new THREE.Vector3();
  box.getSize(size);

  const longest = Math.max(size.x, size.y, size.z);
  const bladeAxis: 'x' | 'y' | 'z' =
    size.x >= size.y && size.x >= size.z ? 'x' :
    size.y >= size.z ? 'y' : 'z';

  mesh.scale.setScalar(SABER_LENGTH / longest);

  if (bladeAxis === 'x') mesh.rotation.z = Math.PI / 2;
  else if (bladeAxis === 'z') mesh.rotation.x = -Math.PI / 2;

  mesh.updateMatrixWorld();
  const aligned = new THREE.Box3().setFromObject(mesh);
  mesh.position.y = -aligned.min.y;
}

export function tintExistingBlade(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial) && !(material instanceof THREE.MeshPhysicalMaterial)) continue;
      if (!isBladeMaterial(material)) continue;

      material.color.setHex(BLADE_COLOR);
      material.emissive.setHex(BLADE_COLOR);
      material.emissiveIntensity = 4.5;
      material.toneMapped = false;
      material.needsUpdate = true;
    }
  });
}

export function isBladeMaterial(material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial): boolean {
  const name = material.name.toLowerCase();
  const emissiveStrength =
    material.emissive.r * material.emissive.r +
    material.emissive.g * material.emissive.g +
    material.emissive.b * material.emissive.b;
  const isNamedBlade = /(blade|light|glow|emissive|laser)/.test(name);
  const isOriginalGlowingBlade = material.transparent && emissiveStrength > 0.1 && material.metalness === 0;
  return isNamedBlade || isOriginalGlowingBlade;
}
