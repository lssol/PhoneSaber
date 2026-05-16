// Fusion: phone IMU orientation + webcam-tracked body landmarks → saber pose.
//
// ─────────────────────────────────────────────────────────────────────────────
// Orientation (rotation that R · q_imu_current gives the saber's scene quat)
// ─────────────────────────────────────────────────────────────────────────────
//
// The IMU returns a gravity-aligned quaternion with an *arbitrary* yaw reference,
// so we can't render it directly — we need a rotation R that maps the IMU's
// world frame into the scene frame. Two known poses are enough to fix R: with
// each pose we know the blade direction in the IMU frame (= q_imu · +Y_phone)
// AND where we want that direction to land in the scene.
//
// Guided two-pose calibration:
//   Pose A — saber pointing UP            → blade lands at SCENE_UP            = (0, +1,  0)
//   Pose B — saber pointing INTO SCREEN   → blade lands at SCENE_AWAY_FROM_CAM = (0,  0, -1)
//
// The "mirror" trick (this is the subtle part — read it once):
//
// Earlier we mapped Pose B to +Z_scene (toward the camera) and then applied a
// post-mirror (`q.y *= -1; q.z *= -1`) on the rendered quaternion so that
// phone-to-your-left would show up on the visual right of the screen — matching
// the X-mirrored webcam preview. That worked for lateral tilts, but the same
// quaternion mirror also reverses chirality of rotations around the blade
// axis: roll felt backwards.
//
// The fix is to bake the mirror into the *basis*: pointing Pose B at -Z_scene
// flips the sign of the third basis vector (`SCENE_UP × SCENE_AWAY_FROM_CAM`
// = -X_scene instead of +X_scene). That single sign change makes phone-lateral
// land on the mirrored side of the screen — but, crucially, it's an honest
// rotation R, not a reflection: rotations *around* the blade axis are
// preserved, so roll matches the user's hand. No explicit quaternion mirror.
//
// Per frame:  saber.quaternion = R · q_imu_current
// (The saber mesh in scene.ts is pre-rotated so its local +Y is the blade.)
//
// ─────────────────────────────────────────────────────────────────────────────
// Position (where the saber hilt sits)
// ─────────────────────────────────────────────────────────────────────────────
//
// Midpoint of the visible wrists in shoulder-centred coordinates, reach-clamped
// and One-Euro smoothed. MediaPipe world axes (+X subject-left, +Y down, +Z
// away-from-camera) → three.js scene (+X right, +Y up, +Z toward camera) by
// negating X and Y. Z is also negated then *re-negated* in the final formula
// so that a forward stab in real life moves the saber to -Z_scene (away from
// the THREE camera, deeper into the screen) — matching the blade direction
// established at calibration. The X-mirror on position keeps the saber visually
// aligned with the mirrored webcam preview (your reaching-right reflection is
// on the visual left, and so is the saber).
//
// On top of the raw mapping:
//   • POS_GAIN amplifies X/Y so wrist motion fills a saber-sized workspace.
//   • A calibrated rest-Z / stab-Z pair turns a real ~15–20 cm wrist thrust
//     into Z_STAB_TARGET of scene-Z travel.
//
// ─────────────────────────────────────────────────────────────────────────────
// High-rate prediction (IMU-aided dead reckoning between vision frames)
// ─────────────────────────────────────────────────────────────────────────────
//
// Vision arrives at ~30 Hz, the IMU's linear-accel channel at ~50–100 Hz.
// `integrateAccel` rotates phone-frame accel into the scene frame via
// `alignment · q_imu` (no extra X-flip — the mirror is already in the
// alignment basis, see above) and integrates p += v·dt + ½·a·dt², v += a·dt
// at IMU rate. The same POS_GAIN / zGain that `updatePosition` applies to
// the vision target also apply to the rotated accel so the units match.
//
// Each vision frame is a correction step: blend the dead-reckoned position
// toward the vision target by `VISION_CORRECTION_GAIN`, damp velocity by
// `VELOCITY_DAMP_ON_VISION` to bleed off integration error. If the predicted
// position has wandered more than `SNAP_DISTANCE_M` from vision (bootstrap,
// vision recovery), snap. If vision drops out for `VISION_TIMEOUT_S`,
// velocity is zeroed so accel noise can't accumulate into runaway drift.

import * as THREE from 'three';
import type { BodyFrame, Vec3 } from './vision';
import { OneEuroVec3 } from './filter';

const POS_MIN_CUTOFF = 1.0;
const POS_BETA = 0.02;

// Lateral/vertical gain on shoulder-relative grip position. Wrist motion is
// smaller than what feels like a "saber-sized" workspace, so we amplify.
const POS_GAIN = 1.7;

// Scene-Z travel the saber should cover from rest pose to a full stab.
const Z_STAB_TARGET = 0.6;
// Minimum measured stab range (m) before we trust the calibration. Below this
// the user probably didn't move during the stab capture; fall back to POS_GAIN.
const Z_STAB_MIN = 0.05;

// IMU-aided dead reckoning.
const MAX_DEAD_RECKON_DT = 0.05;
const VISION_TIMEOUT_S = 0.2;
const VISION_CORRECTION_GAIN = 0.35;
const VELOCITY_DAMP_ON_VISION = 0.6;
const SNAP_DISTANCE_M = 0.3;

// Phone-frame blade axis. (Top of phone, where the blade "emerges" from the
// hilt-shaped phone.) Both Android and iOS use the same convention here.
const PROBE_BLADE_PHONE = new THREE.Vector3(0, 1, 0);

// Scene-frame targets for the two orientation calibration poses.
const SCENE_UP = new THREE.Vector3(0, 1, 0);
const SCENE_AWAY_FROM_CAMERA = new THREE.Vector3(0, 0, -1);

export type CalibrationStage =
  | 'idle'
  | 'awaiting-up'
  | 'awaiting-forward'
  | 'awaiting-stab'
  | 'ready';

export type Calibration = {
  // Rotation that takes IMU-world frame vectors into scene frame.
  alignment: THREE.Quaternion;
  // Arm reach measured at calibration time (shoulder→wrist). Used for clamping.
  armLength: number;
  // Grip scene-Z at the forward pose — the rest pose for stabbing.
  restZ: number;
  // Grip scene-Z at the stab pose — full forward extension.
  stabZ: number;
};

export function defaultCalibration(): Calibration {
  return { alignment: new THREE.Quaternion(), armLength: 0.65, restZ: 0, stabZ: 0 };
}

export class Fusion {
  readonly position = new THREE.Vector3();
  readonly orientation = new THREE.Quaternion();
  stage: CalibrationStage = 'idle';

  private readonly posFilter = new OneEuroVec3(POS_MIN_CUTOFF, POS_BETA);
  private readonly velocity = new THREE.Vector3();
  private lastAccelTime: number | null = null;
  private lastVisionTime = -Infinity;
  private imuPoseA: THREE.Quaternion | null = null;
  private pending: { alignment: THREE.Quaternion; armLength: number; restZ: number } | null = null;

  constructor(public calibration: Calibration = defaultCalibration()) {}

  // Cycle through the calibration state machine. Each call advances one step:
  //   idle → awaiting-up → awaiting-forward → awaiting-stab → ready
  // The press in 'idle' is a no-op capture — it just unlocks the prompt for the
  // first real pose. Each subsequent press captures the relevant IMU / body
  // sample.
  capturePose(imu: THREE.Quaternion, body: BodyFrame | null): CalibrationStage {
    switch (this.stage) {
      case 'idle':
      case 'ready':
        this.imuPoseA = null;
        this.pending = null;
        this.stage = 'awaiting-up';
        return this.stage;

      case 'awaiting-up':
        this.imuPoseA = imu.clone();
        this.stage = 'awaiting-forward';
        return this.stage;

      case 'awaiting-forward': {
        const alignment = solveAlignment(this.imuPoseA!, imu);
        const armLength = body ? measureArm(body) : this.calibration.armLength;
        const restZ = body ? gripSceneZ(body) : 0;
        this.pending = { alignment, armLength, restZ };
        this.stage = 'awaiting-stab';
        return this.stage;
      }

      case 'awaiting-stab': {
        const stabZ = body ? gripSceneZ(body) : (this.pending?.restZ ?? 0) + Z_STAB_TARGET;
        const { alignment, armLength, restZ } = this.pending!;
        this.calibration = { alignment, armLength, restZ, stabZ };
        this.pending = null;
        this.imuPoseA = null;
        this.posFilter.reset();
        this.velocity.set(0, 0, 0);
        this.lastAccelTime = null;
        this.lastVisionTime = -Infinity;
        this.stage = 'ready';
        return this.stage;
      }
    }
  }

  resetCalibration() {
    this.imuPoseA = null;
    this.pending = null;
    this.stage = 'idle';
  }

  updateOrientation(imu: THREE.Quaternion) {
    // Orientation is taken directly from IMU + alignment. No mirror: the
    // saber blade points in the same direction as the phone's top, so
    // rolling the phone rolls the saber the same way. Position is still
    // X-mirrored to match the flipped webcam preview, so when you reach
    // sideways the saber follows your reflection — only rotation is direct.
    this.orientation.multiplyQuaternions(this.calibration.alignment, imu);
  }

  updatePosition(body: BodyFrame) {
    const local = gripShoulderLocal(body);
    if (!local) return;

    const reach = this.calibration.armLength;
    const d = Math.hypot(local.x, local.y, local.z);
    if (d > reach) {
      const s = reach / d;
      local.x *= s; local.y *= s; local.z *= s;
    }

    // MediaPipe → three.js axes (+ X-mirror to match the flipped preview).
    // X/Y: uniform gain so the workspace feels bigger than raw wrist motion.
    const sceneX = -local.x * POS_GAIN;
    const sceneY = -local.y * POS_GAIN;

    // Z: amplify deviation from the calibrated rest forward pose so a ~15–20 cm
    // wrist stab reads as a meaningful saber thrust. The final negation sends
    // the saber to -Z_scene on a forward stab — into the screen, matching the
    // blade direction (see the header note on the basis-flip mirror).
    const rawSceneZ = -local.z;
    const sceneZ = -(rawSceneZ - this.calibration.restZ) * this.zGain();

    const [tx, ty, tz] = this.posFilter.filter(sceneX, sceneY, sceneZ, body.timeSec);

    this.lastVisionTime = body.timeSec;

    // Pre-calibration the alignment isn't solved, so accel can't be rotated
    // into the scene frame — vision is authoritative.
    if (this.stage !== 'ready') {
      this.position.set(tx, ty, tz);
      this.velocity.set(0, 0, 0);
      return;
    }

    // Correction: snap if we're way off (bootstrap / vision recovery),
    // otherwise blend the dead-reckoned estimate toward the vision target
    // and bleed off integrated-velocity error.
    const dx = tx - this.position.x;
    const dy = ty - this.position.y;
    const dz = tz - this.position.z;
    if (dx * dx + dy * dy + dz * dz > SNAP_DISTANCE_M * SNAP_DISTANCE_M) {
      this.position.set(tx, ty, tz);
      this.velocity.set(0, 0, 0);
    } else {
      this.position.x += VISION_CORRECTION_GAIN * dx;
      this.position.y += VISION_CORRECTION_GAIN * dy;
      this.position.z += VISION_CORRECTION_GAIN * dz;
      this.velocity.multiplyScalar(VELOCITY_DAMP_ON_VISION);
    }
  }

  // High-rate prediction step. Called from the accel callback (~50–100 Hz).
  // Phone-frame accel → scene frame via `alignment · q_imu` — the basis flip
  // in solveAlignment bakes the X-mirror in, so no extra sign flip is needed.
  // POS_GAIN / zGain are applied to match `updatePosition`'s scene-frame units.
  integrateAccel(ax: number, ay: number, az: number, imu: THREE.Quaternion, timeSec: number) {
    if (this.stage !== 'ready') return;
    if (this.lastAccelTime === null) { this.lastAccelTime = timeSec; return; }

    const dt = Math.min(timeSec - this.lastAccelTime, MAX_DEAD_RECKON_DT);
    this.lastAccelTime = timeSec;
    if (dt <= 0) return;

    if (timeSec - this.lastVisionTime > VISION_TIMEOUT_S) {
      this.velocity.set(0, 0, 0);
      return;
    }

    const a = new THREE.Vector3(ax, ay, az)
      .applyQuaternion(imu)
      .applyQuaternion(this.calibration.alignment);
    // Match position's per-axis gain so integration units agree. The outer
    // negation in `sceneZ = -(rawSceneZ - restZ) * zGain` and the negation
    // inside `rawSceneZ = -local.z` cancel in the second derivative, leaving
    // a clean positive zGain for accel-Z too.
    a.x *= POS_GAIN;
    a.y *= POS_GAIN;
    a.z *= this.zGain();

    this.position.addScaledVector(this.velocity, dt);
    this.position.addScaledVector(a, 0.5 * dt * dt);
    this.velocity.addScaledVector(a, dt);
  }

  private zGain(): number {
    const stabRange = this.calibration.stabZ - this.calibration.restZ;
    return Math.abs(stabRange) >= Z_STAB_MIN ? Z_STAB_TARGET / stabRange : POS_GAIN;
  }
}

// Shoulder-relative grip position in MediaPipe world axes. Returns null if no
// wrist is visible.
function gripShoulderLocal(body: BodyFrame): Vec3 | null {
  let gripWorld: Vec3;
  if (body.leftWristVisible && body.rightWristVisible) {
    gripWorld = midpoint(body.leftWrist, body.rightWrist);
  } else if (body.leftWristVisible) {
    gripWorld = body.leftWrist;
  } else if (body.rightWristVisible) {
    gripWorld = body.rightWrist;
  } else {
    return null;
  }
  const shoulderMid = midpoint(body.leftShoulder, body.rightShoulder);
  return {
    x: gripWorld.x - shoulderMid.x,
    y: gripWorld.y - shoulderMid.y,
    z: gripWorld.z - shoulderMid.z,
  };
}

// Grip Z in the scene frame (toward camera = +Z), matching what updatePosition
// would compute pre-gain. Used at calibration time to record the rest/stab Z.
function gripSceneZ(body: BodyFrame): number {
  const local = gripShoulderLocal(body);
  return local ? -local.z : 0;
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
  const w2 = SCENE_AWAY_FROM_CAMERA.clone(); // already ⟂ to SCENE_UP
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
