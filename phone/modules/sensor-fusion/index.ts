import { requireNativeModule, NativeModule } from 'expo';

export type RotationEvent = {
  t: number;
  x: number;
  y: number;
  z: number;
  w: number;
};

export type AccelerationEvent = {
  t: number;
  x: number;
  y: number;
  z: number;
};

export type CalibrateEvent = {
  t: number;
};

type SensorFusionEvents = {
  onRotation: (event: RotationEvent) => void;
  onAcceleration: (event: AccelerationEvent) => void;
  onCalibrate: (event: CalibrateEvent) => void;
};

declare class SensorFusionNative extends NativeModule<SensorFusionEvents> {
  start(intervalMicros: number): void;
  stop(): void;
}

const native = requireNativeModule<SensorFusionNative>('SensorFusionModule');

export const start = (intervalMicros = 20000): void => native.start(intervalMicros);
export const stop = (): void => native.stop();

export const onRotation = (cb: (event: RotationEvent) => void) =>
  native.addListener('onRotation', cb);

export const onAcceleration = (cb: (event: AccelerationEvent) => void) =>
  native.addListener('onAcceleration', cb);

export const onCalibrate = (cb: (event: CalibrateEvent) => void) =>
  native.addListener('onCalibrate', cb);
