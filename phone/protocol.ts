// Duplicated from ../protocol/src/index.ts — phone/ stays out of the npm
// workspace because Expo Metro is fragile around hoisted node_modules.
// If you change either copy, change the other.

export const SENSOR_ROTATION = 15;
export const SENSOR_ACCELERATION = 10;
export const CALIBRATE_TAG = 'cal';

export type RotationFrame = {
  kind: 'rotation';
  t: number;
  x: number;
  y: number;
  z: number;
  w: number;
};

export type AccelerationFrame = {
  kind: 'acceleration';
  t: number;
  x: number;
  y: number;
  z: number;
};

export type CalibrateFrame = {
  kind: 'calibrate';
  t: number;
};

export type SensorFrame = RotationFrame | AccelerationFrame | CalibrateFrame;

export function encode(frame: SensorFrame): string {
  if (frame.kind === 'rotation') {
    return `${SENSOR_ROTATION},${frame.t},${frame.x},${frame.y},${frame.z},${frame.w}`;
  }
  if (frame.kind === 'acceleration') {
    return `${SENSOR_ACCELERATION},${frame.t},${frame.x},${frame.y},${frame.z}`;
  }
  return `${CALIBRATE_TAG},${frame.t}`;
}
