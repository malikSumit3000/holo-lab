// One Euro filter (Casiez et al.): adaptive smoothing used in VR/AR hand tracking.
// Slow movement -> heavy smoothing (no jitter). Fast movement -> light smoothing (no lag).

function alpha(cutoff, dt) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuro {
  constructor(dCutoff = 1.0) {
    this.dCutoff = dCutoff;
    this.reset();
  }

  reset() {
    this.x = null;
    this.dx = 0;
    this.t = null;
  }

  /** value at time t (seconds), with minCutoff (Hz) and beta. */
  filter(value, t, minCutoff, beta) {
    if (!Number.isFinite(value)) return this.x ?? value;          // ignore bad samples
    if (this.x === null || this.t === null || !Number.isFinite(this.x) || !Number.isFinite(this.dx)) {
      this.x = value; this.dx = 0; this.t = t;
      return value;
    }
    const dt = Math.max(1e-3, t - this.t);
    this.t = t;
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = minCutoff + beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

export class OneEuro2D {
  constructor() { this.fx = new OneEuro(); this.fy = new OneEuro(); }
  reset() { this.fx.reset(); this.fy.reset(); }
  filter(x, y, t, minCutoff, beta, out = {}) {
    out.x = this.fx.filter(x, t, minCutoff, beta);
    out.y = this.fy.filter(y, t, minCutoff, beta);
    return out;
  }
}
