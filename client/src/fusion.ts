// Fusion: phone IMU orientation + webcam-tracked body landmarks → saber pose.
//
// Per the design discussion:
//   - Orientation: IMU quaternion, rebased to whatever the user was holding at
//     calibration time (`q_display = q_calib⁻¹ · q_imu`). Identity at neutral.
//   - Position: midpoint of the two wrists from MediaPipe (the two-handed grip
//     means both wrists co-locate the phone). Expressed in shoulder-centred
//     coordinates, smoothed with One-Euro, clamped to a reach sphere.
//
// Coordinate frames:
//   - MediaPipe world:  +X subject-left, +Y down, +Z away-from-camera.
//   - three.js scene:   +X right, +Y up, +Z toward camera.
//   - We also mirror the X axis so movement matches the mirrored video preview
//     (phone-to-user's-right => saber-to-screen-right).

import * as THREE from 'three';
import type { BodyFrame, Vec3 } from './vision';
import { OneEuroVec3 } from './filter';

const POS_MIN_CUTOFF = 1.0;
const POS_BETA = 0.02;

export type Calibration = {
  // Neutral IMU pose. Saber rotation is q_calib⁻¹ · q_imu.
  imuNeutral: THREE.Quaternion;
  // Arm reach measured at neutral (shoulder→wrist distance, max of the two).
  // Used to clamp the saber inside a feasible envelope.
  armLength: number;
};

export function defaultCalibration(): Calibration {
  return { imuNeutral: new THREE.Quaternion(0, 0, 0, 1), armLength: 0.65 };
}

// Snapshot IMU + body landmarks → new calibration baseline.
export function calibrate(
  imuQuat: THREE.Quaternion,
  body: BodyFrame | null,
): Calibration {
  const imuNeutral = imuQuat.clone();
  let armLength = 0.65;
  if (body) {
    const dL = distance(body.leftShoulder, body.leftWrist);
    const dR = distance(body.rightShoulder, body.rightWrist);
    // Take the max — it's the closest to a fully-extended-arm reach,
    // and at neutral both arms should be similarly extended anyway.
    armLength = Math.max(dL, dR, 0.4);
  }
  return { imuNeutral, armLength };
}

export class Fusion {
  private readonly posFilter = new OneEuroVec3(POS_MIN_CUTOFF, POS_BETA);
  // The current saber pose in scene space.
  readonly position = new THREE.Vector3();
  readonly orientation = new THREE.Quaternion();
  // Scratch.
  private readonly inverseImuNeutral = new THREE.Quaternion();

  constructor(public calibration: Calibration = defaultCalibration()) {}

  setCalibration(cal: Calibration) {
    this.calibration = cal;
    this.posFilter.reset();
  }

  updateOrientation(imuQuat: THREE.Quaternion) {
    this.inverseImuNeutral.copy(this.calibration.imuNeutral).invert();
    this.orientation.copy(this.inverseImuNeutral).multiply(imuQuat);
  }

  updatePosition(body: BodyFrame) {
    // Shoulder midpoint = body-anchored origin.
    const shoulderMid = midpoint(body.leftShoulder, body.rightShoulder);

    // Pick whichever wrist(s) are visible. If only one, use it directly;
    // if both, take the midpoint (two-handed grip => phone is between them).
    let gripWorld: Vec3;
    if (body.leftWristVisible && body.rightWristVisible) {
      gripWorld = midpoint(body.leftWrist, body.rightWrist);
    } else if (body.leftWristVisible) {
      gripWorld = body.leftWrist;
    } else if (body.rightWristVisible) {
      gripWorld = body.rightWrist;
    } else {
      // No reliable observation this frame: keep previous position.
      return;
    }

    // Move to shoulder-centred frame.
    const local: Vec3 = {
      x: gripWorld.x - shoulderMid.x,
      y: gripWorld.y - shoulderMid.y,
      z: gripWorld.z - shoulderMid.z,
    };

    // Reach clamp: phone shouldn't be further from shoulders than an arm.
    const reach = this.calibration.armLength;
    const d = Math.hypot(local.x, local.y, local.z);
    if (d > reach) {
      const s = reach / d;
      local.x *= s; local.y *= s; local.z *= s;
    }

    // MediaPipe → three.js axis remap, with mirror on X to match the
    // horizontally-flipped video preview.
    const sceneX = -local.x;
    const sceneY = -local.y;
    const sceneZ = -local.z;

    const [sx, sy, sz] = this.posFilter.filter(sceneX, sceneY, sceneZ, body.timeSec);
    this.position.set(sx, sy, sz);
  }
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return { x: 0.5 * (a.x + b.x), y: 0.5 * (a.y + b.y), z: 0.5 * (a.z + b.z) };
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
