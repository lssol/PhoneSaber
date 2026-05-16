// Wire protocol shared by phone/, server/, and client/.
//
// CSV frames, one per WebSocket message:
//   rotation:     "15,t,x,y,z,w"
//   acceleration: "10,t,x,y,z"
//   calibrate:    "cal,t"          — emitted by phone when user presses volume-down
//
// The numeric sensor-type prefixes mirror the Android Sensor.TYPE_* constants
// the original phone client used (TYPE_ROTATION_VECTOR=15, TYPE_LINEAR_ACCELERATION=10).
// They survived the rewrite for protocol stability — no other meaning is implied.

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

export function decode(line: string): SensorFrame | null {
  const values = line.split(',');
  const tag = values[0];
  if (tag === CALIBRATE_TAG && values.length >= 2) {
    return { kind: 'calibrate', t: Number(values[1]) };
  }
  const type = Number(tag);
  if (type === SENSOR_ROTATION && values.length >= 6) {
    return {
      kind: 'rotation',
      t: Number(values[1]),
      x: Number(values[2]),
      y: Number(values[3]),
      z: Number(values[4]),
      w: Number(values[5]),
    };
  }
  if (type === SENSOR_ACCELERATION && values.length >= 5) {
    return {
      kind: 'acceleration',
      t: Number(values[1]),
      x: Number(values[2]),
      y: Number(values[3]),
      z: Number(values[4]),
    };
  }
  return null;
}
