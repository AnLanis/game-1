/**
 * Ambience beds: one looping procedural texture per biome, cross-faded on change, with sporadic
 * one-shot events on top (bird calls, ship horn, thunder, clinks, electrical crackle).
 */

import type { Rand } from './dsp';
import type { SoundBank } from './bank';
import type { AmbienceKind } from './types';

const BED_LEVEL: Record<Exclude<AmbienceKind, 'none'>, number> = {
  wind: 0.3,
  market: 0.32,
  birds: 0.18,
  harbor: 0.32,
  storm: 0.45,
  hum: 0.25,
};

interface EventPlan {
  key: string;
  /** Seconds between events [min, max]. */
  every: [number, number];
  /** Delay before the first event. */
  first: [number, number];
  gain: [number, number];
  rate: [number, number];
  pan: number;
}

const EVENTS: Partial<Record<AmbienceKind, EventPlan>> = {
  birds: { key: 'amb:chirp', every: [0.7, 3.8], first: [0.5, 2], gain: [0.18, 0.32], rate: [0.85, 1.35], pan: 0.9 },
  harbor: { key: 'amb:horn', every: [30, 70], first: [8, 20], gain: [0.2, 0.26], rate: [0.95, 1.05], pan: 0.6 },
  storm: { key: 'amb:thunder', every: [8, 24], first: [3, 9], gain: [0.4, 0.6], rate: [0.8, 1.1], pan: 0.5 },
  market: { key: 'amb:clink', every: [4, 12], first: [2, 6], gain: [0.08, 0.16], rate: [0.9, 1.15], pan: 0.9 },
  hum: { key: 'amb:crackle', every: [3, 10], first: [2, 6], gain: [0.08, 0.14], rate: [0.9, 1.1], pan: 0.7 },
};

interface Bed {
  src: AudioBufferSourceNode;
  gain: GainNode;
}

export class Ambience {
  private readonly bus: GainNode;
  private kind: AmbienceKind = 'none';
  private cur: Bed | null = null;
  private readonly old: Array<{ bed: Bed; until: number }> = [];
  private nextEvent = Infinity;
  private liveEvents = 0;

  constructor(
    private readonly ctx: AudioContext,
    out: AudioNode,
    private readonly bank: SoundBank,
    private readonly rnd: Rand,
  ) {
    this.bus = ctx.createGain();
    this.bus.connect(out);
  }

  set(kind: AmbienceKind): void {
    if (kind === this.kind) return;
    this.kind = kind;
    const t = this.ctx.currentTime;
    if (this.cur) {
      this.cur.gain.gain.setTargetAtTime(0, t, 0.5);
      this.old.push({ bed: this.cur, until: t + 3 });
      this.cur = null;
    }
    this.nextEvent = Infinity;
    if (kind === 'none') return;
    const buffer = this.bank.get(`amb:bed:${kind}`, 0);
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.setTargetAtTime(BED_LEVEL[kind], t, 0.7);
    src.connect(gain);
    gain.connect(this.bus);
    src.start(0, this.rnd.next() * buffer.duration);
    this.cur = { src, gain };
    const plan = EVENTS[kind];
    if (plan) this.nextEvent = t + this.rnd.range(plan.first[0], plan.first[1]);
  }

  update(): void {
    const t = this.ctx.currentTime;
    for (let i = this.old.length - 1; i >= 0; i--) {
      if (t < this.old[i].until) continue;
      this.killBed(this.old[i].bed);
      this.old.splice(i, 1);
    }
    if (this.kind === 'none' || t < this.nextEvent) return;
    const plan = EVENTS[this.kind];
    if (!plan) return;
    this.nextEvent = t + this.rnd.range(plan.every[0], plan.every[1]);
    if (this.liveEvents >= 4) return;
    this.fire(plan, t);
  }

  dispose(): void {
    if (this.cur) this.killBed(this.cur);
    for (const o of this.old) this.killBed(o.bed);
    this.old.length = 0;
    this.cur = null;
    try {
      this.bus.disconnect();
    } catch {
      /* already disconnected */
    }
  }

  private fire(plan: EventPlan, t: number): void {
    const variants = this.bank.variants(plan.key);
    const buffer = this.bank.get(plan.key, Math.floor(this.rnd.next() * variants));
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = this.rnd.range(plan.rate[0], plan.rate[1]);
    const gain = this.ctx.createGain();
    gain.gain.value = this.rnd.range(plan.gain[0], plan.gain[1]);
    src.connect(gain);
    let tail: AudioNode = gain;
    let pan: StereoPannerNode | null = null;
    if (typeof this.ctx.createStereoPanner === 'function') {
      pan = this.ctx.createStereoPanner();
      pan.pan.value = this.rnd.signed() * plan.pan;
      gain.connect(pan);
      tail = pan;
    }
    tail.connect(this.bus);
    this.liveEvents++;
    src.onended = (): void => {
      this.liveEvents = Math.max(0, this.liveEvents - 1);
      try {
        src.disconnect();
        gain.disconnect();
        pan?.disconnect();
      } catch {
        /* already disconnected */
      }
    };
    src.start(t);
  }

  private killBed(b: Bed): void {
    try {
      b.src.stop();
    } catch {
      /* not started or already stopped */
    }
    try {
      b.src.disconnect();
      b.gain.disconnect();
    } catch {
      /* already disconnected */
    }
  }
}
