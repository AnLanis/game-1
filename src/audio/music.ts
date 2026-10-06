/**
 * Adaptive procedural music. 'menu' is a slow warm pad (detuned saws through a drifting low-pass)
 * over a sub bass with the odd soft bell; 'combat' keeps a darker pad and adds a ~100 bpm
 * percussion / pulse layer whose level and density follow the smoothed intensity.
 * Everything is scheduled against AudioContext time with a short lookahead.
 */

import type { Rand } from './dsp';
import type { SoundBank } from './bank';
import type { MusicTrack } from './types';

const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

interface Chord {
  bass: number;
  notes: number[];
}

interface TrackDef {
  bpm: number;
  chords: Chord[];
  padCutoff: number;
  padGain: number;
  attack: number;
  release: number;
}

/** 16th-note steps per chord (two bars of 4/4). */
const CHORD_STEPS = 32;
const LOOKAHEAD = 0.45;

const MENU: TrackDef = {
  bpm: 60,
  chords: [
    { bass: 33, notes: [52, 55, 60, 64] }, // Am7
    { bass: 29, notes: [53, 57, 60, 64] }, // Fmaj7
    { bass: 36, notes: [52, 55, 59, 62] }, // Cmaj9
    { bass: 31, notes: [50, 55, 59, 64] }, // G6/9
  ],
  padCutoff: 950,
  padGain: 0.06,
  attack: 1.8,
  release: 2.4,
};

const COMBAT: TrackDef = {
  bpm: 100,
  chords: [
    { bass: 33, notes: [52, 57, 60, 64] }, // Am
    { bass: 29, notes: [53, 57, 60, 65] }, // F
    { bass: 38, notes: [50, 57, 62, 65] }, // Dm
    { bass: 28, notes: [52, 56, 59, 64] }, // E
  ],
  padCutoff: 650,
  padGain: 0.055,
  attack: 1.0,
  release: 1.8,
};

interface Run {
  kind: 'menu' | 'combat';
  def: TrackDef;
  group: GainNode;
  padLP: BiquadFilterNode;
  percGain: GainNode;
  bassLP: BiquadFilterNode;
  echo: DelayNode | null;
  nodes: AudioNode[];
  oscs: Set<OscillatorNode>;
  stepDur: number;
  nextTime: number;
  step: number;
  stopAt: number;
}

export class MusicPlayer {
  private run: Run | null = null;
  private readonly fading: Run[] = [];
  private track: MusicTrack = 'none';
  private target = 0;
  private smooth = 0;
  private acc = 0;

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
    private readonly bank: SoundBank,
    private readonly rnd: Rand,
  ) {}

  setTrack(t: MusicTrack): void {
    if (t === this.track) return;
    this.track = t;
    const now = this.ctx.currentTime;
    if (this.run) {
      this.run.group.gain.cancelScheduledValues(now);
      this.run.group.gain.setTargetAtTime(0, now, 0.6);
      this.run.stopAt = now + 3.5;
      this.fading.push(this.run);
      this.run = null;
    }
    if (t !== 'none') this.run = this.start(t);
  }

  setIntensity(v: number): void {
    this.target = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
  }

  /** Per-frame: smooth intensity, retune the layer levels, schedule ahead, retire faded tracks. */
  update(dt: number): void {
    const k = 1 - Math.exp(-Math.max(0, dt) / (this.target > this.smooth ? 0.6 : 3));
    this.smooth += (this.target - this.smooth) * k;
    this.acc += dt;
    if (this.run && this.acc >= 0.1) {
      this.acc = 0;
      const now = this.ctx.currentTime;
      const run = this.run;
      if (run.kind === 'combat') {
        run.percGain.gain.setTargetAtTime(this.smooth < 0.04 ? 0 : 0.25 + 0.75 * this.smooth, now, 0.3);
        run.padLP.frequency.setTargetAtTime(run.def.padCutoff * (0.9 + 0.9 * this.smooth), now, 0.6);
      }
    }
    this.tick();
  }

  /** Scheduling only — also driven by a timer so audio keeps flowing when frames stall. */
  tick(): void {
    const now = this.ctx.currentTime;
    for (let i = this.fading.length - 1; i >= 0; i--) {
      if (now < this.fading[i].stopAt) continue;
      this.kill(this.fading[i]);
      this.fading.splice(i, 1);
    }
    const run = this.run;
    if (!run) return;
    if (run.nextTime < now - 0.05) run.nextTime = now + 0.05;
    const until = now + LOOKAHEAD;
    while (run.nextTime < until) {
      this.scheduleStep(run, run.nextTime, run.step);
      run.nextTime += run.stepDur;
      run.step++;
    }
  }

  dispose(): void {
    if (this.run) this.kill(this.run);
    for (const r of this.fading) this.kill(r);
    this.run = null;
    this.fading.length = 0;
  }

  // -------------------------------------------------------------------------------------------

  private start(kind: 'menu' | 'combat'): Run {
    const ctx = this.ctx;
    const def = kind === 'menu' ? MENU : COMBAT;
    const now = ctx.currentTime;
    const nodes: AudioNode[] = [];
    const oscs = new Set<OscillatorNode>();
    const mk = <T extends AudioNode>(n: T): T => {
      nodes.push(n);
      return n;
    };

    const group = mk(ctx.createGain());
    group.gain.setValueAtTime(0, now);
    group.gain.setTargetAtTime(1, now + 0.05, 0.9);
    group.connect(this.out);

    const padLP = mk(ctx.createBiquadFilter());
    padLP.type = 'lowpass';
    padLP.frequency.value = def.padCutoff;
    padLP.Q.value = 0.5;
    padLP.connect(group);

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = mk(ctx.createGain());
    lfoGain.gain.value = def.padCutoff * 0.3;
    lfo.connect(lfoGain);
    lfoGain.connect(padLP.frequency);
    lfo.start(now);
    oscs.add(lfo);

    const percGain = mk(ctx.createGain());
    percGain.gain.value = 0;
    percGain.connect(group);

    const bassLP = mk(ctx.createBiquadFilter());
    bassLP.type = 'lowpass';
    bassLP.frequency.value = 420;
    bassLP.Q.value = 0.8;
    bassLP.connect(percGain);

    let echo: DelayNode | null = null;
    if (kind === 'menu') {
      echo = mk(ctx.createDelay(1));
      echo.delayTime.value = 0.75;
      const fb = mk(ctx.createGain());
      fb.gain.value = 0.38;
      const damp = mk(ctx.createBiquadFilter());
      damp.type = 'lowpass';
      damp.frequency.value = 1800;
      echo.connect(damp);
      damp.connect(fb);
      fb.connect(echo);
      damp.connect(group);
    }

    return {
      kind,
      def,
      group,
      padLP,
      percGain,
      bassLP,
      echo,
      nodes,
      oscs,
      stepDur: 60 / def.bpm / 4,
      nextTime: now + 0.1,
      step: 0,
      stopAt: Infinity,
    };
  }

  private kill(run: Run): void {
    for (const o of run.oscs) {
      try {
        o.stop();
      } catch {
        /* not started or already stopped */
      }
    }
    run.oscs.clear();
    for (const n of run.nodes) {
      try {
        n.disconnect();
      } catch {
        /* already disconnected */
      }
    }
  }

  private scheduleStep(run: Run, t: number, step: number): void {
    if (step % CHORD_STEPS === 0) this.startChord(run, t, (step / CHORD_STEPS) % run.def.chords.length);
    const s16 = step % 16;
    const chord = run.def.chords[Math.floor(step / CHORD_STEPS) % run.def.chords.length];
    if (run.kind === 'menu') {
      // A soft bell on the odd bar-half, sparsely, so the pad never feels static.
      if (s16 % 8 === 0 && step > 0 && this.rnd.next() < 0.4) {
        const note = chord.notes[Math.floor(this.rnd.next() * chord.notes.length)] + 12;
        this.bell(run, t, note, 0.05);
      }
      return;
    }
    const I = this.smooth;
    // Kick: 1 and 3, with pickups as intensity climbs.
    if (s16 === 0 && I > 0.08) this.sample(run, 'mus:kick', t, 0.9);
    else if (s16 === 8 && I > 0.2) this.sample(run, 'mus:kick', t, 0.8);
    else if (s16 === 10 && I > 0.65) this.sample(run, 'mus:kick', t, 0.5);
    else if (s16 === 14 && I > 0.8) this.sample(run, 'mus:kick', t, 0.45);
    // Rim on 2 and 4.
    if ((s16 === 4 || s16 === 12) && I > 0.4) this.sample(run, 'mus:rim', t, 0.25 + 0.2 * I);
    // Hats: 8ths (off-beats accented), 16ths at the top end.
    if (s16 % 2 === 0 && I > 0.25) {
      const offbeat = s16 % 4 === 2;
      this.sample(run, offbeat && s16 === 14 && I > 0.6 ? 'mus:hatOpen' : 'mus:hat', t, (offbeat ? 0.2 : 0.12) * (0.8 + 0.4 * this.rnd.next()));
    } else if (s16 % 2 === 1 && I > 0.75) {
      this.sample(run, 'mus:hat', t, 0.07 * (0.8 + 0.4 * this.rnd.next()));
    }
    // Pulsing bass on the 8ths.
    if (s16 % 2 === 0 && I > 0.45) this.pulse(run, t, chord.bass + (s16 % 8 === 6 ? 24 : 12), 0.5);
  }

  private startChord(run: Run, t: number, ci: number): void {
    const ctx = this.ctx;
    const def = run.def;
    const chord = def.chords[ci];
    const dur = CHORD_STEPS * run.stepDur;
    const end = t + dur + def.release + 0.1;

    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0, t);
    cg.gain.linearRampToValueAtTime(def.padGain, t + def.attack);
    cg.gain.setValueAtTime(def.padGain, t + dur);
    cg.gain.linearRampToValueAtTime(0, t + dur + def.release);
    cg.connect(run.padLP);
    run.nodes.push(cg);

    const pans: Array<StereoPannerNode | null> = [null, null];
    if (typeof ctx.createStereoPanner === 'function') {
      for (let i = 0; i < 2; i++) {
        const p = ctx.createStereoPanner();
        p.pan.value = i === 0 ? -0.55 : 0.55;
        p.connect(cg);
        pans[i] = p;
        run.nodes.push(p);
      }
    }

    let last: OscillatorNode | null = null;
    for (const n of chord.notes) {
      for (let side = 0; side < 2; side++) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(n);
        o.detune.value = (side === 0 ? -7 : 7) + this.rnd.signed() * 2;
        o.connect(pans[side] ?? cg);
        o.start(t);
        o.stop(end);
        run.oscs.add(o);
        last = o;
      }
    }
    // Sub: sine plus a quiet triangle an octave up so it survives small speakers.
    const sub = ctx.createGain();
    sub.gain.value = 2.4;
    sub.connect(cg);
    run.nodes.push(sub);
    for (const [type, midi, amp] of [['sine', chord.bass, 1], ['triangle', chord.bass + 12, 0.25]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = mtof(midi);
      const g = ctx.createGain();
      g.gain.value = amp;
      o.connect(g);
      g.connect(sub);
      run.nodes.push(g);
      o.start(t);
      o.stop(end);
      run.oscs.add(o);
      last = o;
    }
    if (last) {
      const nodes = [cg, sub, ...(pans.filter(Boolean) as StereoPannerNode[])];
      const oscs = run.oscs;
      const finish = last;
      finish.onended = (): void => {
        for (const n of nodes) {
          try {
            n.disconnect();
          } catch {
            /* already disconnected */
          }
        }
        oscs.delete(finish);
      };
    }
  }

  private sample(run: Run, key: string, t: number, vel: number): void {
    const b = this.bank.get(key, 0);
    if (!b) return;
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = 1 + this.rnd.signed() * 0.03;
    const g = this.ctx.createGain();
    g.gain.value = vel;
    src.connect(g);
    g.connect(run.percGain);
    src.onended = (): void => {
      try {
        src.disconnect();
        g.disconnect();
      } catch {
        /* already disconnected */
      }
    };
    src.start(t);
  }

  private pulse(run: Run, t: number, midi: number, vel: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = mtof(midi);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel * 0.5, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g);
    g.connect(run.bassLP);
    o.onended = (): void => {
      try {
        o.disconnect();
        g.disconnect();
      } catch {
        /* already disconnected */
      }
    };
    o.start(t);
    o.stop(t + 0.25);
  }

  private bell(run: Run, t: number, midi: number, vel: number): void {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 2.6);
    g.connect(run.group);
    if (run.echo) g.connect(run.echo);
    const oscs: OscillatorNode[] = [];
    for (const [type, mul, amp] of [['sine', 1, 1], ['sine', 2.005, 0.25]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = mtof(midi) * mul;
      const og = ctx.createGain();
      og.gain.value = amp;
      o.connect(og);
      og.connect(g);
      o.start(t);
      o.stop(t + 2.7);
      oscs.push(o);
    }
    oscs[0].onended = (): void => {
      try {
        g.disconnect();
      } catch {
        /* already disconnected */
      }
    };
  }
}
