/**
 * Frame-time telemetry for adaptive quality. Allocation-free after construction.
 */

/** Frames longer than this (tab switches, breakpoints, ad breaks) are counted as hitches but do not skew stats. */
const OUTLIER_MS = 250;

export class FrameStats {
  private readonly ring: Float32Array;
  private readonly scratch: Float32Array;
  private head = 0;
  private count = 0;
  private ema_ = 0;
  private p95Cache = 0;
  private dirty = false;
  /** Total frames accepted. */
  frames = 0;
  /** Outlier frames rejected. */
  hitches = 0;

  /**
   * @param windowSize frames kept for the rolling percentile (default ~2 s at 60 fps)
   * @param emaAlpha smoothing factor for the moving average (higher = faster)
   */
  constructor(
    readonly windowSize = 120,
    private readonly emaAlpha = 0.05,
  ) {
    this.ring = new Float32Array(windowSize);
    this.scratch = new Float32Array(windowSize);
  }

  /** Record one frame's duration in seconds. */
  push(dtSeconds: number): void {
    const ms = dtSeconds * 1000;
    if (!Number.isFinite(ms) || ms <= 0) return;
    if (ms > OUTLIER_MS) {
      this.hitches += 1;
      return;
    }
    this.ema_ = this.frames === 0 ? ms : this.ema_ + (ms - this.ema_) * this.emaAlpha;
    this.ring[this.head] = ms;
    this.head = (this.head + 1) % this.windowSize;
    if (this.count < this.windowSize) this.count += 1;
    this.frames += 1;
    this.dirty = true;
  }

  /** Exponential moving average frame time, ms. */
  get emaMs(): number {
    return this.ema_;
  }

  /** Smoothed frames per second. */
  get fps(): number {
    return this.ema_ > 0 ? 1000 / this.ema_ : 0;
  }

  /** Number of samples currently in the rolling window. */
  get samples(): number {
    return this.count;
  }

  /** 95th-percentile frame time over the rolling window, ms. */
  get p95Ms(): number {
    return this.percentile(0.95);
  }

  /** Mean of the rolling window, ms. */
  get meanMs(): number {
    if (this.count === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this.count; i += 1) sum += this.ring[i];
    return sum / this.count;
  }

  /** Percentile (0..1) of the rolling window, ms. p95 is cached between pushes. */
  percentile(p: number): number {
    if (this.count === 0) return 0;
    if (p === 0.95 && !this.dirty) return this.p95Cache;
    const view = this.scratch.subarray(0, this.count);
    view.set(this.ring.subarray(0, this.count));
    view.sort();
    const idx = Math.min(this.count - 1, Math.max(0, Math.ceil(p * this.count) - 1));
    const v = view[idx];
    if (p === 0.95) {
      this.p95Cache = v;
      this.dirty = false;
    }
    return v;
  }

  reset(): void {
    this.head = 0;
    this.count = 0;
    this.ema_ = 0;
    this.p95Cache = 0;
    this.dirty = false;
    this.frames = 0;
    this.hitches = 0;
  }
}

export interface QualityGovernorOptions {
  /** Target frame time, ms (16.7 = 60 fps). */
  targetMs?: number;
  /** Step down when p95 exceeds target * this. */
  downRatio?: number;
  /** Step up when p95 stays under target * this. */
  upRatio?: number;
  /** Seconds a condition must hold before acting. */
  downAfter?: number;
  upAfter?: number;
  /** Minimum seconds between any two steps. */
  cooldown?: number;
  /** Seconds to ignore after start / reset (shader compile, level build). */
  warmup?: number;
}

/**
 * Turns FrameStats into quality steps: -1 (drop a level), +1 (raise one), 0 (hold).
 * Conservative on the way up (long dwell, low ratio) so quality does not oscillate.
 */
export class QualityGovernor {
  private readonly o: Required<QualityGovernorOptions>;
  private t = 0;
  private lastStep = -Infinity;
  private over = 0;
  private under = 0;

  constructor(private readonly stats: FrameStats, opts: QualityGovernorOptions = {}) {
    this.o = {
      targetMs: 16.7,
      downRatio: 1.2,
      upRatio: 0.72,
      downAfter: 1.5,
      upAfter: 8,
      cooldown: 4,
      warmup: 2.5,
      ...opts,
    };
  }

  reset(): void {
    this.t = 0;
    this.lastStep = -Infinity;
    this.over = 0;
    this.under = 0;
    this.stats.reset();
  }

  /** Call once per frame with the real frame time (seconds). */
  update(dt: number): -1 | 0 | 1 {
    this.t += Math.min(dt, 0.25);
    const o = this.o;
    if (this.t < o.warmup || this.stats.samples < this.stats.windowSize / 2) return 0;
    const p95 = this.stats.p95Ms;
    if (p95 > o.targetMs * o.downRatio) {
      this.over += dt;
      this.under = 0;
    } else if (p95 < o.targetMs * o.upRatio) {
      this.under += dt;
      this.over = 0;
    } else {
      this.over = 0;
      this.under = 0;
    }
    if (this.t - this.lastStep < o.cooldown) return 0;
    if (this.over >= o.downAfter) return this.step(-1);
    if (this.under >= o.upAfter) return this.step(1);
    return 0;
  }

  private step(dir: -1 | 1): -1 | 1 {
    this.lastStep = this.t;
    this.over = 0;
    this.under = 0;
    // Old samples reflect the previous quality level.
    this.stats.reset();
    return dir;
  }
}
