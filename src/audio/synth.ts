/**
 * Sound recipes. Every effect is synthesised sample-by-sample from noise bursts, filtered noise
 * and pitch-enveloped oscillators — no assets. Recipes are pure and seeded (see `bank.ts`), so a
 * given (key, variant) always renders the same samples.
 */

import type { WeaponClass } from '../content/types';
import { bell, buf, finish, grains, hashSeed, noise, Rand, rate, SR, SR_LOW, SR_MID, sweepFilter, tone } from './dsp';
import { renderAmbienceEvent, renderBed } from './beds';
import { SFX_DEFS, STEP_GROUPS, type StepGroup } from './sfxdefs';
import type { SfxId } from './types';

export type Recipe = (r: Rand, v: number) => Float32Array;

export interface BankEntry {
  key: string;
  variants: number;
  sr: number;
  /** Lazy entries are rendered on first use only (ambience beds); the rest are pre-rendered. */
  lazy: boolean;
  render: Recipe;
}

// ---------------------------------------------------------------------------------------------
// Footsteps
// ---------------------------------------------------------------------------------------------

const stepRecipes: Record<StepGroup, Recipe> = {
  hard: (r) => {
    const o = buf(0.16);
    const toe = r.range(0.05, 0.075);
    noise(o, r, { dur: 0.012, amp: 1, atk: 0.0002, tau: 0.003, f: [{ type: 'bp', f: r.jitter(2600, 0.12), q: 1.2 }] });
    noise(o, r, { dur: 0.05, amp: 0.45, tau: 0.012, f: [{ type: 'bp', f: r.jitter(900, 0.1), q: 0.9 }] });
    tone(o, { dur: 0.09, f0: r.jitter(160, 0.08), f1: 70, pTau: 0.02, tau: 0.03, amp: 0.6 });
    noise(o, r, { t: toe, dur: 0.02, amp: 0.4, tau: 0.005, f: [{ type: 'bp', f: r.jitter(3000, 0.1), q: 1 }] });
    tone(o, { t: toe, dur: 0.06, f0: r.jitter(120, 0.08), f1: 80, pTau: 0.015, tau: 0.02, amp: 0.25 });
    return finish(o, 0.8);
  },
  dirt: (r) => {
    const o = buf(0.18);
    noise(o, r, { dur: 0.09, amp: 0.9, atk: 0.001, tau: 0.03, f: [{ type: 'lp', f: r.jitter(750, 0.12), q: 0.8 }] });
    tone(o, { dur: 0.09, f0: r.jitter(115, 0.08), f1: 60, pTau: 0.025, tau: 0.035, amp: 0.7 });
    grains(o, r, { t: 0.01, dur: 0.1, count: 7, amp: 0.3, gdur: [0.003, 0.008], f: [1200, 3000], type: 'lp', q: 0.7, skew: 1.3 });
    noise(o, r, { t: r.range(0.06, 0.08), dur: 0.05, amp: 0.3, tau: 0.02, f: [{ type: 'lp', f: 600, q: 0.8 }] });
    return finish(o, 0.75);
  },
  sand: (r) => {
    const o = buf(0.24);
    noise(o, r, { dur: 0.12, amp: 0.4, atk: 0.006, tau: 0.05, f: [{ type: 'lp', f: r.jitter(1300, 0.1), q: 0.7 }] });
    tone(o, { dur: 0.08, f0: r.jitter(100, 0.08), f1: 58, pTau: 0.025, tau: 0.03, amp: 0.4 });
    grains(o, r, { t: 0.005, dur: 0.14, count: 16, amp: 0.5, gdur: [0.003, 0.009], f: [1500, 4200], q: 0.9, skew: 1.1, ampTau: 0.09 });
    return finish(o, 0.7);
  },
  regolith: (r) => {
    // Dry, low-gravity dust: slower, grittier and a touch lower than sand.
    const o = buf(0.28);
    noise(o, r, { dur: 0.16, amp: 0.35, atk: 0.008, tau: 0.07, f: [{ type: 'lp', f: r.jitter(900, 0.1), q: 0.7 }] });
    tone(o, { dur: 0.09, f0: r.jitter(85, 0.08), f1: 50, pTau: 0.03, tau: 0.035, amp: 0.45 });
    grains(o, r, { t: 0.01, dur: 0.18, count: 20, amp: 0.45, gdur: [0.004, 0.012], f: [1000, 3200], q: 1.4, skew: 1.2, ampTau: 0.12 });
    return finish(o, 0.7);
  },
  metal: (r) => {
    const o = buf(0.3);
    const f = r.jitter(430, 0.08);
    noise(o, r, { dur: 0.012, amp: 0.9, atk: 0.0002, tau: 0.003, f: [{ type: 'bp', f: r.jitter(2400, 0.1), q: 1.4 }] });
    tone(o, { dur: 0.08, f0: 150, f1: 75, pTau: 0.02, tau: 0.03, amp: 0.55 });
    bell(o, 0, f, [[1, 0.4, 0.08], [2.32, 0.28, 0.05], [3.9, 0.16, 0.03], [5.7, 0.07, 0.02]]);
    return finish(o, 0.8);
  },
  snow: (r) => {
    const o = buf(0.22);
    noise(o, r, { dur: 0.1, amp: 0.3, atk: 0.004, tau: 0.04, f: [{ type: 'lp', f: 1500, q: 0.7 }] });
    tone(o, { dur: 0.07, f0: 95, f1: 55, pTau: 0.025, tau: 0.03, amp: 0.35 });
    grains(o, r, { t: 0.004, dur: 0.12, count: 14, amp: 0.55, gdur: [0.002, 0.007], f: [3000, 6500], type: 'bp', q: 1.5, ampTau: 0.07 });
    // Squeak: a small rising whistle, only on some steps.
    if (r.next() < 0.6) tone(o, { t: 0.02, dur: 0.07, f0: r.range(2300, 2700), f1: r.range(3100, 3600), pTau: 0.04, tau: 0.04, atk: 0.008, amp: 0.1 });
    return finish(o, 0.7);
  },
  wood: (r) => {
    const o = buf(0.22);
    const toe = r.range(0.06, 0.085);
    tone(o, { dur: 0.12, f0: r.jitter(145, 0.06), f1: 85, pTau: 0.015, tau: 0.04, amp: 0.9 });
    noise(o, r, { dur: 0.06, amp: 0.6, tau: 0.02, f: [{ type: 'bp', f: r.jitter(650, 0.12), q: 1.6 }] });
    tone(o, { dur: 0.15, f0: r.jitter(240, 0.05), tau: 0.05, amp: 0.22 });
    noise(o, r, { t: toe, dur: 0.05, amp: 0.35, tau: 0.015, f: [{ type: 'bp', f: r.jitter(800, 0.1), q: 1.5 }] });
    tone(o, { t: toe, dur: 0.07, f0: 120, f1: 80, pTau: 0.015, tau: 0.025, amp: 0.3 });
    return finish(o, 0.8);
  },
  foliage: (r) => {
    const o = buf(0.24);
    grains(o, r, { dur: 0.15, count: 11, amp: 0.55, gdur: [0.015, 0.035], f: [2500, 6000], q: 0.7, ampTau: 0.1 });
    noise(o, r, { dur: 0.1, amp: 0.25, atk: 0.01, tau: 0.04, f: [{ type: 'lp', f: 500, q: 0.7 }] });
    return finish(o, 0.65);
  },
  fabric: (r) => {
    const o = buf(0.16);
    noise(o, r, { dur: 0.09, amp: 0.8, atk: 0.003, tau: 0.035, f: [{ type: 'lp', f: r.jitter(520, 0.1), q: 0.7 }] });
    tone(o, { dur: 0.08, f0: 100, f1: 60, pTau: 0.02, tau: 0.03, amp: 0.5 });
    return finish(o, 0.6);
  },
  glass: (r) => {
    const o = buf(0.26);
    noise(o, r, { dur: 0.012, amp: 0.8, atk: 0.0002, tau: 0.003, f: [{ type: 'bp', f: 3000, q: 1.2 }] });
    tone(o, { dur: 0.08, f0: 140, f1: 70, pTau: 0.02, tau: 0.03, amp: 0.5 });
    grains(o, r, { t: 0.005, dur: 0.16, count: 12, amp: 0.55, gdur: [0.002, 0.006], f: [3500, 8000], q: 3, ampTau: 0.09 });
    return finish(o, 0.75);
  },
};

// ---------------------------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------------------------

interface GunSpec {
  len: number;
  click: number;
  /** Body noise low-pass sweep (Hz) and decay. */
  f0: number;
  f1: number;
  bTau: number;
  bAmp: number;
  /** Low thump: pitch drop, decay, level. */
  tF0: number;
  tF1: number;
  tTau: number;
  tAmp: number;
  drive: number;
  crackle: number;
  whoosh: number;
  tailLen: number;
  tailTau: number;
  tailLp: number;
}

const GUNS: Record<WeaponClass, GunSpec> = {
  rifle: { len: 0.28, click: 1, f0: 5200, f1: 900, bTau: 0.05, bAmp: 1, tF0: 130, tF1: 55, tTau: 0.05, tAmp: 0.8, drive: 2.2, crackle: 0, whoosh: 0, tailLen: 1.0, tailTau: 0.35, tailLp: 2400 },
  smg: { len: 0.18, click: 1, f0: 6000, f1: 1400, bTau: 0.03, bAmp: 1, tF0: 170, tF1: 75, tTau: 0.03, tAmp: 0.55, drive: 2, crackle: 0, whoosh: 0, tailLen: 0.6, tailTau: 0.2, tailLp: 3000 },
  shotgun: { len: 0.5, click: 1, f0: 4500, f1: 500, bTau: 0.11, bAmp: 1, tF0: 95, tF1: 38, tTau: 0.12, tAmp: 1.1, drive: 2.5, crackle: 14, whoosh: 0, tailLen: 1.3, tailTau: 0.5, tailLp: 2000 },
  pistol: { len: 0.2, click: 1, f0: 6500, f1: 1200, bTau: 0.035, bAmp: 1, tF0: 140, tF1: 65, tTau: 0.04, tAmp: 0.6, drive: 2, crackle: 0, whoosh: 0, tailLen: 0.7, tailTau: 0.25, tailLp: 2800 },
  dmr: { len: 0.38, click: 1, f0: 4800, f1: 700, bTau: 0.07, bAmp: 1, tF0: 100, tF1: 45, tTau: 0.07, tAmp: 1, drive: 2.3, crackle: 0, whoosh: 0, tailLen: 1.2, tailTau: 0.45, tailLp: 2200 },
  lmg: { len: 0.32, click: 1, f0: 4800, f1: 800, bTau: 0.06, bAmp: 1, tF0: 105, tF1: 48, tTau: 0.06, tAmp: 0.95, drive: 2.2, crackle: 0, whoosh: 0, tailLen: 1.0, tailTau: 0.38, tailLp: 2200 },
  sniper: { len: 0.65, click: 1.1, f0: 4200, f1: 450, bTau: 0.13, bAmp: 1, tF0: 78, tF1: 30, tTau: 0.16, tAmp: 1.2, drive: 2.6, crackle: 0, whoosh: 0, tailLen: 1.6, tailTau: 0.7, tailLp: 1800 },
  launcher: { len: 0.8, click: 0.4, f0: 1600, f1: 180, bTau: 0.25, bAmp: 1.2, tF0: 65, tF1: 26, tTau: 0.3, tAmp: 1.2, drive: 2.2, crackle: 0, whoosh: 1, tailLen: 1.5, tailTau: 0.6, tailLp: 1200 },
};

/** Transient click + crack + filtered-noise body + pitch-dropping thump. */
function gunBody(kind: WeaponClass, r: Rand): Float32Array {
  const g = GUNS[kind];
  const o = buf(g.len);
  noise(o, r, { dur: 0.005, amp: g.click, atk: 0.00015, tau: 0.0012, f: [{ type: 'hp', f: r.jitter(2400, 0.1), q: 0.8 }] });
  noise(o, r, { dur: 0.03, amp: g.click * 0.5, tau: 0.007, f: [{ type: 'bp', f: r.jitter(3400, 0.1), q: 0.8 }] });
  noise(o, r, { dur: g.len, amp: g.bAmp, atk: 0.0004, tau: g.bTau, f: [{ type: 'lp', f: r.jitter(g.f0, 0.06), f1: g.f1, fTau: g.bTau * 0.8, q: 0.8 }] });
  tone(o, { dur: g.len, f0: r.jitter(g.tF0, 0.05), f1: g.tF1, pTau: 0.025, tau: g.tTau, amp: g.tAmp, atk: 0.001 });
  if (g.crackle > 0) grains(o, r, { t: 0.01, dur: g.len * 0.7, count: g.crackle, amp: 0.25, gdur: [0.002, 0.008], f: [1500, 5000], skew: 1.5, ampTau: g.len * 0.4 });
  if (g.whoosh > 0) noise(o, r, { dur: g.len, amp: 0.5, atk: 0.03, tau: 0.25, f: [{ type: 'hp', f: 700, q: 0.7 }, { type: 'lp', f: 5000, f1: 1500, q: 0.7 }] });
  return finish(o, 0.95, g.drive);
}

/** Dark, slow report tail (rendered at a low rate: everything above ~7 kHz is gone anyway). */
function gunTail(kind: WeaponClass, r: Rand): Float32Array {
  const g = GUNS[kind];
  const o = buf(g.tailLen);
  noise(o, r, { dur: g.tailLen, amp: 1, atk: 0.012, tau: g.tailTau, f: [{ type: 'lp', f: g.tailLp, f1: 260, fTau: g.tailTau * 0.7, q: 0.7 }] });
  noise(o, r, { dur: g.tailLen, amp: 0.7, atk: 0.02, tau: g.tailTau * 1.2, color: 'brown', f: [{ type: 'lp', f: 220, q: 0.7 }] });
  return finish(o, 0.6);
}

/** Suppressed: muffled short thwip. */
function gunSuppressed(r: Rand): Float32Array {
  const o = buf(0.16);
  noise(o, r, { dur: 0.1, amp: 0.9, atk: 0.001, tau: 0.02, f: [{ type: 'hp', f: 250, q: 0.7 }, { type: 'bp', f: r.jitter(900, 0.1), q: 0.7 }] });
  noise(o, r, { dur: 0.1, amp: 0.4, tau: 0.02, f: [{ type: 'lp', f: 2500, q: 0.7 }] });
  tone(o, { dur: 0.08, f0: 130, f1: 70, pTau: 0.02, tau: 0.02, amp: 0.4 });
  tone(o, { dur: 0.06, f0: r.jitter(700, 0.1), f1: 350, pTau: 0.015, tau: 0.015, amp: 0.25 });
  noise(o, r, { t: 0.012, dur: 0.02, amp: 0.3, tau: 0.005, f: [{ type: 'bp', f: 2000, q: 1.2 }] });
  return finish(o, 0.7);
}

/** Extra low-end layer that makes the player's own gun feel heavier than the same shot heard from afar. */
function gunPunch(r: Rand): Float32Array {
  const o = buf(0.14);
  tone(o, { dur: 0.14, f0: r.jitter(95, 0.05), f1: 38, pTau: 0.02, tau: 0.04, amp: 1, atk: 0.0008 });
  noise(o, r, { dur: 0.05, amp: 0.6, tau: 0.02, f: [{ type: 'lp', f: 500, q: 0.7 }] });
  return finish(o, 0.9, 2.5);
}

// ---------------------------------------------------------------------------------------------
// General effects
// ---------------------------------------------------------------------------------------------

type EffectId = Exclude<SfxId, 'step'>;

const effects: Record<EffectId, Recipe> = {
  land: (r) => {
    const o = buf(0.3);
    tone(o, { dur: 0.2, f0: r.jitter(110, 0.06), f1: 45, pTau: 0.04, tau: 0.09, amp: 1 });
    noise(o, r, { dur: 0.12, amp: 0.6, atk: 0.001, tau: 0.06, f: [{ type: 'lp', f: 700, q: 0.7 }] });
    grains(o, r, { t: 0.01, dur: 0.2, count: 10, amp: 0.3, gdur: [0.004, 0.012], f: [1200, 3200], type: 'lp', q: 0.7, skew: 1.2 });
    noise(o, r, { t: 0.02, dur: 0.16, amp: 0.2, atk: 0.02, tau: 0.08, f: [{ type: 'bp', f: 1500, q: 0.8 }] });
    return finish(o, 0.9);
  },
  jump: (r) => {
    const o = buf(0.2);
    noise(o, r, { dur: 0.16, amp: 0.35, atk: 0.02, tau: 0.06, f: [{ type: 'bp', f: 1400, f1: 900, q: 0.9 }] });
    tone(o, { dur: 0.08, f0: r.jitter(95, 0.06), f1: 60, pTau: 0.02, tau: 0.03, amp: 0.5 });
    return finish(o, 0.5);
  },
  slide: (r) => {
    const o = buf(0.6);
    noise(o, r, { dur: 0.6, amp: 0.6, atk: 0.05, tau: 0.25, color: 'pink', f: [{ type: 'bp', f: 2200, f1: 800, fTau: 0.3, q: 1.2 }] });
    grains(o, r, { dur: 0.5, count: 25, amp: 0.15, gdur: [0.002, 0.006], f: [3000, 6000], type: 'hp', q: 0.7 });
    tone(o, { dur: 0.1, f0: 100, f1: 60, pTau: 0.03, tau: 0.04, amp: 0.4 });
    return finish(o, 0.6);
  },
  reloadOut: (r) => {
    const o = buf(0.24);
    noise(o, r, { dur: 0.012, amp: 1, atk: 0.0002, tau: 0.002, f: [{ type: 'bp', f: r.jitter(2200, 0.08), q: 2 }] });
    tone(o, { dur: 0.06, f0: r.jitter(1650, 0.05), tau: 0.02, amp: 0.25 });
    noise(o, r, { t: 0.03, dur: 0.08, amp: 0.3, tau: 0.03, f: [{ type: 'bp', f: 1400, f1: 800, q: 1 }] });
    tone(o, { t: 0.12, dur: 0.1, f0: r.jitter(190, 0.06), f1: 100, pTau: 0.03, tau: 0.03, amp: 0.4 });
    noise(o, r, { t: 0.12, dur: 0.06, amp: 0.3, tau: 0.02, f: [{ type: 'lp', f: 800, q: 0.7 }] });
    return finish(o, 0.7);
  },
  reloadIn: (r) => {
    const o = buf(0.26);
    noise(o, r, { dur: 0.06, amp: 0.25, atk: 0.01, tau: 0.03, f: [{ type: 'bp', f: 1200, f1: 1800, q: 1 }] });
    tone(o, { t: 0.06, dur: 0.12, f0: r.jitter(210, 0.05), f1: 120, pTau: 0.015, tau: 0.04, amp: 0.9 });
    noise(o, r, { t: 0.06, dur: 0.06, amp: 0.5, tau: 0.03, f: [{ type: 'bp', f: 900, q: 1 }] });
    noise(o, r, { t: 0.065, dur: 0.01, amp: 0.6, atk: 0.0002, tau: 0.002, f: [{ type: 'bp', f: 2400, q: 1.5 }] });
    noise(o, r, { t: 0.14, dur: 0.01, amp: 0.4, atk: 0.0002, tau: 0.002, f: [{ type: 'bp', f: 3000, q: 1.5 }] });
    tone(o, { t: 0.14, dur: 0.05, f0: 1800, tau: 0.015, amp: 0.15 });
    return finish(o, 0.7);
  },
  bolt: (r) => {
    const o = buf(0.5);
    const click = (t: number, f: number, a: number): void => {
      noise(o, r, { t, dur: 0.012, amp: a, atk: 0.0002, tau: 0.003, f: [{ type: 'bp', f: r.jitter(f, 0.06), q: 1.6 }] });
      tone(o, { t, dur: 0.06, f0: r.jitter(f * 0.45, 0.05), tau: 0.025, amp: a * 0.3 });
    };
    click(0, 2000, 0.7);
    noise(o, r, { t: 0.04, dur: 0.12, amp: 0.3, tau: 0.05, f: [{ type: 'bp', f: 1800, f1: 900, q: 1 }] });
    click(0.17, 1500, 0.9);
    noise(o, r, { t: 0.28, dur: 0.1, amp: 0.3, tau: 0.04, f: [{ type: 'bp', f: 900, f1: 1800, q: 1 }] });
    click(0.4, 1300, 1);
    tone(o, { t: 0.4, dur: 0.1, f0: 160, f1: 90, pTau: 0.02, tau: 0.035, amp: 0.5 });
    return finish(o, 0.75);
  },
  dryfire: (r) => {
    const o = buf(0.08);
    noise(o, r, { dur: 0.01, amp: 1, atk: 0.0002, tau: 0.002, f: [{ type: 'bp', f: r.jitter(3000, 0.08), q: 1.4 }] });
    tone(o, { dur: 0.05, f0: r.jitter(1900, 0.05), tau: 0.012, amp: 0.3 });
    tone(o, { dur: 0.06, f0: r.jitter(400, 0.05), tau: 0.02, amp: 0.2 });
    return finish(o, 0.5);
  },
  switch: (r) => {
    const o = buf(0.3);
    noise(o, r, { dur: 0.13, amp: 0.3, atk: 0.04, tau: 0.05, f: [{ type: 'bp', f: 900, f1: 2200, q: 0.9 }] });
    noise(o, r, { t: 0.14, dur: 0.012, amp: 0.9, atk: 0.0002, tau: 0.003, f: [{ type: 'bp', f: r.jitter(1800, 0.08), q: 1.5 }] });
    tone(o, { t: 0.14, dur: 0.08, f0: 170, f1: 95, pTau: 0.02, tau: 0.03, amp: 0.5 });
    noise(o, r, { t: 0.2, dur: 0.01, amp: 0.4, atk: 0.0002, tau: 0.002, f: [{ type: 'bp', f: 2600, q: 1.5 }] });
    return finish(o, 0.6);
  },
  hitmarker: (r) => {
    const o = buf(0.07);
    noise(o, r, { dur: 0.004, amp: 0.6, atk: 0.0001, tau: 0.001, f: [{ type: 'bp', f: 4000, q: 1 }] });
    tone(o, { dur: 0.05, f0: r.jitter(2600, 0.03), f1: r.jitter(2300, 0.03), pTau: 0.02, tau: 0.012, amp: 0.8, atk: 0.0005 });
    tone(o, { dur: 0.04, f0: r.jitter(3700, 0.03), tau: 0.008, amp: 0.3, atk: 0.0005 });
    return finish(o, 0.7);
  },
  headshot: (r) => {
    const o = buf(0.45);
    const f = r.jitter(1760, 0.02);
    noise(o, r, { dur: 0.005, amp: 0.5, atk: 0.0001, tau: 0.0015, f: [{ type: 'hp', f: 3000, q: 0.7 }] });
    bell(o, 0, f, [[1, 1, 0.09], [1.5, 0.5, 0.07], [2, 0.35, 0.05], [2.95, 0.15, 0.02]]);
    tone(o, { dur: 0.1, f0: 220, f1: 130, pTau: 0.02, tau: 0.03, amp: 0.4 });
    return finish(o, 0.8);
  },
  kill: (r) => {
    const o = buf(0.45);
    tone(o, { dur: 0.3, f0: r.jitter(150, 0.04), f1: 55, pTau: 0.05, tau: 0.12, amp: 1 });
    noise(o, r, { dur: 0.1, amp: 0.5, atk: 0.001, tau: 0.04, f: [{ type: 'bp', f: 700, q: 0.9 }] });
    tone(o, { t: 0.02, dur: 0.3, f0: r.jitter(1320, 0.02), tau: 0.08, amp: 0.35, atk: 0.001 });
    tone(o, { t: 0.07, dur: 0.3, f0: r.jitter(1760, 0.02), tau: 0.09, amp: 0.3, atk: 0.001 });
    return finish(o, 0.85);
  },
  hurt: (r) => {
    const o = buf(0.4);
    tone(o, { dur: 0.3, f0: r.jitter(95, 0.05), f1: 50, pTau: 0.05, tau: 0.09, amp: 1 });
    noise(o, r, { dur: 0.1, amp: 0.7, atk: 0.0005, tau: 0.05, f: [{ type: 'lp', f: 900, q: 0.7 }] });
    noise(o, r, { dur: 0.35, amp: 0.5, atk: 0.005, tau: 0.15, f: [{ type: 'lp', f: 3000, f1: 300, fTau: 0.12, q: 0.8 }] });
    return finish(o, 0.9, 1.5);
  },
  heartbeat: (r) => {
    const o = buf(0.6);
    const beat = (t: number, f: number, a: number): void => {
      tone(o, { t, dur: 0.22, f0: f, f1: f * 0.72, pTau: 0.03, tau: 0.06, amp: a, atk: 0.004 });
      noise(o, r, { t, dur: 0.06, amp: a * 0.3, atk: 0.002, tau: 0.02, f: [{ type: 'lp', f: 160, q: 0.7 }] });
    };
    beat(0, r.jitter(62, 0.03), 1);
    beat(0.19, r.jitter(54, 0.03), 0.75);
    return finish(o, 0.9);
  },
  explosion: (r) => {
    const o = buf(1.8);
    noise(o, r, { dur: 0.03, amp: 1, atk: 0.0002, tau: 0.008, f: [{ type: 'hp', f: 1000, q: 0.7 }] });
    noise(o, r, { dur: 1.2, amp: 1, atk: 0.001, tau: 0.25, f: [{ type: 'lp', f: 4500, f1: 200, fTau: 0.3, q: 0.8 }] });
    tone(o, { dur: 1.6, f0: r.jitter(85, 0.05), f1: 28, pTau: 0.25, tau: 0.55, amp: 1.2, atk: 0.002 });
    noise(o, r, { dur: 1.8, amp: 0.8, atk: 0.01, tau: 0.7, color: 'brown', f: [{ type: 'lp', f: 180, q: 0.7 }] });
    grains(o, r, { t: 0.05, dur: 1.6, count: 34, amp: 0.35, gdur: [0.004, 0.02], f: [800, 3500], skew: 1.8, ampTau: 0.9 });
    return finish(o, 0.95, 1.8);
  },
  bounce: (r) => {
    const o = buf(0.35);
    noise(o, r, { dur: 0.008, amp: 0.7, atk: 0.0002, tau: 0.002, f: [{ type: 'bp', f: 3500, q: 1.2 }] });
    tone(o, { dur: 0.1, f0: r.jitter(300, 0.06), f1: 180, pTau: 0.02, tau: 0.02, amp: 0.7 });
    bell(o, 0, r.jitter(1150, 0.08), [[1, 0.35, 0.07], [1.78, 0.2, 0.04], [2.87, 0.1, 0.025]]);
    return finish(o, 0.7);
  },
  pin: (r) => {
    const o = buf(0.3);
    noise(o, r, { dur: 0.006, amp: 0.7, atk: 0.0002, tau: 0.002, f: [{ type: 'bp', f: 3000, q: 1.5 }] });
    bell(o, 0, r.jitter(3200, 0.03), [[1, 0.6, 0.06], [1.5, 0.25, 0.03]]);
    grains(o, r, { t: 0.03, dur: 0.08, count: 5, amp: 0.3, gdur: [0.002, 0.005], f: [2000, 4000], q: 2 });
    return finish(o, 0.6);
  },
  pickup: (r) => {
    const o = buf(0.3);
    const s = r.jitter(1, 0.03);
    tone(o, { dur: 0.18, f0: 740 * s, wave: 'tri', atk: 0.004, tau: 0.07, amp: 0.7 });
    tone(o, { t: 0.07, dur: 0.22, f0: 1110 * s, wave: 'tri', atk: 0.004, tau: 0.09, amp: 0.7 });
    tone(o, { t: 0.07, dur: 0.15, f0: 2220 * s, tau: 0.05, amp: 0.15 });
    return finish(o, 0.7);
  },
  intel: (r) => {
    const o = buf(0.55);
    [587, 740, 880, 1175].forEach((f, i) => tone(o, { t: i * 0.06, dur: 0.4, f0: f, wave: 'tri', atk: 0.004, tau: 0.12, amp: 0.6 }));
    noise(o, r, { dur: 0.15, amp: 0.15, atk: 0.005, tau: 0.05, f: [{ type: 'hp', f: 6000, q: 0.7 }] });
    return finish(o, 0.7);
  },
  plant: (r) => {
    const o = buf(0.6);
    grains(o, r, { dur: 0.15, count: 20, amp: 0.4, gdur: [0.004, 0.01], f: [1800, 3200], q: 1.5 });
    tone(o, { t: 0.18, dur: 0.15, f0: 180, f1: 110, pTau: 0.02, tau: 0.05, amp: 0.8 });
    noise(o, r, { t: 0.18, dur: 0.01, amp: 0.6, atk: 0.0002, tau: 0.002, f: [{ type: 'bp', f: 2200, q: 1.5 }] });
    tone(o, { t: 0.3, dur: 0.12, f0: 1000, wave: 'square', atk: 0.002, tau: 0.1, amp: 0.4 });
    return finish(o, 0.8);
  },
  beep: () => {
    const o = buf(0.14);
    tone(o, { dur: 0.12, f0: 1050, wave: 'square', atk: 0.002, tau: 0.06, amp: 0.8 });
    tone(o, { dur: 0.1, f0: 2100, tau: 0.04, amp: 0.15 });
    return finish(o, 0.7);
  },
  objective: () => {
    const o = buf(0.9);
    bell(o, 0, 784, [[1, 1, 0.25], [2, 0.3, 0.12], [3, 0.1, 0.06]]);
    bell(o, 0.11, 1175, [[1, 1, 0.3], [2, 0.3, 0.14], [3, 0.1, 0.07]]);
    return finish(o, 0.75);
  },
  uiClick: (r) => {
    const o = buf(0.06);
    noise(o, r, { dur: 0.004, amp: 0.5, atk: 0.0001, tau: 0.001, f: [{ type: 'bp', f: 3500, q: 1 }] });
    tone(o, { dur: 0.04, f0: r.jitter(1250, 0.04), f1: 900, pTau: 0.008, tau: 0.012, amp: 0.8, atk: 0.0005 });
    return finish(o, 0.6);
  },
  uiHover: (r) => {
    const o = buf(0.04);
    tone(o, { dur: 0.03, f0: r.jitter(2200, 0.03), tau: 0.006, amp: 0.5, atk: 0.0005 });
    return finish(o, 0.35);
  },
  uiConfirm: (r) => {
    const o = buf(0.3);
    const s = r.jitter(1, 0.015);
    tone(o, { dur: 0.12, f0: 660 * s, atk: 0.003, tau: 0.07, amp: 0.7 });
    tone(o, { t: 0.07, dur: 0.22, f0: 990 * s, atk: 0.003, tau: 0.12, amp: 0.7 });
    tone(o, { t: 0.07, dur: 0.15, f0: 1980 * s, tau: 0.05, amp: 0.1 });
    return finish(o, 0.7);
  },
  uiBack: (r) => {
    const o = buf(0.2);
    tone(o, { dur: 0.16, f0: r.jitter(700, 0.02), f1: 480, pTau: 0.06, tau: 0.06, amp: 0.7, atk: 0.002 });
    noise(o, r, { dur: 0.004, amp: 0.3, atk: 0.0001, tau: 0.001, f: [{ type: 'bp', f: 2500, q: 1 }] });
    return finish(o, 0.65);
  },
  radio: (r) => {
    const o = buf(0.32);
    noise(o, r, { dur: 0.05, amp: 0.8, atk: 0.001, tau: 0.02, f: [{ type: 'bp', f: 1800, q: 0.8 }] });
    tone(o, { t: 0.02, dur: 0.1, f0: r.jitter(1400, 0.06), f1: r.jitter(1900, 0.06), pTau: 0.05, wave: 'square', atk: 0.003, tau: 0.1, amp: 0.35 });
    noise(o, r, { t: 0.06, dur: 0.22, amp: 0.3, atk: 0.01, tau: 0.12, color: 'pink', f: [{ type: 'bp', f: 1600, q: 0.6 }] });
    grains(o, r, { t: 0.06, dur: 0.2, count: 10, amp: 0.3, gdur: [0.002, 0.008], f: [1000, 3000], q: 1 });
    noise(o, r, { t: 0.27, dur: 0.04, amp: 0.5, atk: 0.001, tau: 0.015, f: [{ type: 'bp', f: 1700, q: 0.8 }] });
    sweepFilter(o, { type: 'hp', f: 450, q: 0.7 });
    sweepFilter(o, { type: 'lp', f: 3000, q: 0.9 });
    return finish(o, 0.8, 2.5);
  },
  crack: (r) => {
    // Supersonic bullet snap: a hard broadband transient, a short air "zip", a tiny pop.
    const o = buf(0.16);
    noise(o, r, { dur: 0.006, amp: 1.2, atk: 0.00005, tau: 0.0012, f: [{ type: 'hp', f: r.jitter(2500, 0.1), q: 0.7 }] });
    noise(o, r, { t: 0.0005, dur: 0.02, amp: 0.7, atk: 0.0001, tau: 0.004, f: [{ type: 'bp', f: r.jitter(5000, 0.1), q: 0.6 }] });
    noise(o, r, { dur: 0.07, amp: 0.5, atk: 0.0005, tau: 0.02, f: [{ type: 'bp', f: r.jitter(7000, 0.1), f1: 2500, fTau: 0.03, q: 1.5 }] });
    tone(o, { dur: 0.05, f0: r.jitter(900, 0.08), f1: 450, pTau: 0.01, tau: 0.012, amp: 0.35, atk: 0.0003 });
    noise(o, r, { t: 0.008, dur: 0.1, amp: 0.12, tau: 0.03, f: [{ type: 'bp', f: 3000, q: 0.8 }] });
    return finish(o, 0.95, 1.4);
  },
  ricochet: (r) => {
    const o = buf(0.5);
    noise(o, r, { dur: 0.02, amp: 0.6, atk: 0.0002, tau: 0.006, f: [{ type: 'bp', f: 3000, q: 1 }] });
    const s = r.jitter(1, 0.15);
    tone(o, { dur: 0.4, f0: 2600 * s, f1: 1100 * s, pTau: 0.09, tau: 0.12, amp: 0.5, vib: [40, 0.03], atk: 0.001 });
    tone(o, { dur: 0.3, f0: 3900 * s, f1: 1700 * s, pTau: 0.09, tau: 0.08, amp: 0.2, atk: 0.001 });
    return finish(o, 0.75);
  },
  impactFlesh: (r) => {
    const o = buf(0.16);
    tone(o, { dur: 0.1, f0: r.jitter(130, 0.06), f1: 70, pTau: 0.02, tau: 0.03, amp: 0.8 });
    noise(o, r, { dur: 0.08, amp: 0.8, atk: 0.001, tau: 0.025, f: [{ type: 'lp', f: r.jitter(900, 0.1), q: 0.7 }] });
    noise(o, r, { dur: 0.03, amp: 0.3, tau: 0.008, f: [{ type: 'bp', f: 1800, q: 1 }] });
    return finish(o, 0.8);
  },
  impactWood: (r) => {
    const o = buf(0.22);
    tone(o, { dur: 0.15, f0: r.jitter(260, 0.06), f1: 170, pTau: 0.02, tau: 0.04, amp: 0.8 });
    noise(o, r, { dur: 0.1, amp: 0.6, tau: 0.03, f: [{ type: 'bp', f: r.jitter(700, 0.1), q: 1.2 }] });
    grains(o, r, { dur: 0.06, count: 4, amp: 0.25, gdur: [0.002, 0.006], f: [2000, 4000], q: 1.5 });
    tone(o, { dur: 0.1, f0: r.jitter(420, 0.05), tau: 0.03, amp: 0.2 });
    return finish(o, 0.8);
  },
  impactMetal: (r) => {
    const o = buf(0.5);
    noise(o, r, { dur: 0.01, amp: 0.7, atk: 0.0002, tau: 0.003, f: [{ type: 'bp', f: 3500, q: 1 }] });
    bell(o, 0, r.jitter(1100, 0.1), [[1, 0.5, 0.12], [1.52, 0.4, 0.09], [2.35, 0.3, 0.06], [3.6, 0.15, 0.04]]);
    noise(o, r, { dur: 0.06, amp: 0.2, tau: 0.02, f: [{ type: 'bp', f: 5000, q: 2 }] });
    return finish(o, 0.75);
  },
  impactStone: (r) => {
    const o = buf(0.25);
    noise(o, r, { dur: 0.05, amp: 1, tau: 0.01, f: [{ type: 'bp', f: r.jitter(2500, 0.1), q: 0.8 }] });
    tone(o, { dur: 0.05, f0: r.jitter(1400, 0.06), f1: 900, pTau: 0.02, tau: 0.012, amp: 0.3 });
    tone(o, { dur: 0.1, f0: 200, f1: 110, pTau: 0.02, tau: 0.03, amp: 0.35 });
    grains(o, r, { t: 0.01, dur: 0.12, count: 8, amp: 0.35, gdur: [0.003, 0.008], f: [2000, 5000], q: 1.2, skew: 1.3 });
    return finish(o, 0.8);
  },
  impactDirt: (r) => {
    const o = buf(0.25);
    tone(o, { dur: 0.1, f0: r.jitter(110, 0.06), f1: 60, pTau: 0.025, tau: 0.04, amp: 0.6 });
    noise(o, r, { dur: 0.12, amp: 0.7, atk: 0.002, tau: 0.05, f: [{ type: 'lp', f: 700, q: 0.7 }] });
    grains(o, r, { t: 0.01, dur: 0.15, count: 8, amp: 0.3, gdur: [0.003, 0.009], f: [1200, 2800], type: 'lp', q: 0.7, skew: 1.2 });
    return finish(o, 0.75);
  },
  break: (r) => {
    const o = buf(0.6);
    noise(o, r, { dur: 0.05, amp: 1, tau: 0.015, f: [{ type: 'bp', f: 900, q: 0.7 }] });
    grains(o, r, { dur: 0.45, count: 22, amp: 0.6, gdur: [0.004, 0.012], f: [500, 2500], q: 1, skew: 1.4, ampTau: 0.3 });
    tone(o, { dur: 0.2, f0: 140, f1: 80, pTau: 0.03, tau: 0.05, amp: 0.7 });
    tone(o, { t: 0.18, dur: 0.15, f0: 110, f1: 70, pTau: 0.03, tau: 0.04, amp: 0.4 });
    noise(o, r, { dur: 0.35, amp: 0.3, tau: 0.12, f: [{ type: 'lp', f: 400, q: 0.7 }] });
    return finish(o, 0.85);
  },
  glass: (r) => {
    const o = buf(0.9);
    noise(o, r, { dur: 0.02, amp: 0.9, atk: 0.0002, tau: 0.006, f: [{ type: 'hp', f: 2000, q: 0.7 }] });
    grains(o, r, { t: 0.01, dur: 0.7, count: 30, amp: 0.5, gdur: [0.006, 0.02], f: [3000, 9000], q: 4, skew: 1.6, ampTau: 0.35 });
    for (let i = 0; i < 8; i++) {
      tone(o, { t: r.range(0.03, 0.5), dur: 0.3, f0: r.range(3000, 7500), tau: r.range(0.06, 0.15), amp: r.range(0.12, 0.25), atk: 0.0005 });
    }
    return finish(o, 0.8);
  },
  levelUp: () => {
    const o = buf(1.4);
    [523, 659, 784, 1047].forEach((f, i) => {
      tone(o, { t: i * 0.09, dur: 0.8, f0: f, wave: 'tri', atk: 0.004, tau: 0.35, amp: 0.6 });
      tone(o, { t: i * 0.09, dur: 0.5, f0: f * 2, atk: 0.004, tau: 0.2, amp: 0.2 });
    });
    [523, 659, 784, 1047].forEach((f) => tone(o, { t: 0.36, dur: 1.0, f0: f, atk: 0.01, tau: 0.5, amp: 0.3 }));
    return finish(o, 0.8);
  },
  star: () => {
    const o = buf(0.8);
    bell(o, 0, 1568, [[1, 1, 0.35], [2.76, 0.35, 0.18], [5.4, 0.15, 0.08]]);
    tone(o, { dur: 0.1, f0: 3136, tau: 0.03, amp: 0.15 });
    return finish(o, 0.7);
  },
  medal: (r) => {
    const o = buf(1.2);
    bell(o, 0, 880, [[1, 1, 0.5], [2, 0.4, 0.3], [2.76, 0.3, 0.2], [4.07, 0.15, 0.1]]);
    bell(o, 0.15, 1318, [[1, 0.8, 0.5], [2, 0.3, 0.25], [2.76, 0.2, 0.15]]);
    tone(o, { dur: 0.25, f0: 600, f1: 1200, pTau: 0.1, tau: 0.12, amp: 0.12, atk: 0.02 });
    grains(o, r, { t: 0.1, dur: 0.6, count: 14, amp: 0.15, gdur: [0.003, 0.01], f: [6000, 10000], type: 'hp', q: 0.7, ampTau: 0.3 });
    return finish(o, 0.8);
  },
  countdown: () => {
    const o = buf(0.2);
    tone(o, { dur: 0.16, f0: 880, atk: 0.002, tau: 0.07, amp: 0.8 });
    tone(o, { dur: 0.12, f0: 1760, tau: 0.04, amp: 0.15 });
    return finish(o, 0.7);
  },
  win: () => {
    const o = buf(2.0);
    [523, 659, 784, 1047, 1319].forEach((f, i) => {
      tone(o, { t: i * 0.12, dur: 0.9, f0: f, wave: 'tri', atk: 0.004, tau: 0.5, amp: 0.5 });
      tone(o, { t: i * 0.12, dur: 0.6, f0: f * 2, atk: 0.004, tau: 0.2, amp: 0.15 });
    });
    [523, 784, 1047, 1319].forEach((f) => tone(o, { t: 0.6, dur: 1.4, f0: f, wave: 'tri', atk: 0.02, tau: 0.6, amp: 0.3 }));
    tone(o, { t: 0.6, dur: 1.4, f0: 262, atk: 0.02, tau: 0.6, amp: 0.4 });
    return finish(o, 0.8);
  },
  lose: () => {
    const o = buf(1.8);
    [392, 349, 311, 262].forEach((f, i) => {
      tone(o, { t: i * 0.35, dur: 0.9, f0: f, wave: 'saw', atk: 0.01, tau: 0.25, amp: 0.4 });
      tone(o, { t: i * 0.35, dur: 0.9, f0: f * 1.006, wave: 'saw', atk: 0.01, tau: 0.25, amp: 0.3 });
    });
    tone(o, { t: 1.05, dur: 0.7, f0: 65, f1: 45, pTau: 0.3, tau: 0.35, amp: 0.7, atk: 0.01 });
    sweepFilter(o, { type: 'lp', f: 1100, q: 0.8 });
    return finish(o, 0.75);
  },
  laser: () => {
    const o = buf(0.9);
    tone(o, { dur: 0.9, f0: 900, f1: 2600, pTau: 0.4, tau: 2, atk: 0.6, vib: [6, 0.01], amp: 1 });
    tone(o, { dur: 0.9, f0: 1350, f1: 3900, pTau: 0.4, tau: 2, atk: 0.6, amp: 0.3 });
    return finish(o, 0.5);
  },
  alert: () => {
    const o = buf(0.4);
    tone(o, { dur: 0.12, f0: 880, wave: 'square', atk: 0.003, tau: 0.08, amp: 0.6 });
    tone(o, { t: 0.13, dur: 0.16, f0: 1175, wave: 'square', atk: 0.003, tau: 0.1, amp: 0.6 });
    sweepFilter(o, { type: 'lp', f: 3000, q: 0.8 });
    return finish(o, 0.7);
  },
  wave: (r) => {
    const o = buf(1.6);
    tone(o, { dur: 1.5, f0: 110, wave: 'saw', atk: 0.4, tau: 1.2, amp: 0.5 });
    tone(o, { dur: 1.5, f0: 110.7, wave: 'saw', atk: 0.4, tau: 1.2, amp: 0.5 });
    tone(o, { dur: 1.5, f0: 165, wave: 'saw', atk: 0.4, tau: 1.2, amp: 0.3 });
    noise(o, r, { dur: 1.5, amp: 0.4, atk: 0.3, tau: 1, color: 'brown', f: [{ type: 'lp', f: 200, q: 0.7 }] });
    sweepFilter(o, { type: 'lp', f: 300, f1: 1500, fTau: 0.6, q: 1.2 });
    tone(o, { t: 0.4, dur: 0.6, f0: 60, f1: 35, pTau: 0.15, tau: 0.25, amp: 0.8 });
    return finish(o, 0.8);
  },
};

// ---------------------------------------------------------------------------------------------
// Music percussion one-shots
// ---------------------------------------------------------------------------------------------

const kick: Recipe = (r) => {
  const o = buf(0.3);
  tone(o, { dur: 0.28, f0: r.jitter(140, 0.02), f1: 45, pTau: 0.03, tau: 0.11, amp: 1, atk: 0.001 });
  noise(o, r, { dur: 0.02, amp: 0.3, atk: 0.0005, tau: 0.004, f: [{ type: 'bp', f: 2000, q: 1 }] });
  return finish(o, 0.9, 1.6);
};

const hat = (open: boolean): Recipe => (r) => {
  const o = buf(open ? 0.22 : 0.07);
  noise(o, r, { dur: open ? 0.2 : 0.06, amp: 1, atk: 0.0005, tau: open ? 0.07 : 0.012, f: [{ type: 'hp', f: 7000, q: 0.7 }] });
  return finish(o, 0.7);
};

const rim: Recipe = (r) => {
  const o = buf(0.16);
  noise(o, r, { dur: 0.14, amp: 1, atk: 0.0005, tau: 0.05, f: [{ type: 'bp', f: 1800, q: 0.7 }] });
  tone(o, { dur: 0.1, f0: 190, f1: 150, pTau: 0.03, tau: 0.04, amp: 0.5 });
  return finish(o, 0.8);
};

// ---------------------------------------------------------------------------------------------
// Bank
// ---------------------------------------------------------------------------------------------

/** Dark or tonal effects are rendered at a reduced rate (cheaper; the AudioContext resamples on playback). */
const EFFECT_RATE: Partial<Record<Exclude<SfxId, 'step'>, number>> = {
  explosion: SR_MID, win: SR_MID, levelUp: SR_MID, medal: SR_MID, star: SR_MID, intel: SR_MID, objective: SR_MID, slide: SR_MID,
  jump: SR_LOW, land: SR_LOW, hurt: SR_LOW, heartbeat: SR_LOW, wave: SR_LOW, lose: SR_LOW, laser: SR_LOW,
};

export const AMBIENCE_BEDS = ['wind', 'market', 'birds', 'harbor', 'storm', 'hum'] as const;
export const AMBIENCE_EVENTS = ['chirp', 'horn', 'thunder', 'clink', 'crackle'] as const;
const BED_RATE: Record<(typeof AMBIENCE_BEDS)[number], number> = { wind: SR_MID, market: SR_MID, birds: SR_MID, harbor: SR_LOW, storm: SR_MID, hum: 12000 };
const EVENT_VARIANTS: Record<(typeof AMBIENCE_EVENTS)[number], number> = { chirp: 4, horn: 2, thunder: 2, clink: 3, crackle: 3 };
const GUN_KINDS: WeaponClass[] = ['rifle', 'pistol', 'smg', 'shotgun', 'dmr', 'lmg', 'sniper', 'launcher'];

function buildBank(): BankEntry[] {
  const bank: BankEntry[] = [];
  const add = (key: string, variants: number, render: Recipe, sr = SR, lazy = false): void => {
    bank.push({ key, variants, sr, lazy, render });
  };
  // Pre-render order = priority: interface and hit feedback first, then movement, then guns.
  const early: EffectId[] = ['uiClick', 'uiHover', 'uiConfirm', 'uiBack', 'hitmarker', 'headshot', 'kill', 'crack', 'hurt'];
  for (const id of early) add(`sfx:${id}`, SFX_DEFS[id].variants, effects[id]);
  for (const g of STEP_GROUPS) add(`step:${g}`, SFX_DEFS.step.variants, stepRecipes[g], SR_MID);
  for (const k of GUN_KINDS) {
    add(`gun:${k}:body`, 3, (r) => gunBody(k, r));
  }
  add('gun:punch', 2, gunPunch);
  add('gun:suppressed', 3, gunSuppressed);
  for (const k of GUN_KINDS) add(`gun:${k}:tail`, 2, (r) => gunTail(k, r), SR_LOW);
  add('mus:kick', 1, kick);
  add('mus:hat', 1, hat(false));
  add('mus:hatOpen', 1, hat(true));
  add('mus:rim', 1, rim);
  for (const id of Object.keys(effects) as EffectId[]) {
    if (early.includes(id)) continue;
    add(`sfx:${id}`, SFX_DEFS[id].variants, effects[id], EFFECT_RATE[id] ?? SR);
  }
  for (const b of AMBIENCE_BEDS) add(`amb:bed:${b}`, 1, (r) => renderBed(b, r, BED_RATE[b]), BED_RATE[b], true);
  for (const e of AMBIENCE_EVENTS) add(`amb:${e}`, EVENT_VARIANTS[e], (r, v) => renderAmbienceEvent(e, r, v, SR), SR, true);
  return bank;
}

export const BANK: readonly BankEntry[] = buildBank();
export const BANK_INDEX: ReadonlyMap<string, BankEntry> = new Map(BANK.map((e) => [e.key, e]));

/** Render one variation of a bank entry, deterministically (seeded from key + variant). */
export function renderEntry(e: BankEntry, variant: number): Float32Array {
  const prev = rate.sr;
  rate.sr = e.sr;
  try {
    return e.render(new Rand(hashSeed(e.key, variant)), variant);
  } finally {
    rate.sr = prev;
  }
}
