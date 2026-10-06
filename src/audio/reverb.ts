/**
 * Procedural convolution reverb. Impulse responses are generated from decaying, progressively
 * darkened noise (plus discrete reflections / echoes / resonances per environment), and
 * cross-faded when the environment changes.
 */

import { Biquad, hashSeed, Noise, Rand, resampleLinear, TAU } from './dsp';
import type { ReverbKind } from './types';

interface IrSpec {
  len: number;
  rt60: number;
  pre: number;
  /** HF damping: the lowpass cutoff sweeps from fStart to fEnd with time-constant `damp` seconds. */
  fStart: number;
  fEnd: number;
  damp: number;
  /** Discrete early reflections [time, amplitude]. */
  early: ReadonlyArray<readonly [number, number]>;
  /** Discrete echoes [time, amplitude, width] — canyon walls. */
  echoes?: ReadonlyArray<readonly [number, number, number]>;
  /** Ring the tail with sharp resonators (corrugated metal, containers). */
  metallic?: boolean;
  /** Return level of the wet bus. */
  wet: number;
}

const IR: Record<ReverbKind, IrSpec> = {
  // Short slap between buildings.
  town: { len: 0.7, rt60: 0.38, pre: 0.008, fStart: 6500, fEnd: 1800, damp: 0.25, early: [[0.021, 0.8], [0.037, 0.6], [0.052, 0.5], [0.071, 0.4], [0.09, 0.3]], wet: 0.65 },
  // Long, diffuse, dark.
  open: { len: 2.4, rt60: 1.7, pre: 0.02, fStart: 3800, fEnd: 500, damp: 0.9, early: [[0.05, 0.25]], wet: 0.6 },
  // Long with distinct wall echoes.
  canyon: { len: 3.0, rt60: 2.0, pre: 0.015, fStart: 3600, fEnd: 450, damp: 1.0, early: [[0.03, 0.4]], echoes: [[0.27, 0.8, 0.05], [0.6, 0.55, 0.07], [1.02, 0.35, 0.09], [1.5, 0.2, 0.1]], wet: 0.8 },
  // Metallic yard: bright, ringing, medium length.
  yard: { len: 1.5, rt60: 1.0, pre: 0.01, fStart: 7500, fEnd: 2500, damp: 0.5, early: [[0.018, 0.9], [0.033, 0.7], [0.049, 0.6], [0.081, 0.4]], metallic: true, wet: 0.7 },
};

const IR_SR = 24000;

/** Stereo impulse response at `outSr` (must equal the AudioContext rate: ConvolverNode demands it). */
export function renderImpulse(kind: ReverbKind, outSr: number): [Float32Array, Float32Array] {
  const spec = IR[kind];
  const sr = IR_SR;
  const n = Math.round(spec.len * sr);
  const preN = Math.round(spec.pre * sr);
  const out: Float32Array[] = [];
  for (let ch = 0; ch < 2; ch++) {
    const r = new Rand(hashSeed(`ir:${kind}`, ch));
    const g = new Noise(r);
    const d = new Float32Array(n);
    let y = 0;
    for (let i = preN; i < n; i++) {
      const t = (i - preN) / sr;
      const env = Math.exp((-6.9078 * t) / spec.rt60);
      const fc = spec.fEnd + (spec.fStart - spec.fEnd) * Math.exp(-t / (spec.damp * 0.5 + 0.05));
      const c = Math.exp((-TAU * fc) / sr);
      y = (1 - c) * g.white() + c * y;
      d[i] = y * env * (t < 0.015 ? t / 0.015 : 1);
    }
    for (const [te, a] of spec.early) {
      const j = Math.round(te * sr) + (ch === 0 ? -5 : 7);
      const s = r.next() < 0.5 ? -1 : 1;
      d[j] += 0.9 * a * s;
      d[j + 1] += 0.5 * a * s;
      d[j + 2] += 0.25 * a * s;
    }
    if (spec.echoes) {
      const lp = new Biquad().set('lp', 1800, 0.7, sr);
      for (const [te, a, w] of spec.echoes) {
        const wn = Math.round(w * sr);
        const j0 = Math.round(te * sr) + (ch === 0 ? -40 : 55);
        for (let k = 0; k < wn && j0 + k < n; k++) {
          const hann = Math.sin((Math.PI * k) / wn) ** 2;
          d[j0 + k] += lp.process(g.white()) * hann * a * 2.2;
        }
      }
    }
    if (spec.metallic) {
      const modes = [720, 1310, 2150, 3350].map((f) => new Biquad().set('bp', f * (1 + (ch ? 0.011 : -0.007)), 40, sr));
      for (let i = 0; i < n; i++) {
        const x = d[i];
        let ring = 0;
        for (const m of modes) ring += m.process(x);
        d[i] = x * 0.55 + ring * 9;
      }
    }
    // Taper the end so a truncated tail never clicks.
    const taper = Math.round(0.05 * sr);
    for (let i = 0; i < taper && i < n; i++) d[n - 1 - i] *= i / taper;
    out.push(resampleLinear(d, sr, outSr));
  }
  return [out[0], out[1]];
}

interface Slot {
  conv: ConvolverNode;
  gain: GainNode;
}

export class ReverbBus {
  /** Voices send into this. */
  readonly input: GainNode;
  kind: ReverbKind | null = null;
  private current: Slot | null = null;
  private readonly retiring: Array<{ slot: Slot; until: number }> = [];
  private readonly cache = new Map<ReverbKind, AudioBuffer>();

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
  ) {
    this.input = ctx.createGain();
  }

  /** Multiplier applied to per-sound sends for the current environment. */
  get wet(): number {
    return this.kind ? IR[this.kind].wet : 0.6;
  }

  set(kind: ReverbKind): void {
    if (kind === this.kind && this.current) return;
    let ir = this.cache.get(kind);
    if (!ir) {
      const [l, r] = renderImpulse(kind, this.ctx.sampleRate);
      ir = this.ctx.createBuffer(2, l.length, this.ctx.sampleRate);
      ir.getChannelData(0).set(l);
      ir.getChannelData(1).set(r);
      this.cache.set(kind, ir);
    }
    // A fresh ConvolverNode per environment: re-assigning `buffer` on a live node is not portable.
    const conv = this.ctx.createConvolver();
    conv.normalize = true;
    conv.buffer = ir;
    const gain = this.ctx.createGain();
    const t = this.ctx.currentTime;
    const first = this.current === null;
    gain.gain.setValueAtTime(first ? IR[kind].wet : 0, t);
    if (!first) gain.gain.setTargetAtTime(IR[kind].wet, t, 0.25);
    this.input.connect(conv);
    conv.connect(gain);
    gain.connect(this.out);
    if (this.current) {
      this.current.gain.gain.setTargetAtTime(0, t, 0.25);
      this.retiring.push({ slot: this.current, until: t + 2 });
    }
    this.current = { conv, gain };
    this.kind = kind;
  }

  update(): void {
    if (this.retiring.length === 0) return;
    const t = this.ctx.currentTime;
    for (let i = this.retiring.length - 1; i >= 0; i--) {
      if (t < this.retiring[i].until) continue;
      this.killSlot(this.retiring[i].slot);
      this.retiring.splice(i, 1);
    }
  }

  dispose(): void {
    if (this.current) this.killSlot(this.current);
    for (const r of this.retiring) this.killSlot(r.slot);
    this.retiring.length = 0;
    this.current = null;
    try {
      this.input.disconnect();
    } catch {
      /* already disconnected */
    }
  }

  private killSlot(s: Slot): void {
    try {
      this.input.disconnect(s.conv);
    } catch {
      /* not connected */
    }
    try {
      s.conv.disconnect();
      s.gain.disconnect();
    } catch {
      /* already gone */
    }
  }
}
