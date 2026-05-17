// MediaPipe world landmarks → mixamorig upper-body bones, solved directly
// in scene space (no Kalidokit). Each bone has a primary direction (head
// → tail) that fixes its local +Y in world. For bones whose twist matters
// (spine, head) we also pass a "twist" landmark pair that fixes the local
// +X in world, giving a full 3-DOF orientation. The remaining bones use
// the minimum-rotation solver (2 DOF, twist follows bind).
//
// Coordinate frames:
//   MediaPipe world: +X subject-left, +Y down, +Z away-from-camera
//   Scene:           +X scene-right, +Y up,  +Z toward-camera
// Direction vectors convert with all three axes negated.
//
// Mirror semantics: the webcam preview is horizontally flipped, and the
// existing saber fusion mirrors on X. We follow the same convention:
// user's LEFT landmarks drive the jedi's RIGHT bone (and vice versa).
//
// Bone naming gotcha: GLTFLoader strips colons. `mixamorig:LeftArm` in
// the GLB is `mixamorigLeftArm` at runtime.

import * as THREE from 'three';
import type { Landmark } from './vision';

const LM = {
  NOSE: 0,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
} as const;
const MIN_VISIBILITY = 0.3;

type Point = { kind: 'lm'; idx: number } | { kind: 'mid'; a: number; b: number };

type BoneSpec = {
  bone: string;
  head: Point;
  tail: Point;
  // Optional: a landmark pair defining a direction perpendicular to the
  // bone's primary axis. Used to fix twist (e.g., shoulder-line for spine,
  // ear-line for head). Sign is auto-corrected against the bone's bind X.
  twist?: { from: number; to: number };
};

// Order matters: parents before children. Bones are updated in this order
// so each child can read its parent's already-updated world rotation.
const BONES: BoneSpec[] = [
  // Torso: hip midpoint → shoulder midpoint. Twist from shoulder line so
  // chest yaw (turning) follows the user's torsion.
  {
    bone: 'mixamorigSpine',
    head: mid(LM.LEFT_HIP, LM.RIGHT_HIP),
    tail: mid(LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER),
    twist: { from: LM.LEFT_SHOULDER, to: LM.RIGHT_SHOULDER },
  },
  // Clavicles: shoulder midpoint → opposite-side shoulder (mirror swap).
  { bone: 'mixamorigRightShoulder', head: mid(LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER), tail: lm(LM.LEFT_SHOULDER) },
  { bone: 'mixamorigLeftShoulder',  head: mid(LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER), tail: lm(LM.RIGHT_SHOULDER) },
  // Arms (mirror swap: user-left → jedi-right).
  { bone: 'mixamorigRightArm',      head: lm(LM.LEFT_SHOULDER),  tail: lm(LM.LEFT_ELBOW) },
  { bone: 'mixamorigRightForeArm',  head: lm(LM.LEFT_ELBOW),     tail: lm(LM.LEFT_WRIST) },
  { bone: 'mixamorigLeftArm',       head: lm(LM.RIGHT_SHOULDER), tail: lm(LM.RIGHT_ELBOW) },
  { bone: 'mixamorigLeftForeArm',   head: lm(LM.RIGHT_ELBOW),    tail: lm(LM.RIGHT_WRIST) },
  // Head: shoulder midpoint → ear midpoint. Twist from ear line so head
  // yaw (looking left/right) is captured, not just tilt.
  {
    bone: 'mixamorigHead',
    head: mid(LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER),
    tail: mid(LM.LEFT_EAR, LM.RIGHT_EAR),
    twist: { from: LM.LEFT_EAR, to: LM.RIGHT_EAR },
  },
];

function lm(idx: number): Point { return { kind: 'lm', idx }; }
function mid(a: number, b: number): Point { return { kind: 'mid', a, b }; }

export class ArmSolver {
  private bones = new Map<string, THREE.Bone>();
  private bindWorldQuats = new Map<string, THREE.Quaternion>();
  private bindWorldDirs = new Map<string, THREE.Vector3>();   // local +Y in bind world
  private bindWorldRights = new Map<string, THREE.Vector3>(); // local +X in bind world

  // Scratch.
  private _head = new THREE.Vector3();
  private _tail = new THREE.Vector3();
  private _twistFrom = new THREE.Vector3();
  private _twistTo = new THREE.Vector3();
  private _dir = new THREE.Vector3();
  private _twistVec = new THREE.Vector3();
  private _xAxis = new THREE.Vector3();
  private _zAxis = new THREE.Vector3();
  private _basis = new THREE.Matrix4();
  private _delta = new THREE.Quaternion();
  private _desiredWorld = new THREE.Quaternion();
  private _parentWorld = new THREE.Quaternion();
  private _targetLocal = new THREE.Quaternion();

  constructor(root: THREE.Object3D) {
    root.updateMatrixWorld(true);
    for (const { bone: name } of BONES) {
      const bone = root.getObjectByName(name) as THREE.Bone | undefined;
      if (!bone) {
        console.warn('[skeleton] bone not found:', name);
        continue;
      }
      this.bones.set(name, bone);
      const bindWorld = new THREE.Quaternion();
      bone.getWorldQuaternion(bindWorld);
      this.bindWorldQuats.set(name, bindWorld);
      this.bindWorldDirs.set(name, new THREE.Vector3(0, 1, 0).applyQuaternion(bindWorld));
      this.bindWorldRights.set(name, new THREE.Vector3(1, 0, 0).applyQuaternion(bindWorld));
    }
  }

  apply(worldLandmarks: Landmark[], landmarks: Landmark[], alpha = 0.3): void {
    if (worldLandmarks.length < 25 || landmarks.length < 25) return;

    for (const spec of BONES) {
      if (!this.visible(landmarks, spec.head) || !this.visible(landmarks, spec.tail)) continue;
      this.resolvePoint(worldLandmarks, spec.head, this._head);
      this.resolvePoint(worldLandmarks, spec.tail, this._tail);
      this._dir.subVectors(this._tail, this._head);
      if (this._dir.lengthSq() < 1e-8) continue;
      this._dir.normalize();

      if (spec.twist) {
        const lmFrom = landmarks[spec.twist.from];
        const lmTo = landmarks[spec.twist.to];
        if ((lmFrom.visibility ?? 0) < MIN_VISIBILITY || (lmTo.visibility ?? 0) < MIN_VISIBILITY) {
          this.setBoneDir(spec.bone, this._dir, alpha);
          continue;
        }
        this.resolvePoint(worldLandmarks, lm(spec.twist.from), this._twistFrom);
        this.resolvePoint(worldLandmarks, lm(spec.twist.to), this._twistTo);
        this._twistVec.subVectors(this._twistFrom, this._twistTo);
        if (this._twistVec.lengthSq() < 1e-8) {
          this.setBoneDir(spec.bone, this._dir, alpha);
          continue;
        }
        this.setBoneFullOrientation(spec.bone, this._dir, this._twistVec, alpha);
      } else {
        this.setBoneDir(spec.bone, this._dir, alpha);
      }
    }
  }

  private resolvePoint(world: Landmark[], p: Point, out: THREE.Vector3): void {
    if (p.kind === 'lm') {
      const l = world[p.idx];
      out.set(-l.x, -l.y, -l.z);
    } else {
      const a = world[p.a];
      const b = world[p.b];
      out.set(-(a.x + b.x) * 0.5, -(a.y + b.y) * 0.5, -(a.z + b.z) * 0.5);
    }
  }

  private visible(landmarks: Landmark[], p: Point): boolean {
    if (p.kind === 'lm') return (landmarks[p.idx].visibility ?? 0) >= MIN_VISIBILITY;
    return (
      (landmarks[p.a].visibility ?? 0) >= MIN_VISIBILITY &&
      (landmarks[p.b].visibility ?? 0) >= MIN_VISIBILITY
    );
  }

  // 2-DOF: rotate bone so its local +Y points along desiredDir, minimal
  // rotation from bind. Twist about the bone axis follows bind.
  private setBoneDir(name: string, desiredDir: THREE.Vector3, alpha: number): void {
    const bone = this.bones.get(name);
    if (!bone || !bone.parent) return;
    const bindWorld = this.bindWorldQuats.get(name)!;
    const bindDir = this.bindWorldDirs.get(name)!;

    this._delta.setFromUnitVectors(bindDir, desiredDir);
    this._desiredWorld.copy(this._delta).multiply(bindWorld);
    this.commitWorld(bone, alpha);
  }

  // 3-DOF: rotate bone so its local +Y points along desiredDir AND its
  // local +X points along the projection of twistRef perpendicular to
  // desiredDir. Sign of +X is auto-aligned against the bone's bind +X.
  private setBoneFullOrientation(
    name: string,
    desiredDir: THREE.Vector3,
    twistRef: THREE.Vector3,
    alpha: number,
  ): void {
    const bone = this.bones.get(name);
    if (!bone || !bone.parent) return;
    const bindRight = this.bindWorldRights.get(name)!;

    // Project twistRef onto the plane perpendicular to desiredDir to get
    // the bone's local +X direction in world.
    this._xAxis.copy(twistRef).addScaledVector(desiredDir, -twistRef.dot(desiredDir));
    if (this._xAxis.lengthSq() < 1e-8) {
      this.setBoneDir(name, desiredDir, alpha);
      return;
    }
    this._xAxis.normalize();
    if (this._xAxis.dot(bindRight) < 0) this._xAxis.negate();

    // Right-handed: Z = X × Y.
    this._zAxis.crossVectors(this._xAxis, desiredDir);
    this._basis.makeBasis(this._xAxis, desiredDir, this._zAxis);
    this._desiredWorld.setFromRotationMatrix(this._basis);
    this.commitWorld(bone, alpha);
  }

  // Convert desiredWorld (already set in scratch) to bone-local quat and
  // slerp toward it. Updates the bone's matrix so children see this change.
  private commitWorld(bone: THREE.Bone, alpha: number): void {
    bone.parent!.updateWorldMatrix(true, false);
    bone.parent!.getWorldQuaternion(this._parentWorld);
    this._targetLocal.copy(this._parentWorld).invert().multiply(this._desiredWorld);
    bone.quaternion.slerp(this._targetLocal, alpha);
    bone.updateMatrixWorld(true);
  }
}
