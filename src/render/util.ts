import { Color } from 'three';

/** Linear-space RGB triple (what vertex colours and shader uniforms want). */
export type RGB = [number, number, number];

const colorCache = new Map<string, RGB>();
const scratchColor = new Color();

/** Hex string (sRGB) → linear RGB, cached. Returned arrays must be treated as read-only. */
export function lin(hex: string): RGB {
  let c = colorCache.get(hex);
  if (!c) {
    scratchColor.set(hex);
    c = [scratchColor.r, scratchColor.g, scratchColor.b];
    colorCache.set(hex, c);
  }
  return c;
}

export const mix3 = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const scale3 = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
export const mul3 = (a: RGB, b: RGB): RGB => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
export const luma = (a: RGB): number => a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;

/** Push colour toward its own luma (desaturate) or away (saturate) with k in [-1..1+]. */
export const saturate3 = (a: RGB, k: number): RGB => {
  const l = luma(a);
  return [l + (a[0] - l) * k, l + (a[1] - l) * k, l + (a[2] - l) * k];
};

/** Integer hash → [0,1). Pure, fast, deterministic. */
export function hash1(n: number): number {
  let h = (n | 0) + 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number): number => t * t * (3 - 2 * t);

/** Smooth value noise in [0,1]. */
export function vnoise(x: number, y: number, seed = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Fractal value noise in [0,1]. */
export function fbm(x: number, y: number, seed = 0, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let fx = x;
  let fy = y;
  for (let o = 0; o < octaves; o += 1) {
    sum += vnoise(fx, fy, seed + o * 31) * amp;
    norm += amp;
    amp *= 0.5;
    fx *= 2.03;
    fy *= 2.03;
  }
  return sum / norm;
}

/** Periodic (tileable) value noise: lattice of `period` cells wraps seamlessly. */
export function tnoise(x: number, y: number, period: number, seed = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const x0 = ((ix % period) + period) % period;
  const y0 = ((iy % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Tileable fractal noise, base `period` cells across the unit square, doubled per octave. */
export function tfbm(u: number, v: number, period: number, seed: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let p = period;
  for (let o = 0; o < octaves; o += 1) {
    sum += tnoise(u * p, v * p, p, seed + o * 17) * amp;
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}

/** Tiny deterministic PRNG (mulberry32). */
export class Rand {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number): number {
    return Math.floor(a + (b - a + 1) * this.next());
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.next() * list.length) % list.length];
  }
}

/**
 * Greedy rectangle merge over a w×h grid. `key(i,j)` returns 0 for empty cells,
 * otherwise a class id; maximal same-class rectangles are reported via `emit`.
 * Pure and allocation-light: this is what turns thousands of solid cells into a
 * few dozen boxes.
 */
export function greedyRects(w: number, h: number, key: (i: number, j: number) => number, emit: (i0: number, j0: number, i1: number, j1: number, k: number) => void): void {
  const used = new Uint8Array(w * h);
  for (let j = 0; j < h; j += 1) {
    for (let i = 0; i < w; i += 1) {
      if (used[j * w + i]) continue;
      const k = key(i, j);
      if (k === 0) continue;
      let i1 = i;
      while (i1 + 1 < w && !used[j * w + i1 + 1] && key(i1 + 1, j) === k) i1 += 1;
      let j1 = j;
      outer: for (;;) {
        if (j1 + 1 >= h) break;
        for (let ii = i; ii <= i1; ii += 1) {
          if (used[(j1 + 1) * w + ii] || key(ii, j1 + 1) !== k) break outer;
        }
        j1 += 1;
      }
      for (let jj = j; jj <= j1; jj += 1) for (let ii = i; ii <= i1; ii += 1) used[jj * w + ii] = 1;
      emit(i, j, i1, j1, k);
    }
  }
}

/** Wrap an angle difference into (-PI, PI]. */
export const angDiff = (a: number, b: number): number => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d <= -Math.PI) d += Math.PI * 2;
  return d;
};

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smooth = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);
