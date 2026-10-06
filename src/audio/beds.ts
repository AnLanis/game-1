/**
 * Ambience material: seamless looping beds (wind / market / birds / harbor / storm / hum) and the
 * sporadic one-shot events layered over them (bird calls, ship horn, thunder, clinks, crackle).
 * Pure sample renderers — see `ambience.ts` for playback.
 */

import { Biquad, bell, buf, finish, grains, Noise, noise, sweepFilter, TAU, tone, type Rand } from './dsp';

export type BedKind = 'wind' | 'market' | 'birds' | 'harbor' | 'storm' | 'hum';
export type AmbienceEventKind = 'chirp' | 'horn' | 'thunder' | 'clink' | 'crackle';

export const BED_SECONDS = 6;
const XFADE = 0.75;

/** Fold the tail (x[len..len+xf]) onto the head with an equal-power crossfade so the loop is seamless. */
function fold(x: Float32Array, len: number, xf: number): Float32Array {
  const o = x.slice(0, len);
  for (let i = 0; i < xf; i++) {
    const a = (Math.PI / 2) * (i / xf);
    o[i] = x[i] * Math.sin(a) + x[len + i] * Math.cos(a);
  }
  return o;
}

/** Peak-normalise without edge fades (fades would put a dip at the loop point). */
function normalise(o: Float32Array, peak: number): Float32Array {
  let m = 0;
  for (let i = 0; i < o.length; i++) m = Math.max(m, Math.abs(o[i]));
  if (m > 1e-9) {
    const k = peak / m;
    for (let i = 0; i < o.length; i++) o[i] *= k;
  }
  return o;
}

interface WindSpec {
  lp: number;
  fc: number;
  fcDepth: number;
  q: number;
  lpMix: number;
  bpMix: number;
  base: number;
  gust: number;
}

/** Gusting wind: pink noise through a slowly sweeping resonant band plus a low body, amplitude-modulated. */
function windRaw(r: Rand, sr: number, len: number, xf: number, p: WindSpec): Float32Array {
  const n = len + xf;
  const g = new Noise(r);
  const lp = new Biquad().set('lp', p.lp, 0.6, sr);
  const bp = new Biquad();
  const T = len / sr;
  const o = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const ph = (TAU * i) / sr / T;
    if ((i & 15) === 0) {
      const fc = p.fc + p.fcDepth * Math.sin(ph * 2) + p.fcDepth * 0.45 * Math.sin(ph * 5 + 1);
      bp.set('bp', fc, p.q, sr);
    }
    const w = g.pink();
    const a = Math.max(0.05, p.base + p.gust * Math.sin(ph) + p.gust * 0.4 * Math.sin(ph * 3 + 2));
    o[i] = (lp.process(w) * p.lpMix + bp.process(w) * p.bpMix) * a;
  }
  return o;
}

/** Filtered noise layer over a whole raw array (for loop material). */
function bandNoise(r: Rand, n: number, sr: number, type: 'lp' | 'hp' | 'bp', f: number, q: number, color: 'white' | 'pink' | 'brown', gain: number, mod?: (i: number) => number): Float32Array {
  const g = new Noise(r);
  const bq = new Biquad().set(type, f, q, sr);
  const o = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const w = color === 'white' ? g.white() : color === 'pink' ? g.pink() : g.brown();
    o[i] = bq.process(w) * gain * (mod ? mod(i) : 1);
  }
  return o;
}

function mixInto(dst: Float32Array, src: Float32Array): void {
  for (let i = 0; i < dst.length; i++) dst[i] += src[i];
}

/** One voiced-ish murmur syllable, written with wrap-around so it can straddle the loop point. */
function syllable(o: Float32Array, r: Rand, t: number, dur: number, f1: number, f2: number, pitch: number, level: number, sr: number): void {
  const len = o.length;
  const n = Math.round(dur * sr);
  const i0 = Math.round(t * sr);
  const g = new Noise(r);
  const b1 = new Biquad().set('bp', f1, 3, sr);
  const b2 = new Biquad().set('bp', f2, 4, sr);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const env = Math.sin(Math.PI * u) ** 2;
    ph += (pitch * (1 + 0.15 * (u - 0.5))) / sr;
    const saw = 2 * (ph - Math.floor(ph)) - 1;
    const exc = g.white() * 0.6 + saw * 0.4;
    const y = b1.process(exc) * 1.0 + b2.process(exc) * 0.6;
    o[(i0 + i) % len] += y * env * level;
  }
}

export function renderBed(kind: BedKind, r: Rand, sr: number): Float32Array {
  const len = Math.round(BED_SECONDS * sr);
  const xf = Math.round(XFADE * sr);
  const n = len + xf;
  const T = len / sr;

  switch (kind) {
    case 'wind': {
      const o = fold(windRaw(r, sr, len, xf, { lp: 800, fc: 450, fcDepth: 260, q: 2.2, lpMix: 0.6, bpMix: 1.6, base: 0.55, gust: 0.35 }), len, xf);
      return normalise(o, 0.7);
    }
    case 'storm': {
      const raw = windRaw(r, sr, len, xf, { lp: 500, fc: 520, fcDepth: 300, q: 5, lpMix: 0.5, bpMix: 2.2, base: 0.8, gust: 0.5 });
      mixInto(raw, windRaw(r, sr, len, xf, { lp: 400, fc: 1100, fcDepth: 350, q: 7, lpMix: 0, bpMix: 1.2, base: 0.6, gust: 0.4 }));
      mixInto(raw, bandNoise(r, n, sr, 'lp', 160, 0.7, 'brown', 0.8));
      mixInto(raw, bandNoise(r, n, sr, 'hp', 3500, 0.7, 'white', 0.1, (i) => 0.7 + 0.3 * Math.sin((TAU * i * 7) / sr / T)));
      return normalise(fold(raw, len, xf), 0.75);
    }
    case 'birds': {
      // A soft breeze + leaf hiss; the calls themselves come from scheduled 'chirp' events.
      const raw = windRaw(r, sr, len, xf, { lp: 600, fc: 700, fcDepth: 200, q: 1.5, lpMix: 0.8, bpMix: 0.5, base: 0.5, gust: 0.3 });
      mixInto(raw, bandNoise(r, n, sr, 'hp', 3000, 0.7, 'pink', 0.12, (i) => 0.6 + 0.4 * Math.sin((TAU * i * 3) / sr / T + 1)));
      return normalise(fold(raw, len, xf), 0.6);
    }
    case 'harbor': {
      const sw = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const ph = (TAU * i) / sr / T;
        sw[i] = 0.7 * (0.5 + 0.5 * Math.sin(ph + 0.5)) ** 2 + 0.3 * (0.5 + 0.5 * Math.sin(ph * 2 + 2)) ** 3;
      }
      const raw = bandNoise(r, n, sr, 'lp', 520, 0.7, 'brown', 1.6, (i) => 0.25 + 0.75 * sw[i]);
      mixInto(raw, bandNoise(r, n, sr, 'bp', 2500, 0.5, 'white', 0.5, (i) => sw[i] * sw[i]));
      mixInto(raw, bandNoise(r, n, sr, 'lp', 1500, 0.7, 'pink', 0.35, (i) => 0.5 + 0.5 * Math.sin((TAU * i * 17) / sr / T)));
      return normalise(fold(raw, len, xf), 0.7);
    }
    case 'market': {
      const o = fold(bandNoise(r, n, sr, 'lp', 380, 0.7, 'pink', 0.6), len, xf);
      for (let s = 0; s < 7; s++) {
        let t = r.range(0, 0.4);
        const level = r.range(0.4, 1);
        const base = r.range(300, 700);
        const pitch = r.range(105, 230);
        while (t < BED_SECONDS) {
          const dur = r.range(0.07, 0.22);
          syllable(o, r, t, dur, base * r.range(0.8, 1.6), r.range(1100, 2400), pitch, level * r.range(0.5, 1), sr);
          t += dur + (r.next() < 0.25 ? r.range(0.3, 0.9) : r.range(0.02, 0.15));
        }
      }
      return normalise(o, 0.7);
    }
    case 'hum': {
      const snap = (f: number): number => Math.round(f * T) / T;
      const o = fold(bandNoise(r, n, sr, 'lp', 600, 0.6, 'pink', 0.35, (i) => 0.7 + 0.3 * Math.sin((TAU * i) / sr / T)), len, xf);
      const partials: Array<[number, number]> = [[55, 1], [55.5, 0.8], [110, 0.5], [165.33, 0.25]];
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const lfo = 0.85 + 0.15 * Math.sin((TAU * t) / T);
        let d = 0;
        for (const [f, a] of partials) d += Math.sin(TAU * snap(f) * t) * a;
        const flutter = 0.8 + 0.2 * Math.sin((TAU * 3 * t) / T);
        const e = Math.sin(TAU * 120 * t) + 0.5 * Math.sin(TAU * 240 * t) + 0.33 * Math.sin(TAU * 360 * t) + 0.2 * Math.sin(TAU * 600 * t);
        o[i] += d * lfo * 0.5 + e * flutter * 0.1;
      }
      return normalise(o, 0.7);
    }
  }
}

export function renderAmbienceEvent(kind: AmbienceEventKind, r: Rand, v: number, sr: number): Float32Array {
  switch (kind) {
    case 'chirp': {
      const o = buf(0.7, sr);
      const call = (t: number, f0: number, f1: number, dur: number, amp: number, vib?: [number, number]): void => {
        tone(o, { t, dur, f0, f1, pTau: dur / 3, tau: dur / 2.2, atk: 0.004, amp, vib }, sr);
        tone(o, { t, dur, f0: f0 * 2, f1: f1 * 2, pTau: dur / 3, tau: dur / 3, atk: 0.004, amp: amp * 0.15 }, sr);
      };
      if (v % 4 === 0) {
        // Rising triplet.
        for (let i = 0; i < 3; i++) call(i * 0.11, r.range(2600, 3200) + i * 200, r.range(3600, 4400) + i * 250, 0.08, 0.8);
      } else if (v % 4 === 1) {
        // Two long falling whistles.
        call(0, r.range(4200, 4800), r.range(2400, 2900), 0.22, 0.8);
        call(0.3, r.range(3800, 4400), r.range(2200, 2700), 0.18, 0.6);
      } else if (v % 4 === 2) {
        // Trill.
        call(0, r.range(3000, 3600), r.range(3200, 3800), 0.4, 0.7, [24, 0.12]);
      } else {
        // Quick pips.
        for (let i = 0; i < 5; i++) call(i * 0.075, r.range(3800, 5200), r.range(3600, 5000), 0.035, 0.7);
      }
      return finish(o, 0.6);
    }
    case 'horn': {
      // Distant ship horn: two detuned saws and a fifth, swelling in, heavily low-passed.
      const o = buf(2.8, sr);
      const f = v % 2 === 0 ? 78 : 104;
      tone(o, { dur: 2.6, f0: f * 0.92, f1: f, pTau: 0.25, wave: 'saw', atk: 0.5, tau: 1.6, amp: 1 }, sr);
      tone(o, { dur: 2.6, f0: f * 0.92 * 1.012, f1: f * 1.012, pTau: 0.25, wave: 'saw', atk: 0.5, tau: 1.6, amp: 0.8 }, sr);
      tone(o, { dur: 2.6, f0: f * 1.5, f1: f * 1.5, wave: 'saw', atk: 0.6, tau: 1.6, amp: 0.4 }, sr);
      sweepFilter(o, { type: 'lp', f: 420, q: 1 }, sr);
      return finish(o, 0.8);
    }
    case 'thunder': {
      const o = buf(4.0, sr);
      noise(o, r, { dur: 0.15, amp: 1, atk: 0.002, tau: 0.04, f: [{ type: 'bp', f: 900, q: 0.7 }] }, sr);
      noise(o, r, { dur: 3.8, amp: 1.4, atk: 0.15, tau: 1.4, color: 'brown', f: [{ type: 'lp', f: 500, f1: 100, fTau: 1.2, q: 0.7 }] }, sr);
      for (let i = 0; i < o.length; i++) o[i] *= 0.6 + 0.4 * Math.sin((TAU * 1.1 * i) / sr + v * 2);
      return finish(o, 0.9);
    }
    case 'clink': {
      const o = buf(0.4, sr);
      noise(o, r, { dur: 0.004, amp: 0.4, atk: 0.0001, tau: 0.001, f: [{ type: 'bp', f: 4000, q: 1 }] }, sr);
      bell(o, 0, r.range(2200, 3400), [[1, 1, 0.1], [1.6, 0.5, 0.06], [2.4, 0.3, 0.04]], 1, sr);
      return finish(o, 0.6);
    }
    case 'crackle': {
      const o = buf(0.3, sr);
      grains(o, r, { dur: 0.22, count: 9, amp: 1, gdur: [0.0005, 0.003], f: [2500, 7000], q: 1, ampTau: 0.1 }, sr);
      return finish(o, 0.6);
    }
  }
}
