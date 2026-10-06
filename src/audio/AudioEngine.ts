/**
 * Dusty Duty audio engine — everything is synthesised, nothing is loaded.
 *
 * Graph:
 *   voices ─┬─(dry)──▶ sfx bus ─▶ muffle low-pass ─┐
 *           └─(send)─▶ reverb ───▶ sfx bus         ├▶ master gain ▶ compressor ▶ out
 *   ambience ────────▶ sfx bus                     │
 *   ui voices ───────▶ ui bus ─────────────────────┤
 *   music ───────────▶ music bus ──────────────────┘
 *
 * Every public method is a safe no-op without Web Audio (Node, tests, old browsers) and never
 * throws: audio must not be able to take the game down.
 */

import type { WeaponClass, GunAudioProfile } from '../content/types';
import { Ambience } from './ambience';
import { SoundBank } from './bank';
import { Rand } from './dsp';
import { MusicPlayer } from './music';
import { ReverbBus } from './reverb';
import { SFX_DEFS, stepGroupForSurface } from './sfxdefs';
import type { AmbienceKind, MusicTrack, PlayOpts, ReverbKind, SfxId, Vec3Like, Volumes } from './types';

export type { AmbienceKind, MusicTrack, PlayOpts, ReverbKind, SfxId, Vec3Like, Volumes } from './types';

// ---------------------------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------------------------

const MAX_VOICES = 24;
const MAX_VOICES_MOBILE = 14;
const HRTF_MAX = 4;
const HRTF_MAX_MOBILE = 2;
/** Sounds farther than this are not played at all. */
const CULL_DISTANCE = 90;
const SPEED_OF_SOUND = 343;
const MAX_SOUND_DELAY = 0.25;
const REF_DISTANCE = 3;
const ROLLOFF = 1.2;
/** Concurrent gunshot voices (a full-auto crowd would otherwise eat the pool). */
const MAX_GUN_VOICES = 10;
/** The music bus is trimmed so `music: 1` is still an under-the-mix bed. */
const MUSIC_TRIM = 0.5;

const DEFAULT_VOLUMES: Volumes = { master: 0.85, sfx: 1, music: 0.35, ui: 1 };

/** Pitch of the own-gun low-end layer per weapon class. */
const PUNCH_RATE: Record<WeaponClass, number> = { rifle: 1, smg: 1.25, shotgun: 0.8, pistol: 1.15, dmr: 0.9, lmg: 0.95, sniper: 0.75, launcher: 0.6 };
/** Weapons that carry (cull further, sound bigger). */
const LOUD_KINDS: ReadonlySet<string> = new Set(['sniper', 'launcher', 'dmr', 'shotgun']);

// ---------------------------------------------------------------------------------------------
// Environment sniffing (all guarded: this module must import cleanly under Node)
// ---------------------------------------------------------------------------------------------

interface NavLike {
  userAgent?: string;
  maxTouchPoints?: number;
  userAgentData?: { mobile?: boolean };
}

interface AudioGlobals {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
  navigator?: NavLike;
  document?: { hidden?: boolean };
}

function globals(): AudioGlobals {
  return globalThis as unknown as AudioGlobals;
}

function contextCtor(): typeof AudioContext | null {
  const g = globals();
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

function looksMobile(): boolean {
  try {
    const n = globals().navigator;
    if (!n) return false;
    if (n.userAgentData?.mobile === true) return true;
    const ua = String(n.userAgent ?? '');
    if (/Android|iPhone|iPad|iPod|Mobile|Silk/i.test(ua)) return true;
    // iPadOS reports a desktop Mac user agent but has a touch screen.
    return /Macintosh/.test(ua) && (n.maxTouchPoints ?? 0) > 1;
  } catch {
    return false;
  }
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v: number): number => clamp(Number.isFinite(v) ? v : 0, 0, 1);

// ---------------------------------------------------------------------------------------------
// Voices
// ---------------------------------------------------------------------------------------------

interface Layer {
  buf: AudioBuffer;
  rate: number;
  gain: number;
  /** Extra start delay in seconds. */
  delay?: number;
}

interface VoiceSpec {
  name: string;
  layers: Layer[];
  bus: 'sfx' | 'ui';
  pos: Vec3Like | null;
  prio: number;
  gain: number;
  send: number;
  ref: number;
  cull: number;
  delay: boolean;
  maxSame: number;
}

interface Voice {
  name: string;
  /** Effective priority (distance-adjusted). */
  prio: number;
  end: number;
  gain: GainNode;
  nodes: AudioNode[];
  sources: AudioBufferSourceNode[];
  hrtf: boolean;
  dying: boolean;
  released: boolean;
}

interface Graph {
  master: GainNode;
  sfx: GainNode;
  ui: GainNode;
  music: GainNode;
  muffle: BiquadFilterNode;
  reverb: ReverbBus;
  ambience: Ambience;
  player: MusicPlayer;
  bank: SoundBank;
}

export class AudioEngine {
  private readonly available: boolean;
  private readonly mobile: boolean;
  private readonly maxVoices: number;
  private readonly maxHrtf: number;
  private readonly rnd = new Rand(0xa0d10);

  private ctx: AudioContext | null = null;
  private g: Graph | null = null;
  private disposed = false;
  private unlocking: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  private vol: Volumes = { ...DEFAULT_VOLUMES };
  private muffled = 0;
  private tinnitus: { osc: OscillatorNode; gain: GainNode } | null = null;
  private reverbKind: ReverbKind = 'open';
  private ambienceKind: AmbienceKind = 'none';
  private track: MusicTrack = 'none';
  private intensity = 0;
  private lx = 0;
  private ly = 0;
  private lz = 0;
  private lyaw = 0;
  private lpitch = 0;

  private voices: Voice[] = [];
  private hrtfCount = 0;
  private readonly lastPlay = new Map<string, number>();
  private readonly lastVariant = new Map<string, number>();

  constructor() {
    this.available = contextCtor() !== null;
    this.mobile = looksMobile();
    this.maxVoices = this.mobile ? MAX_VOICES_MOBILE : MAX_VOICES;
    this.maxHrtf = this.mobile ? HRTF_MAX_MOBILE : HRTF_MAX;
  }

  /** False when Web Audio is unavailable; every method is then a no-op. */
  get supported(): boolean {
    return this.available;
  }

  /** Diagnostics: live voices, ms spent pre-rendering, buffers still queued. */
  get stats(): { voices: number; renderMs: number; pending: number; maxVoices: number } {
    return { voices: this.voices.length, renderMs: this.g?.bank.renderMs ?? 0, pending: this.g?.bank.pending ?? 0, maxVoices: this.maxVoices };
  }

  // ------------------------------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------------------------------

  /** Create / resume the AudioContext. Call from a user gesture; safe to call repeatedly. */
  unlock(): Promise<void> {
    if (!this.available || this.disposed) return Promise.resolve();
    if (!this.unlocking) {
      this.unlocking = this.doUnlock()
        .catch(() => undefined)
        .then(() => {
          this.unlocking = null;
        });
    }
    return this.unlocking;
  }

  private async doUnlock(): Promise<void> {
    if (!this.ctx) this.build();
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state !== 'running') {
      // Some browsers never settle resume() outside a gesture; do not let that wedge unlock().
      await Promise.race([ctx.resume().catch(() => undefined), new Promise<void>((res) => setTimeout(res, 1500))]);
    }
    try {
      // iOS: playing one silent buffer inside the gesture fully unlocks output.
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, 22050);
      s.connect(ctx.destination);
      s.start(0);
    } catch {
      /* best effort */
    }
  }

  private build(): void {
    const Ctor = contextCtor();
    if (!Ctor) return;
    let ctx: AudioContext;
    try {
      ctx = new Ctor({ latencyHint: 'interactive' });
    } catch {
      ctx = new Ctor();
    }
    this.ctx = ctx;

    const master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 14;
    comp.ratio.value = 5;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    master.connect(comp);
    comp.connect(ctx.destination);

    const sfx = ctx.createGain();
    const muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.frequency.value = 18000;
    muffle.Q.value = 0.5;
    sfx.connect(muffle);
    muffle.connect(master);
    const ui = ctx.createGain();
    ui.connect(master);
    const music = ctx.createGain();
    music.connect(master);

    const bank = new SoundBank(ctx);
    const reverb = new ReverbBus(ctx, sfx);
    const ambience = new Ambience(ctx, sfx, bank, this.rnd);
    const player = new MusicPlayer(ctx, music, bank, this.rnd);
    this.g = { master, sfx, ui, music, muffle, reverb, ambience, player, bank };

    // Apply everything that was requested before the context existed.
    this.applyGains(true);
    this.applyListener();
    reverb.set(this.reverbKind);
    ambience.set(this.ambienceKind);
    player.setIntensity(this.intensity);
    player.setTrack(this.track);
    this.applyMuffle();

    // Render the highest-priority sounds now; the rest trickles in from the timer / update().
    bank.warm(45);
    this.timer = setInterval(() => this.background(), 50);
    (this.timer as unknown as { unref?: () => void }).unref?.();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      if (this.timer !== null) clearInterval(this.timer);
      this.timer = null;
      for (const v of [...this.voices]) this.release(v);
      this.voices = [];
      this.g?.player.dispose();
      this.g?.ambience.dispose();
      this.g?.reverb.dispose();
      if (this.tinnitus) {
        try {
          this.tinnitus.osc.stop();
        } catch {
          /* already stopped */
        }
        this.tinnitus = null;
      }
      const ctx = this.ctx;
      this.g = null;
      this.ctx = null;
      void ctx?.close().catch(() => undefined);
    } catch {
      /* nothing to do */
    }
  }

  // ------------------------------------------------------------------------------------------
  // Mixer / environment
  // ------------------------------------------------------------------------------------------

  setVolumes(v: Volumes): void {
    try {
      this.vol = { master: clamp01(v.master), sfx: clamp01(v.sfx), music: clamp01(v.music), ui: clamp01(v.ui) };
      this.applyGains(false);
    } catch {
      /* never throw */
    }
  }

  private applyGains(immediate: boolean): void {
    const g = this.g;
    const ctx = this.ctx;
    if (!g || !ctx) return;
    const t = ctx.currentTime;
    const set = (p: AudioParam, v: number): void => {
      if (immediate) p.setValueAtTime(v, t);
      else p.setTargetAtTime(v, t, 0.03);
    };
    set(g.master.gain, this.vol.master);
    // Heavy muffling ducks the sfx bus a little more, like real hearing damage.
    set(g.sfx.gain, this.vol.sfx * (1 - 0.3 * this.muffled));
    set(g.music.gain, this.vol.music * MUSIC_TRIM);
    set(g.ui.gain, this.vol.ui);
  }

  /** yaw 0 looks toward -Z, positive yaw turns left (Three.js YXZ camera convention). */
  setListener(x: number, y: number, z: number, yaw: number, pitch: number): void {
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) && Number.isFinite(yaw) && Number.isFinite(pitch))) return;
    this.lx = x;
    this.ly = y;
    this.lz = z;
    this.lyaw = yaw;
    this.lpitch = pitch;
    try {
      this.applyListener();
    } catch {
      /* never throw */
    }
  }

  private applyListener(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    const cp = Math.cos(this.lpitch);
    const sp = Math.sin(this.lpitch);
    const cy = Math.cos(this.lyaw);
    const sy = Math.sin(this.lyaw);
    // R = Ry(yaw) * Rx(pitch) applied to forward (0,0,-1) and up (0,1,0).
    const fx = -sy * cp;
    const fy = sp;
    const fz = -cy * cp;
    const ux = sy * sp;
    const uy = cp;
    const uz = cy * sp;
    if (l.positionX !== undefined) {
      l.positionX.value = this.lx;
      l.positionY.value = this.ly;
      l.positionZ.value = this.lz;
      l.forwardX.value = fx;
      l.forwardY.value = fy;
      l.forwardZ.value = fz;
      l.upX.value = ux;
      l.upY.value = uy;
      l.upZ.value = uz;
    } else {
      l.setPosition(this.lx, this.ly, this.lz);
      l.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  setEnvironment(reverb: ReverbKind, ambience: AmbienceKind): void {
    this.reverbKind = reverb;
    this.ambienceKind = ambience;
    try {
      this.g?.reverb.set(reverb);
      this.g?.ambience.set(ambience);
    } catch {
      /* never throw */
    }
  }

  /** 0..1 combat intensity; drives the adaptive music layer. */
  setIntensity(v: number): void {
    this.intensity = clamp01(v);
    try {
      this.g?.player.setIntensity(this.intensity);
    } catch {
      /* never throw */
    }
  }

  music(track: MusicTrack): void {
    this.track = track;
    try {
      this.g?.player.setTrack(track);
    } catch {
      /* never throw */
    }
  }

  /** 0..1: low-pass on the sfx bus (low health, nearby explosion) with a faint tinnitus whine when severe. */
  setMuffled(v: number): void {
    const m = clamp01(v);
    if (Math.abs(m - this.muffled) < 0.005) return;
    this.muffled = m;
    try {
      this.applyMuffle();
      this.applyGains(false);
    } catch {
      /* never throw */
    }
  }

  private applyMuffle(): void {
    const g = this.g;
    const ctx = this.ctx;
    if (!g || !ctx) return;
    const t = ctx.currentTime;
    // 18 kHz -> 350 Hz, exponentially.
    g.muffle.frequency.setTargetAtTime(18000 * Math.pow(350 / 18000, this.muffled), t, 0.06);
    const ring = this.muffled > 0.55 ? ((this.muffled - 0.55) / 0.45) * 0.018 : 0;
    if (ring > 0 && !this.tinnitus) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 7300;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(g.master);
      osc.start();
      this.tinnitus = { osc, gain };
    }
    this.tinnitus?.gain.gain.setTargetAtTime(ring, t, 0.15);
  }

  // ------------------------------------------------------------------------------------------
  // Per-frame
  // ------------------------------------------------------------------------------------------

  update(dt: number): void {
    const ctx = this.ctx;
    const g = this.g;
    if (!ctx || !g) return;
    try {
      const step = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0.016;
      this.sweep(ctx.currentTime);
      g.player.update(step);
      g.ambience.update();
      g.reverb.update();
      if (g.bank.pending > 0) g.bank.warm(2);
      // Retire the tinnitus oscillator once it has faded out.
      if (this.tinnitus && this.muffled <= 0.55 && ctx.currentTime > 0) {
        const t = this.tinnitus;
        if (t.gain.gain.value < 0.0005) {
          try {
            t.osc.stop();
            t.osc.disconnect();
            t.gain.disconnect();
          } catch {
            /* already stopped */
          }
          this.tinnitus = null;
        }
      }
    } catch {
      /* never throw */
    }
  }

  /** Timer-driven housekeeping so music keeps flowing and buffers keep rendering when frames stall. */
  private background(): void {
    const g = this.g;
    const ctx = this.ctx;
    if (!g || !ctx) return;
    try {
      g.player.tick();
      g.ambience.update();
      g.reverb.update();
      this.sweep(ctx.currentTime);
      if (g.bank.pending > 0) g.bank.warm(6);
    } catch {
      /* never throw */
    }
  }

  // ------------------------------------------------------------------------------------------
  // Playing sounds
  // ------------------------------------------------------------------------------------------

  play(id: SfxId, pos?: Vec3Like | null, opts?: PlayOpts): void {
    const g = this.g;
    const ctx = this.ctx;
    if (!g || !ctx || ctx.state === 'closed') return;
    try {
      const def = SFX_DEFS[id];
      if (!def) return;
      const now = ctx.currentTime;
      const last = this.lastPlay.get(id);
      if (last !== undefined && now - last < def.gap) return;

      let key = `sfx:${id}`;
      const layers: Layer[] = [];
      const jitter = def.jitter ? 1 + this.rnd.signed() * 0.04 : 1;
      const rate = clamp((opts?.pitch ?? 1) * jitter, 0.25, 4);
      let variantKey = key;
      if (id === 'step') {
        key = `step:${stepGroupForSurface(opts?.surface)}`;
        variantKey = key;
      }
      const buf = g.bank.get(key, this.pickVariant(variantKey, g.bank.variants(key)));
      if (!buf) return;
      layers.push({ buf, rate, gain: 1 });
      if (id === 'land') {
        // Landing = generic thud + the surface texture, pitched down.
        const tex = g.bank.get(`step:${stepGroupForSurface(opts?.surface)}`, this.pickVariant('landTex', SFX_DEFS.step.variants));
        if (tex) layers.push({ buf: tex, rate: rate * 0.85, gain: 0.7 });
      }

      const ok = this.spawn({
        name: id,
        layers,
        bus: def.bus,
        pos: pos ?? null,
        prio: def.prio,
        gain: def.gain * clamp(opts?.volume ?? 1, 0, 4),
        send: def.send,
        ref: def.ref,
        cull: def.cull,
        delay: def.delay,
        maxSame: def.max,
      });
      if (ok) this.lastPlay.set(id, now);
    } catch {
      /* never throw */
    }
  }

  /**
   * Layered gunshot: transient click + body + tail (the player's own gun adds a low-end punch layer
   * and is non-spatial). Distant shots are low-passed, quieter and delayed by the speed of sound.
   */
  gunshot(profile: GunAudioProfile, pos: Vec3Like | null): void {
    const g = this.g;
    const ctx = this.ctx;
    if (!g || !ctx || ctx.state === 'closed') return;
    try {
      const own = !pos;
      const kind: WeaponClass = g.bank.variants(`gun:${profile.kind}:body`) > 0 ? profile.kind : 'rifle';
      const power = clamp(Number.isFinite(profile.power) ? profile.power : 0.7, 0, 1.2);
      const pitch = clamp(Number.isFinite(profile.pitch) ? profile.pitch : 1, 0.4, 2.5);
      const tail = clamp01(profile.tail);
      const rate = pitch * (1 + this.rnd.signed() * 0.04);
      const layers: Layer[] = [];
      let send: number;

      if (profile.suppressed) {
        const thwip = g.bank.get('gun:suppressed', this.pickVariant('gun:suppressed', g.bank.variants('gun:suppressed')));
        if (!thwip) return;
        layers.push({ buf: thwip, rate, gain: 1 });
        send = 0.08 + 0.1 * tail;
      } else {
        const bodyKey = `gun:${kind}:body`;
        const body = g.bank.get(bodyKey, this.pickVariant(bodyKey, g.bank.variants(bodyKey)));
        if (!body) return;
        layers.push({ buf: body, rate, gain: 1 });
        if (own) {
          const punch = g.bank.get('gun:punch', this.pickVariant('gun:punch', g.bank.variants('gun:punch')));
          if (punch) layers.push({ buf: punch, rate: PUNCH_RATE[kind] * pitch, gain: 0.45 + 0.4 * power });
        }
        const tailKey = `gun:${kind}:tail`;
        const tailBuf = g.bank.get(tailKey, this.pickVariant(tailKey, g.bank.variants(tailKey)));
        if (tailBuf) layers.push({ buf: tailBuf, rate, gain: (0.2 + 0.55 * tail) * (own ? 0.75 : 1), delay: 0.004 });
        send = 0.18 + 0.5 * tail;
      }

      this.spawn({
        name: 'gun',
        layers,
        bus: 'sfx',
        pos,
        prio: own ? 10 : 6,
        gain: (0.55 + 0.5 * power) * (own ? 1.05 : 1),
        send,
        ref: 9,
        cull: LOUD_KINDS.has(kind) ? 140 : CULL_DISTANCE,
        delay: true,
        maxSame: MAX_GUN_VOICES,
      });
    } catch {
      /* never throw */
    }
  }

  private pickVariant(key: string, n: number): number {
    if (n <= 1) return 0;
    let v = Math.floor(this.rnd.next() * n);
    if (v === this.lastVariant.get(key)) v = (v + 1) % n;
    this.lastVariant.set(key, v);
    return v;
  }

  /** Build and start a voice. Returns false when culled or out-prioritised. */
  private spawn(o: VoiceSpec): boolean {
    const g = this.g;
    const ctx = this.ctx;
    if (!g || !ctx) return false;
    const now = ctx.currentTime;

    let dist = 0;
    if (o.pos) {
      const dx = o.pos.x - this.lx;
      const dy = o.pos.y - this.ly;
      const dz = o.pos.z - this.lz;
      dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (!Number.isFinite(dist) || dist > o.cull) return false;
    }
    const eff = o.prio - Math.min(3, dist / 30);
    const delay = o.delay && o.pos ? Math.min(dist / SPEED_OF_SOUND, MAX_SOUND_DELAY) : 0;

    let dur = 0;
    for (const l of o.layers) dur = Math.max(dur, (l.delay ?? 0) + l.buf.duration / l.rate);
    const end = now + delay + dur + 0.05;

    // Per-sound cap: replace the oldest voice of the same sound.
    let same = 0;
    let oldest: Voice | null = null;
    for (const v of this.voices) {
      if (v.name !== o.name || v.dying) continue;
      same++;
      if (!oldest || v.end < oldest.end) oldest = v;
    }
    if (same >= o.maxSame && oldest) {
      if (oldest.prio > eff + 1.5) return false;
      this.fadeOut(oldest, now);
    }

    // Global cap: steal the least important voice, unless the newcomer is even less important.
    if (this.voices.length >= this.maxVoices) {
      let victim: Voice | null = null;
      for (const v of this.voices) {
        if (v.dying) continue;
        if (!victim || v.prio < victim.prio || (v.prio === victim.prio && v.end < victim.end)) victim = v;
      }
      if (!victim || victim.prio > eff) return false;
      this.fadeOut(victim, now);
    }

    const vg = ctx.createGain();
    vg.gain.value = o.gain;
    const nodes: AudioNode[] = [vg];
    const sources: AudioBufferSourceNode[] = [];
    for (const l of o.layers) {
      const src = ctx.createBufferSource();
      src.buffer = l.buf;
      src.playbackRate.value = l.rate;
      if (l.gain !== 1) {
        const lg = ctx.createGain();
        lg.gain.value = l.gain;
        src.connect(lg);
        lg.connect(vg);
        nodes.push(lg);
      } else {
        src.connect(vg);
      }
      sources.push(src);
    }

    let tail: AudioNode = vg;
    let hrtf = false;
    if (o.pos) {
      if (dist > 12) {
        // Air absorption: distant sources lose their highs.
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = clamp(16000 / (1 + dist / 22), 700, 16000);
        lp.Q.value = 0.5;
        tail.connect(lp);
        tail = lp;
        nodes.push(lp);
      }
      hrtf = dist < 30 && this.hrtfCount < this.maxHrtf;
      const p = ctx.createPanner();
      p.panningModel = hrtf ? 'HRTF' : 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = o.ref;
      p.rolloffFactor = ROLLOFF;
      p.maxDistance = 1000;
      if (p.positionX !== undefined) {
        p.positionX.value = o.pos.x;
        p.positionY.value = o.pos.y;
        p.positionZ.value = o.pos.z;
      } else {
        p.setPosition(o.pos.x, o.pos.y, o.pos.z);
      }
      tail.connect(p);
      tail = p;
      nodes.push(p);
      if (hrtf) this.hrtfCount++;
    }
    tail.connect(o.bus === 'ui' ? g.ui : g.sfx);
    if (o.bus === 'sfx' && o.send > 0.005) {
      const send = ctx.createGain();
      // Distant sources are wetter (direct/reverb ratio falls with distance).
      send.gain.value = o.send * g.reverb.wet * (1 + Math.min(1, dist / 60));
      tail.connect(send);
      send.connect(g.reverb.input);
      nodes.push(send);
    }

    const voice: Voice = { name: o.name, prio: eff, end, gain: vg, nodes, sources, hrtf, dying: false, released: false };
    this.voices.push(voice);

    let longest = 0;
    let longestEnd = -1;
    o.layers.forEach((l, i) => {
      const e = (l.delay ?? 0) + l.buf.duration / l.rate;
      if (e > longestEnd) {
        longestEnd = e;
        longest = i;
      }
      sources[i].start(now + delay + (l.delay ?? 0));
    });
    sources[longest].onended = (): void => this.release(voice);
    return true;
  }

  /** Quick declicked fade, then the source ends and `release` runs from onended / the sweep. */
  private fadeOut(v: Voice, now: number): void {
    if (v.dying || v.released) return;
    v.dying = true;
    v.end = now + 0.06;
    try {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setTargetAtTime(0, now, 0.004);
      for (const s of v.sources) s.stop(now + 0.04);
    } catch {
      this.release(v);
    }
  }

  private release(v: Voice): void {
    if (v.released) return;
    v.released = true;
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
    if (v.hrtf) this.hrtfCount = Math.max(0, this.hrtfCount - 1);
    for (const s of v.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* not started or already stopped */
      }
      try {
        s.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    for (const n of v.nodes) {
      try {
        n.disconnect();
      } catch {
        /* already disconnected */
      }
    }
  }

  /** Retire voices whose time is up (belt and braces alongside onended). */
  private sweep(now: number): void {
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const v = this.voices[i];
      if (v.end < now) this.release(v);
    }
  }
}
