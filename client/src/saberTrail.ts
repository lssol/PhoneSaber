import * as THREE from 'three';

type TrailSample = {
  atMs: number;
  base: THREE.Vector3;
  tip: THREE.Vector3;
};

type BladeLine = {
  base: THREE.Vector3;
  tip: THREE.Vector3;
};

export type SaberTrail = {
  update: (nowMs: number) => void;
};

const MAX_SAMPLES = 32;
const TRAIL_FADE_MS = 190;
const MIN_TRANSLATION_DELTA_M = 0.0015;
const MIN_ROTATION_DELTA_RAD = 0.0015;
const START_OPACITY = 0.2;
const TRAIL_COLOR = 0x36a3ff;

export function createSaberTrail(
  scene: THREE.Scene,
  source: THREE.Object3D,
  isBladeMaterial: (material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial) => boolean,
): SaberTrail {
  source.updateWorldMatrix(true, true);

  const blade = findBladeLine(source, isBladeMaterial);
  const localBase = blade.base.clone();
  const localTip = blade.tip.clone();
  const samples: TrailSample[] = [];
  const segments = Array.from({ length: MAX_SAMPLES - 1 }, () => createRibbonSegment());

  const previousPosition = new THREE.Vector3();
  const currentPosition = new THREE.Vector3();
  const previousRotation = new THREE.Quaternion();
  const currentRotation = new THREE.Quaternion();
  const currentScale = new THREE.Vector3();
  const worldBase = new THREE.Vector3();
  const worldTip = new THREE.Vector3();
  let hasReferencePose = false;

  for (const segment of segments) scene.add(segment.mesh);

  const pushSample = (nowMs: number) => {
    samples.unshift({ atMs: nowMs, base: worldBase.clone(), tip: worldTip.clone() });
    if (samples.length > MAX_SAMPLES) samples.pop();
    previousPosition.copy(currentPosition);
    previousRotation.copy(currentRotation);
  };

  return {
    update: (nowMs: number) => {
      source.updateWorldMatrix(true, false);
      worldBase.copy(localBase).applyMatrix4(source.matrixWorld);
      worldTip.copy(localTip).applyMatrix4(source.matrixWorld);
      source.matrixWorld.decompose(currentPosition, currentRotation, currentScale);

      if (!hasReferencePose) {
        previousPosition.copy(currentPosition);
        previousRotation.copy(currentRotation);
        hasReferencePose = true;
        return;
      }

      const movedEnough =
        currentPosition.distanceTo(previousPosition) >= MIN_TRANSLATION_DELTA_M ||
        currentRotation.angleTo(previousRotation) >= MIN_ROTATION_DELTA_RAD;

      if (movedEnough) pushSample(nowMs);

      while ((samples.at(-1)?.atMs ?? nowMs) < nowMs - TRAIL_FADE_MS) {
        samples.pop();
      }

      for (let i = 0; i < segments.length; i++) {
        const newer = samples[i];
        const older = samples[i + 1];
        const segment = segments[i];

        if (!newer || !older) {
          segment.mesh.visible = false;
          continue;
        }

        const fade = THREE.MathUtils.clamp(1 - (nowMs - older.atMs) / TRAIL_FADE_MS, 0, 1);
        updateRibbonSegment(segment, newer, older, START_OPACITY * fade * fade);
      }
    },
  };
}

function createRibbonSegment(): { mesh: THREE.Mesh; geometry: THREE.BufferGeometry; material: THREE.MeshBasicMaterial } {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 3), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);

  const material = new THREE.MeshBasicMaterial({
    color: TRAIL_COLOR,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;

  return { mesh, geometry, material };
}

function updateRibbonSegment(
  segment: { mesh: THREE.Mesh; geometry: THREE.BufferGeometry; material: THREE.MeshBasicMaterial },
  newer: TrailSample,
  older: TrailSample,
  opacity: number,
): void {
  const position = segment.geometry.getAttribute('position') as THREE.BufferAttribute;
  writePoint(position, 0, newer.base);
  writePoint(position, 1, newer.tip);
  writePoint(position, 2, older.tip);
  writePoint(position, 3, older.base);
  position.needsUpdate = true;

  segment.material.opacity = opacity;
  segment.mesh.visible = opacity > 0.005;
}

function writePoint(position: THREE.BufferAttribute, index: number, point: THREE.Vector3): void {
  position.setXYZ(index, point.x, point.y, point.z);
}

function findBladeLine(
  source: THREE.Object3D,
  isBladeMaterial: (material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial) => boolean,
): BladeLine {
  const sourceWorldInv = source.matrixWorld.clone().invert();
  const bladeBounds = new THREE.Box3();
  const point = new THREE.Vector3();

  source.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !(child.geometry instanceof THREE.BufferGeometry)) return;

    child.updateWorldMatrix(true, false);
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const position = child.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!position) return;

    const index = child.geometry.index;
    const groups = child.geometry.groups.length > 0
      ? child.geometry.groups
      : [{ start: 0, count: index?.count ?? position.count, materialIndex: 0 }];

    for (const group of groups) {
      const material = materials[group.materialIndex ?? 0];
      if (
        !(material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial) ||
        !isBladeMaterial(material)
      ) {
        continue;
      }

      for (let i = group.start; i < group.start + group.count; i++) {
        const vertexIndex = index ? index.getX(i) : i;
        point.fromBufferAttribute(position, vertexIndex);
        point.applyMatrix4(child.matrixWorld).applyMatrix4(sourceWorldInv);
        bladeBounds.expandByPoint(point);
      }
    }
  });

  if (bladeBounds.isEmpty()) {
    return {
      base: new THREE.Vector3(0, 0.16, 0),
      tip: new THREE.Vector3(0, 1, 0),
    };
  }

  const center = new THREE.Vector3();
  bladeBounds.getCenter(center);
  return {
    base: new THREE.Vector3(center.x, bladeBounds.min.y, center.z),
    tip: new THREE.Vector3(center.x, bladeBounds.max.y, center.z),
  };
}
