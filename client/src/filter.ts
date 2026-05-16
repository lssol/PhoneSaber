// One-Euro filter — low-latency smoothing for interactive signals.
// Casiez et al. 2012, https://gery.casiez.net/1euro/. Two knobs:
//   - minCutoff: smoothing at low speeds (smaller = smoother, more lag).
//   - beta:      how much smoothing eases off at high speeds.
//
// For wrist tracking at 30 Hz, minCutoff ≈ 1.0 and beta ≈ 0.01 are good starts.

export class OneEuro {
  private prev: number | null = null;
  private prevDeriv = 0;
  private prevTime: number | null = null;

  constructor(
    private readonly minCutoff = 1.0,
    private readonly beta = 0.01,
    private readonly dCutoff = 1.0,
  ) {}

  filter(value: number, timeSec: number): number {
    if (this.prev === null || this.prevTime === null) {
      this.prev = value;
      this.prevTime = timeSec;
      return value;
    }
    const dt = Math.max(timeSec - this.prevTime, 1e-6);
    const deriv = (value - this.prev) / dt;
    const aD = alpha(this.dCutoff, dt);
    const smoothedDeriv = aD * deriv + (1 - aD) * this.prevDeriv;
    const cutoff = this.minCutoff + this.beta * Math.abs(smoothedDeriv);
    const a = alpha(cutoff, dt);
    const smoothed = a * value + (1 - a) * this.prev;

    this.prev = smoothed;
    this.prevDeriv = smoothedDeriv;
    this.prevTime = timeSec;
    return smoothed;
  }

  reset() {
    this.prev = null;
    this.prevDeriv = 0;
    this.prevTime = null;
  }
}

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuroVec3 {
  private readonly fx: OneEuro;
  private readonly fy: OneEuro;
  private readonly fz: OneEuro;
  constructor(minCutoff = 1.0, beta = 0.01) {
    this.fx = new OneEuro(minCutoff, beta);
    this.fy = new OneEuro(minCutoff, beta);
    this.fz = new OneEuro(minCutoff, beta);
  }
  filter(x: number, y: number, z: number, timeSec: number): [number, number, number] {
    return [this.fx.filter(x, timeSec), this.fy.filter(y, timeSec), this.fz.filter(z, timeSec)];
  }
  reset() { this.fx.reset(); this.fy.reset(); this.fz.reset(); }
}
