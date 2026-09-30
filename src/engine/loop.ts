/**
 * Fixed-timestep loop (Gaffer "Fix Your Timestep"): the simulation always
 * advances in exact SIM_DT steps; rendering runs at display rate and receives
 * an interpolation alpha. Frame spikes are clamped so a stalled tab never
 * triggers a spiral of death.
 */
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;
const MAX_FRAME = 0.25;
const MAX_STEPS = 5;

export interface LoopHooks {
  /** Advance the simulation by exactly SIM_DT. */
  step(dt: number): void;
  /** Draw; alpha in [0,1) is how far we are between the last two sim states. */
  render(alpha: number, frameDt: number, now: number): void;
}

export class FixedLoop {
  private acc = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  /** Scales sim time (slow-mo kill cams, pause = 0). */
  timeScale = 1;
  steps = 0;

  constructor(private readonly hooks: LoopHooks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  get isRunning(): boolean {
    return this.running;
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    const frameDt = Math.min(MAX_FRAME, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.acc += frameDt * this.timeScale;
    let steps = 0;
    while (this.acc >= SIM_DT && steps < MAX_STEPS) {
      this.hooks.step(SIM_DT);
      this.acc -= SIM_DT;
      steps += 1;
      this.steps += 1;
    }
    if (steps === MAX_STEPS) this.acc = Math.min(this.acc, SIM_DT);
    this.hooks.render(this.acc / SIM_DT, frameDt, now / 1000);
    this.raf = requestAnimationFrame(this.tick);
  };
}
