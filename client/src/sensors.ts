// WebSocket transport for phone-side sensor frames.
// Owns the connection; emits typed events via callbacks.

import { decode, type AccelerationFrame, type RotationFrame } from '@phonesaber/protocol';

export type SensorHandlers = {
  onRotation?: (frame: RotationFrame) => void;
  // Acceleration drives high-rate position prediction between vision frames
  // (see fusion.integrateAccel) and the audio module (swing trigger).
  onAcceleration?: (frame: AccelerationFrame) => void;
  onCalibrate?: () => void;
  onState?: (state: string) => void;
};

export function connectSensors(url: string, handlers: SensorHandlers): WebSocket {
  const ws = new WebSocket(url);
  ws.addEventListener('open', () => handlers.onState?.('open'));
  ws.addEventListener('close', (e) => handlers.onState?.(`closed (${e.code})`));
  ws.addEventListener('error', () => handlers.onState?.('error'));
  ws.addEventListener('message', (e) => {
    if (typeof e.data !== 'string') return;
    const frame = decode(e.data);
    if (!frame) return;
    if (frame.kind === 'rotation') handlers.onRotation?.(frame);
    else if (frame.kind === 'acceleration') handlers.onAcceleration?.(frame);
    else if (frame.kind === 'calibrate') handlers.onCalibrate?.();
  });
  return ws;
}
