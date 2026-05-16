// Web Audio wiring for the lightsaber:
//   - looping hum once unlocked
//   - one-shot swing whose gain + pitch scale with the swing intensity
//
// The AudioContext can only be created from a user gesture, so callers
// must invoke `unlockAudio()` from a click/keydown handler before the
// other functions do anything.

const HUM_URL = '/sounds/hum.mp3';
const SWING_URL = '/sounds/swing.wav';

const SWING_COOLDOWN_MS = 120;
// Linear-accel magnitude (m/s²) below which we ignore motion entirely.
const SWING_MIN_INTENSITY = 8;
// Magnitude that maps to full swing gain / max pitch.
const SWING_FULL_INTENSITY = 30;

let ctx: AudioContext | null = null;
let humBuffer: AudioBuffer | null = null;
let swingBuffer: AudioBuffer | null = null;
let humSource: AudioBufferSourceNode | null = null;
let humGain: GainNode | null = null;
let lastSwingAt = 0;

async function loadBuffer(url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  const bytes = await res.arrayBuffer();
  return await ctx!.decodeAudioData(bytes);
}

export async function unlockAudio(): Promise<void> {
  if (ctx) return;
  ctx = new AudioContext();
  [humBuffer, swingBuffer] = await Promise.all([
    loadBuffer(HUM_URL),
    loadBuffer(SWING_URL),
  ]);
  console.log('[audio] ready');
}

export function startHum(): void {
  if (!ctx || !humBuffer || humSource) return;
  humGain = ctx.createGain();
  humGain.gain.value = 0.25;
  humGain.connect(ctx.destination);
  humSource = ctx.createBufferSource();
  humSource.buffer = humBuffer;
  humSource.loop = true;
  humSource.connect(humGain);
  humSource.start();
}

export function stopHum(): void {
  humSource?.stop();
  humSource?.disconnect();
  humGain?.disconnect();
  humSource = null;
  humGain = null;
}

// Call this with the |linear acceleration| (m/s²) from each accel frame.
// Triggers at most one swing per cooldown window; gain + pitch scale
// with intensity.
export function maybeTriggerSwing(intensity: number): void {
  if (!ctx || !swingBuffer) return;
  if (intensity < SWING_MIN_INTENSITY) return;
  const now = performance.now();
  if (now - lastSwingAt < SWING_COOLDOWN_MS) return;
  lastSwingAt = now;

  const t = Math.min(
    1,
    (intensity - SWING_MIN_INTENSITY) /
      (SWING_FULL_INTENSITY - SWING_MIN_INTENSITY),
  );

  const src = ctx.createBufferSource();
  src.buffer = swingBuffer;
  src.playbackRate.value = 0.8 + 0.7 * t;
  const gain = ctx.createGain();
  gain.gain.value = 0.3 + 0.7 * t;
  src.connect(gain).connect(ctx.destination);
  src.start();
}

// Boost hum pitch slightly while moving — feels "alive" without needing
// a real ramp. Pass |angular velocity| or |accel| in any unit; we just
// map [0, 30] → [1.0, 1.15].
export function setHumIntensity(intensity: number): void {
  if (!humSource) return;
  const t = Math.min(1, intensity / 30);
  humSource.playbackRate.value = 1 + 0.15 * t;
}
