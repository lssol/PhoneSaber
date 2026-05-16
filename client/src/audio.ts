// Web Audio wiring for the lightsaber:
//   - looping hum once unlocked (constant pitch — modulating it makes
//     the saber sound like a tortured animal)
//   - one-shot swing on motion, picked randomly from a small bank
//
// The AudioContext can only be created from a user gesture, so callers
// must invoke `unlockAudio()` from a click/keydown handler before the
// other functions do anything.

const HUM_URL = '/sounds/hum.mp3';
const SWING_URLS = ['/sounds/swing.mp3', '/sounds/swing2.mp3'];

// Swing trigger thresholds, in m/s² (|linear acceleration|). Tuned so
// gentle/idle motion is silent and only deliberate swings fire.
const SWING_MIN_INTENSITY = 3;
const SWING_FULL_INTENSITY = 25;
const SWING_COOLDOWN_MS = 350;

// Playback rate range — slow swings sound lower/longer, fast swings
// sound higher/snappier.
const SWING_RATE_MIN = 0.95;
const SWING_RATE_MAX = 1.15;

let ctx: AudioContext | null = null;
let humBuffer: AudioBuffer | null = null;
let swingBuffers: AudioBuffer[] = [];
let humSource: AudioBufferSourceNode | null = null;
let humGain: GainNode | null = null;
let lastSwingAt = 0;

// Rolling peak |accel| reporter so we can characterize what "slow" vs
// "fast" swings actually look like in the data.
let windowPeak = 0;
let windowStart = 0;

async function loadBuffer(url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  const bytes = await res.arrayBuffer();
  return await ctx!.decodeAudioData(bytes);
}

export async function unlockAudio(): Promise<void> {
  if (ctx) return;
  ctx = new AudioContext();
  const [hum, ...swings] = await Promise.all([
    loadBuffer(HUM_URL),
    ...SWING_URLS.map(loadBuffer),
  ]);
  humBuffer = hum;
  swingBuffers = swings;
  console.log('[audio] ready');
}

export function startHum(): void {
  if (!ctx || !humBuffer || humSource) return;
  humGain = ctx.createGain();
  humGain.gain.value = 0.35;
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
// Fires at most one swing per cooldown window; gain scales with intensity.
export function maybeTriggerSwing(intensity: number): void {
  if (!ctx || swingBuffers.length === 0) return;

  const now = performance.now();
  if (intensity > windowPeak) windowPeak = intensity;
  if (now - windowStart > 1000) {
    console.log(`[audio] peak |accel| last 1s: ${windowPeak.toFixed(1)} m/s²`);
    windowPeak = 0;
    windowStart = now;
  }

  if (intensity < SWING_MIN_INTENSITY) return;
  if (now - lastSwingAt < SWING_COOLDOWN_MS) return;
  lastSwingAt = now;

  const t = Math.min(
    1,
    (intensity - SWING_MIN_INTENSITY) /
      (SWING_FULL_INTENSITY - SWING_MIN_INTENSITY),
  );

  const rate = SWING_RATE_MIN + (SWING_RATE_MAX - SWING_RATE_MIN) * t;
  console.log(
    `[audio] swing intensity=${intensity.toFixed(1)} m/s² t=${t.toFixed(2)} rate=${rate.toFixed(2)}`,
  );

  const buffer = swingBuffers[Math.floor(Math.random() * swingBuffers.length)];
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;
  const gain = ctx.createGain();
  gain.gain.value = 0.5 + 0.5 * t;
  src.connect(gain).connect(ctx.destination);
  src.start();
}
