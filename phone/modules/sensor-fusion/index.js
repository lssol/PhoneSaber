import { requireNativeModule, EventEmitter } from 'expo';

const native = requireNativeModule('SensorFusionModule');
const emitter = new EventEmitter(native);

export const start = (intervalMicros = 20000) => native.start(intervalMicros);
export const stop = () => native.stop();
export const onRotation = (cb) => emitter.addListener('onRotation', cb);
export const onAcceleration = (cb) => emitter.addListener('onAcceleration', cb);
