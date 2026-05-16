// Fusion: phone IMU orientation + webcam-tracked body landmarks → saber pose.
//
// Orientation: single-pose calibration only captures `imuNeutral⁻¹ · imuCurrent`,
// which removes a resting-pose offset but doesn't anchor the IMU's world frame
// (gravity-aligned with an arbitrary yaw reference) to the scene frame.
// We need *two* known poses to recover the alignment.
//
// Guided two-pose calibration:
//   Pose A — user holds saber pointing UP    → blade should appear along +Y_scene.
//   Pose B — user holds saber toward SCREEN  → blade should appear along +Z_scene.
//
// Both Android `TYPE_GAME_ROTATION_VECTOR` and iOS `.xArbitraryCorrectedZVertical`
// put the phone's +Y axis from the bottom of the device to the top, so we treat
// the phone-frame "blade axis" as +Y_phone. From the two IMU samples we get two
// world-frame vectors; a small Procrustes-style alignment yields the rotation R
// that maps IMU-world → scene. Per frame we then render
//     saber.quaternion = R · q_imu_current
// (Scene's saber mesh is pre-rotated so its local +Y is the blade direction,
//  see scene.ts.)
//
// Position: midpoint of the visible wrists in shoulder-centred coordinates,
// reach-clamped, One-Euro smoothed. Map MediaPipe (+X subject-left, +Y down,
// +Z away-from-camera) to three.js (+X right, +Y up, +Z toward camera) by
// negating all three axes (the X negation also mirrors movement to match the
// horizontally-flipped video preview).

import * as THREE from 'three';
import type { BodyFrame, Vec3 } from './vision';
import { OneEuroVec3 } from './filter';

const POS_MIN_CUTOFF = 1.0;
const POS_BETA = 0.02;

// Phone-frame blade axis. (Top of phone, where the blade "emerges" from the
// hilt-shaped phone.) Both Android and iOS use the same convention here.
const PROBE_BLADE_PHONE = new THREE.Vector3(0, 1, 0);

// Scene-frame targets for the two calibration poses.
const SCENE_UP = new THREE.Vector3(0, 1, 0);
const SCENE_TOWARD_CAMERA = new THREE.Vector3(0, 0, 1);

export type CalibrationStage = 'idle' | 'awaiting-up' | 'awaiting-forward' | 'ready';

export type Calibration = {
  // Rotation that takes IMU-world frame vectors into scene frame.
  alignment: THREE.Quaternion;
  // Arm reach measured at calibration time (shoulder→wrist). Used for clamping.
  armLength: number;
};

export function defaultCalibration(): Calibration {
  return { alignment: new THREE.Quaternion(), armLength: 0.65 };
}

export class Fusion {
  readonly position = new THREE.Vector3();
  readonly orientation = new THREE.Quaternion();
  stage: CalibrationStage = 'idle';

  private readonly posFilter = new OneEuroVec3(POS_MIN_CUTOFF, POS_BETA);
  private imuPoseA: THREE.Quaternion | null = null;
  private armLengthAtCapture = 0.65;

  constructor(public calibration: Calibration = defaultCalibration()) {}

  // Cycle through the calibration state machine. Each call captures the
  // current IMU pose for whichever step we're on. After the second pose,
  // stage becomes 'ready' and the alignment is committed.
  capturePose(imu: THREE.Quaternion, body: BodyFrame | null): CalibrationStage {
    if (this.stage !== 'awaiting-forward') {
      // 'idle' / 'ready' / 'awaiting-up' all (re)start with pose A.
      this.imuPoseA = imu.clone();
      if (body) this.armLengthAtCapture = measureArm(body);
      this.stage = 'awaiting-forward';
      return this.stage;
    }

    // Pose B → solve alignment.
    const imuPoseB = imu.clone();
    const alignment = solveAlignment(this.imuPoseA!, imuPoseB);
    this.calibration = { alignment, armLength: this.armLengthAtCapture };
    this.posFilter.reset();
    this.stage = 'ready';
    return this.stage;
  }

  resetCalibration() {
    this.imuPoseA = null;
    this.stage = 'idle';
  }

  updateOrientation(imu: THREE.Quaternion) {
    this.orientation.multiplyQuaternions(this.calibration.alignment, imu);
    // Mirror the rotation across the YZ plane to match the X-mirrored
    // position (so a CCW twist by the user appears CCW on the mirrored
    // screen). Mirroring a quaternion across X=0 negates qy and qz —
    // rotations around X are unchanged, but rotations involving Y or Z
    // flip chirality. Blade direction (in YZ plane at calibration poses)
    // is unaffected; only the "spin around the blade axis" flips.
    this.orientation.y = -this.orientation.y;
    this.orientation.z = -this.orientation.z;
  }

  updatePosition(body: BodyFrame) {
    const shoulderMid = midpoint(body.leftShoulder, body.rightShoulder);

    let gripWorld: Vec3;
    if (body.leftWristVisible && body.rightWristVisible) {
      gripWorld = midpoint(body.leftWrist, body.rightWrist);
    } else if (body.leftWristVisible) {
      gripWorld = body.leftWrist;
    } else if (body.rightWristVisible) {
      gripWorld = body.rightWrist;
    } else {
      return;
    }

    const local: Vec3 = {
      x: gripWorld.x - shoulderMid.x,
      y: gripWorld.y - shoulderMid.y,
      z: gripWorld.z - shoulderMid.z,
    };

    const reach = this.calibration.armLength;
    const d = Math.hypot(local.x, local.y, local.z);
    if (d > reach) {
      const s = reach / d;
      local.x *= s; local.y *= s; local.z *= s;
    }

    // MediaPipe → three.js axes (+ X-mirror to match the flipped preview).
    const sceneX = -local.x;
    const sceneY = -local.y;
    const sceneZ = -local.z;

    const [sx, sy, sz] = this.posFilter.filter(sceneX, sceneY, sceneZ, body.timeSec);
    this.position.set(sx, sy, sz);
  }
}

// Solve for the rotation that maps the IMU-world frame to the scene frame
// using two pose correspondences. Procrustes-style with two vectors:
// build an orthonormal triad from each pair (target + Gram–Schmidt + cross),
// the rotation between the two triads is exactly R.
function solveAlignment(imuA: THREE.Quaternion, imuB: THREE.Quaternion): THREE.Quaternion {
  const vA = PROBE_BLADE_PHONE.clone().applyQuaternion(imuA).normalize();
  const vB = PROBE_BLADE_PHONE.clone().applyQuaternion(imuB).normalize();

  const u1 = vA.clone();
  const u2 = vB.clone().addScaledVector(u1, -u1.dot(vB));
  if (u2.lengthSq() < 1e-4) {
    console.warn('[calibrate] poses too close to parallel; using identity alignment');
    return new THREE.Quaternion();
  }
  u2.normalize();
  const u3 = new THREE.Vector3().crossVectors(u1, u2);

  const w1 = SCENE_UP.clone();
  const w2 = SCENE_TOWARD_CAMERA.clone(); // already ⟂ to SCENE_UP
  const w3 = new THREE.Vector3().crossVectors(w1, w2);

  const W = new THREE.Matrix4().makeBasis(w1, w2, w3);
  const U = new THREE.Matrix4().makeBasis(u1, u2, u3);
  const R = W.multiply(U.transpose());

  return new THREE.Quaternion().setFromRotationMatrix(R);
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return { x: 0.5 * (a.x + b.x), y: 0.5 * (a.y + b.y), z: 0.5 * (a.z + b.z) };
}

function measureArm(body: BodyFrame): number {
  const dL = Math.hypot(
    body.leftShoulder.x - body.leftWrist.x,
    body.leftShoulder.y - body.leftWrist.y,
    body.leftShoulder.z - body.leftWrist.z,
  );
  const dR = Math.hypot(
    body.rightShoulder.x - body.rightWrist.x,
    body.rightShoulder.y - body.rightWrist.y,
    body.rightShoulder.z - body.rightWrist.z,
  );
  return Math.max(dL, dR, 0.4);
}
