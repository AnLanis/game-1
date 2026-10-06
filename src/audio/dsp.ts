/**
 * Deterministic offline DSP toolkit. Everything here renders plain Float32Arrays
 * (no Web Audio needed), so the same sound is bit-identical on every machine and
 * the whole bank can be exercised from Node tests.
 */

export const SR = 32000;
/** Reduced rates for dark / low-passed material (reverb tails, explosions, ambience) to save render time. */
export const SR_MID = 24000;
export const SR_LOW = 16000;
export const TAU = Math.PI * 2;

/**
 * Sample rate the recipe helpers default to. The bank sets it per entry (see `renderEntry`) so
 * dark / tonal material can be rendered at a lower rate without every recipe threading `sr`.
 */
export const rate = { sr: SR };

/** Fast tanh-like soft clip (Pade approximant, exact +-1 beyond |x| = 3). */
export function softClip(x: number): number {
  if (x >= 3) return 1;
  if (x <= -3) return -1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

/** mulberry32 — tiny, fast, seedable. */
export class Rand {
  private s: number;
  constructor(seed: number) {
    this.s = (seed >>> 0) || 0x9e3779b9;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  signed(): number {
    return this.next() * 2 - 1;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  /** v ± frac (uniform). */
  jitter(v: number, frac: number): number {
    return v * (1 + this.signed() * frac);
  }
}

export function hashSeed(key: string, n = 0): number {
  let h = (2166136261 ^ n) >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

export type FilterType = 'lp' | 'hp' | 'bp' | 'notch' | 'peak';

/** RBJ biquad, transposed direct form II. */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;

  set(type: FilterType, freq: number, q = 0.707, sr = rate.sr, gainDb = 0): this {
    const f = Math.min(Math.max(freq, 10), sr * 0.45);
    const w = (TAU * f) / sr;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    const alpha = sw / (2 * Math.max(0.05, q));
    let b0 = 1;
    let b1 = 0;
    let b2 = 0;
    let a0 = 1;
    let a1 = 0;
    let a2 = 0;
    switch (type) {
      case 'lp':
        b0 = (1 - cw) / 2;
        b1 = 1 - cw;
        b2 = b0;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
        break;
      case 'hp':
        b0 = (1 + cw) / 2;
        b1 = -(1 + cw);
        b2 = b0;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
        break;
      case 'bp':
        b0 = alpha;
        b1 = 0;
        b2 = -alpha;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
        break;
      case 'notch':
        b0 = 1;
        b1 = -2 * cw;
        b2 = 1;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
        break;
      case 'peak': {
        const A = Math.pow(10, gainDb / 40);
        b0 = 1 + alpha * A;
        b1 = -2 * cw;
        b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;
        a1 = -2 * cw;
        a2 = 1 - alpha / A;
        break;
      }
    }
    const inv = 1 / a0;
    this.b0 = b0 * inv;
    this.b1 = b1 * inv;
    this.b2 = b2 * inv;
    this.a1 = a1 * inv;
    this.a2 = a2 * inv;
    return this;
  }

  process(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

/** White / pink / brown noise from a seeded generator. */
export class Noise {
  private b0 = 0;
  private b1 = 0;
  private b2 = 0;
  private b3 = 0;
  private b4 = 0;
  private b5 = 0;
  private b6 = 0;
  private br = 0;
  constructor(private readonly r: Rand) {}
  white(): number {
    return this.r.next() * 2 - 1;
  }
  pink(): number {
    const w = this.r.next() * 2 - 1;
    this.b0 = 0.99886 * this.b0 + w * 0.0555179;
    this.b1 = 0.99332 * this.b1 + w * 0.0750759;
    this.b2 = 0.969 * this.b2 + w * 0.153852;
    this.b3 = 0.8665 * this.b3 + w * 0.3104856;
    this.b4 = 0.55 * this.b4 + w * 0.5329522;
    this.b5 = -0.7616 * this.b5 - w * 0.016898;
    const p = (this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + w * 0.5362) * 0.11;
    this.b6 = w * 0.115926;
    return p;
  }
  brown(): number {
    const w = this.r.next() * 2 - 1;
    this.br = (this.br + 0.02 * w) / 1.02;
    return this.br * 3.5;
  }
}

export type NoiseColor = 'white' | 'pink' | 'brown';

export function buf(seconds: number, sr = rate.sr): Float32Array {
  return new Float32Array(Math.max(1, Math.round(seconds * sr)));
}

// ---------------------------------------------------------------------------------------------
// Tone layer
// ---------------------------------------------------------------------------------------------

export type Wave = 'sine' | 'saw' | 'tri' | 'square' | 'fm';

export interface ToneSpec {
  /** Start offset in seconds. */
  t?: number;
  dur: number;
  /** Start frequency; glides exponentially to f1 with time constant pTau. */
  f0: number;
  f1?: number;
  pTau?: number;
  wave?: Wave;
  amp?: number;
  /** Linear attack in seconds. */
  atk?: number;
  /** Exponential decay time constant in seconds. */
  tau?: number;
  /** Vibrato [Hz, depth as fraction of frequency]. */
  vib?: [number, number];
  /** FM modulator ratio / index (wave 'fm'). */
  fmRatio?: number;
  fmIndex?: number;
}

export function tone(out: Float32Array, s: ToneSpec, sr = rate.sr): void {
  const i0 = Math.max(0, Math.round((s.t ?? 0) * sr));
  const n = Math.min(out.length - i0, Math.round(s.dur * sr));
  if (n <= 0) return;
  const f1 = s.f1 ?? s.f0;
  let df = s.f0 - f1;
  const pMul = Math.exp(-1 / ((s.pTau ?? s.dur / 3) * sr));
  const eMul = Math.exp(-1 / ((s.tau ?? s.dur / 3) * sr));
  const atkN = Math.max(1, Math.round((s.atk ?? 0.002) * sr));
  const fadeN = Math.min(n, Math.round(0.004 * sr));
  const amp = s.amp ?? 1;
  const wave = s.wave ?? 'sine';
  const vibW = s.vib ? (TAU * s.vib[0]) / sr : 0;
  const vibD = s.vib ? s.vib[1] : 0;
  const fmR = s.fmRatio ?? 2;
  const fmI = s.fmIndex ?? 2;
  let ph = 0;
  let vph = 0;
  let env = 1;
  for (let i = 0; i < n; i++) {
    let f = f1 + df;
    df *= pMul;
    if (vibD) {
      f *= 1 + vibD * Math.sin(vph);
      vph += vibW;
    }
    ph += (TAU * f) / sr;
    let x: number;
    switch (wave) {
      case 'sine':
        x = Math.sin(ph);
        break;
      case 'saw': {
        const p = ph / TAU;
        x = 2 * (p - Math.floor(p)) - 1;
        break;
      }
      case 'tri': {
        const p = ph / TAU;
        x = 4 * Math.abs(p - Math.floor(p) - 0.5) - 1;
        break;
      }
      case 'square':
        x = softClip(4 * Math.sin(ph)) * 0.85;
        break;
      case 'fm':
        x = Math.sin(ph + fmI * env * Math.sin(ph * fmR));
        break;
    }
    const a = i < atkN ? i / atkN : 1;
    const fd = i >= n - fadeN ? (n - i) / fadeN : 1;
    out[i0 + i] += x * amp * env * a * fd;
    env *= eMul;
  }
}

/** Inharmonic partial stack (bells, struck metal). partials: [ratio, amp, tau]. */
export function bell(
  out: Float32Array,
  t: number,
  f: number,
  partials: ReadonlyArray<readonly [number, number, number]>,
  amp = 1,
  sr = rate.sr,
): void {
  for (const [ratio, a, tau] of partials) {
    tone(out, { t, dur: Math.min(tau * 6, out.length / sr - t), f0: f * ratio, amp: a * amp, tau, atk: 0.0008 }, sr);
  }
}

// ---------------------------------------------------------------------------------------------
// Noise layer
// ---------------------------------------------------------------------------------------------

export interface FilterSpec {
  type: FilterType;
  f: number;
  /** If set the cutoff glides exponentially from f to f1 (time constant fTau, default dur/3). */
  f1?: number;
  fTau?: number;
  q?: number;
}

export interface NoiseSpec {
  t?: number;
  dur: number;
  amp?: number;
  atk?: number;
  tau?: number;
  color?: NoiseColor;
  f?: FilterSpec[];
}

/** Restore roughly unit RMS after a filter so `amp` means the same thing regardless of bandwidth. */
function makeup(type: FilterType, f: number, q: number, sr: number): number {
  const nyq = sr / 2;
  let bw: number;
  switch (type) {
    case 'bp':
      bw = (f / Math.max(0.2, q)) * 1.57;
      break;
    case 'lp':
      bw = f * 1.4;
      break;
    case 'hp':
      bw = Math.max(nyq * 0.1, nyq - f * 1.2);
      break;
    default:
      return 1;
  }
  return Math.min(10, Math.sqrt(nyq / Math.max(40, bw)));
}

export function noise(out: Float32Array, r: Rand, s: NoiseSpec, sr = rate.sr): void {
  const i0 = Math.max(0, Math.round((s.t ?? 0) * sr));
  const n = Math.min(out.length - i0, Math.round(s.dur * sr));
  if (n <= 0) return;
  const amp = s.amp ?? 1;
  const atkN = Math.max(1, Math.round((s.atk ?? 0.0005) * sr));
  const eMul = Math.exp(-1 / ((s.tau ?? s.dur / 3) * sr));
  const fadeN = Math.min(n, Math.round(0.002 * sr));
  const color = s.color === 'pink' ? 1 : s.color === 'brown' ? 2 : 0;
  const gen = new Noise(r);
  const fs = s.f ?? [];
  const nf = fs.length;
  const bq: Biquad[] = [];
  const fDelta: number[] = [];
  const fMul8: number[] = [];
  let dynamic = false;
  for (let k = 0; k < nf; k++) {
    bq.push(new Biquad());
    fDelta.push(fs[k].f - (fs[k].f1 ?? fs[k].f));
    fMul8.push(Math.exp(-8 / ((fs[k].fTau ?? s.dur / 3) * sr)));
    if (fs[k].f1 !== undefined) dynamic = true;
  }
  let gain = amp;
  const refresh = (): void => {
    let g = amp;
    for (let k = 0; k < nf; k++) {
      const spec = fs[k];
      const fc = (spec.f1 ?? spec.f) + fDelta[k];
      const q = spec.q ?? 0.707;
      bq[k].set(spec.type, fc, q, sr);
      g *= makeup(spec.type, fc, q, sr);
      fDelta[k] *= fMul8[k];
    }
    gain = g;
  };
  refresh();
  const b0 = nf > 0 ? bq[0] : null;
  const b1 = nf > 1 ? bq[1] : null;
  let env = 1;
  for (let i = 0; i < n; i++) {
    if (dynamic && (i & 7) === 7) refresh();
    let x = color === 0 ? gen.white() : color === 1 ? gen.pink() : gen.brown();
    if (b0) {
      x = b0.process(x);
      if (b1) {
        x = b1.process(x);
        for (let k = 2; k < nf; k++) x = bq[k].process(x);
      }
    }
    const a = i < atkN ? i / atkN : 1;
    const fd = i >= n - fadeN ? (n - i) / fadeN : 1;
    out[i0 + i] += x * gain * env * a * fd;
    env *= eMul;
  }
}

export interface GrainSpec {
  t?: number;
  dur: number;
  count: number;
  amp: number;
  /** Grain length range in seconds. */
  gdur: [number, number];
  /** Centre-frequency range of each grain's filter. */
  f: [number, number];
  type?: FilterType;
  q?: number;
  /** >1 clusters grains toward the start (decaying debris). */
  skew?: number;
  /** Time constant that fades later grains. */
  ampTau?: number;
}

/** Scatter short filtered noise ticks — crunch, debris, shards, rustle. */
export function grains(out: Float32Array, r: Rand, g: GrainSpec, sr = rate.sr): void {
  const t0 = g.t ?? 0;
  const type = g.type ?? 'bp';
  const q = g.q ?? 1.2;
  const gen = new Noise(r);
  const bq = new Biquad();
  for (let c = 0; c < g.count; c++) {
    const off = g.dur * Math.pow(r.next(), g.skew ?? 1);
    const gd = r.range(g.gdur[0], g.gdur[1]);
    const a = g.amp * r.range(0.35, 1) * (g.ampTau ? Math.exp(-off / g.ampTau) : 1);
    const fc = r.range(g.f[0], g.f[1]);
    const i0 = Math.round((t0 + off) * sr);
    const n = Math.min(out.length - i0, Math.round(gd * sr));
    if (n <= 0) continue;
    bq.set(type, fc, q, sr);
    const gain = a * makeup(type, fc, q, sr);
    const atkN = Math.max(1, Math.round(Math.min(0.0004, gd / 4) * sr));
    const eMul = Math.exp(-3 / (gd * sr));
    const fadeN = Math.min(n, Math.round(0.002 * sr));
    let env = 1;
    for (let i = 0; i < n; i++) {
      const x = bq.process(gen.white());
      const e = (i < atkN ? i / atkN : 1) * (i >= n - fadeN ? (n - i) / fadeN : 1);
      out[i0 + i] += x * gain * env * e;
      env *= eMul;
    }
  }
}

/** Time-varying filter applied to a finished buffer (radio band-limit, horn sweeps). */
export function sweepFilter(out: Float32Array, spec: FilterSpec, sr = rate.sr): void {
  const bq = new Biquad();
  const q = spec.q ?? 0.707;
  const f1 = spec.f1 ?? spec.f;
  let df = spec.f - f1;
  const mul8 = Math.exp(-8 / ((spec.fTau ?? out.length / sr / 3) * sr));
  bq.set(spec.type, spec.f, q, sr);
  for (let i = 0; i < out.length; i++) {
    if ((i & 7) === 7 && spec.f1 !== undefined) {
      bq.set(spec.type, f1 + df, q, sr);
      df *= mul8;
    }
    out[i] = bq.process(out[i]);
  }
}

/** Normalise, optionally soft-clip for weight, then declick the edges. */
export function finish(out: Float32Array, peak = 0.9, drive = 0): Float32Array {
  let m = 0;
  for (let i = 0; i < out.length; i++) {
    const a = Math.abs(out[i]);
    if (a > m) m = a;
  }
  if (m < 1e-9) return out;
  let k = 1 / m;
  if (drive > 0) {
    const nrm = 1 / softClip(drive);
    for (let i = 0; i < out.length; i++) out[i] = softClip(out[i] * k * drive) * nrm;
    k = 1;
  }
  const inN = Math.min(8, out.length);
  const outN = Math.min(96, out.length);
  for (let i = 0; i < out.length; i++) {
    let g = k * peak;
    if (i < inN) g *= i / inN;
    const rem = out.length - i;
    if (rem < outN) g *= rem / outN;
    out[i] *= g;
  }
  return out;
}

/** Linear-interpolated resample (used to bring reverb impulses to the context rate). */
export function resampleLinear(data: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return data;
  const n = Math.max(1, Math.round((data.length * to) / from));
  const o = new Float32Array(n);
  const step = from / to;
  for (let i = 0; i < n; i++) {
    const p = i * step;
    const j = Math.floor(p);
    const fr = p - j;
    const a = data[Math.min(j, data.length - 1)];
    const b = data[Math.min(j + 1, data.length - 1)];
    o[i] = a + (b - a) * fr;
  }
  return o;
}
