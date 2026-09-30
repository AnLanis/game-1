import type { ObjectiveSpec } from './mission';
import type { Actor } from './types';
import type { SimWorld } from './world';

export interface ObjectiveMarker {
  x: number;
  z: number;
  kind: 'target' | 'zone' | 'hvt' | 'hostage' | 'extract' | 'intel';
  label: string;
  radius: number;
}

export interface ObjectiveState {
  spec: ObjectiveSpec;
  label: string;
  detail: string;
  progress: number;
  done: boolean;
  target: number;
  count: number;
  timer: number;
  wavesSpawned: number;
  interactIds: number[];
  actorId: number;
  escapeTimer: number;
  contested: boolean;
}

/**
 * Sequential objective chain. Each objective kind is a small state machine;
 * adding a kind means adding a case here plus a procgen placement rule.
 */
export class Objectives {
  readonly list: ObjectiveState[];
  index = 0;
  failed = '';

  constructor(private readonly w: SimWorld, specs: ObjectiveSpec[]) {
    this.list = specs.map((spec) => ({
      spec,
      label: spec.label,
      detail: '',
      progress: 0,
      done: false,
      target: 0,
      count: 0,
      timer: 0,
      wavesSpawned: 0,
      interactIds: [],
      actorId: -1,
      escapeTimer: 0,
      contested: false,
    }));
  }

  get current(): ObjectiveState | null {
    return this.list[this.index] ?? null;
  }

  get complete(): boolean {
    return this.index >= this.list.length;
  }

  /** Called once after the world is populated. */
  start(): void {
    const w = this.w;
    // Pre-create persistent things (hostage/HVT/intel) so they exist before their stage.
    for (const o of this.list) {
      const s = o.spec;
      if ((s.kind === 'sabotage' || s.kind === 'intel') && s.targets) {
        for (const t of s.targets) {
          const kind = s.kind === 'intel' ? 'intel' : w.sabotageKind();
          o.interactIds.push(w.addInteractable(kind, t.x, t.z, s.kind === 'intel' ? 1.1 : 2.4, s.kind === 'intel' ? 'Collect intel' : 'Plant charge'));
        }
        o.target = s.targets.length;
      }
      if (s.kind === 'rescue' && s.targets?.[0]) {
        const h = w.spawnHostage(s.targets[0].x, s.targets[0].z);
        o.actorId = h.id;
        o.interactIds.push(w.addInteractable('hostage', h.x, h.z, 1.4, 'Free hostage', h.id));
      }
      if (s.kind === 'hvt') {
        const hvt = w.actors.find((a) => a.tag === 'hvt' && a.alive);
        if (hvt) o.actorId = hvt.id;
      }
    }
    this.activate();
  }

  private activate(): void {
    const o = this.current;
    if (!o) return;
    const w = this.w;
    const s = o.spec;
    switch (s.kind) {
      case 'eliminate': {
        const alive = w.actors.filter((a) => a.alive && a.team === 1).length;
        o.target = Math.max(1, Math.ceil(alive * (s.count ?? 1)));
        o.count = 0;
        break;
      }
      case 'hold':
        o.timer = 0;
        o.wavesSpawned = 0;
        break;
      case 'survive':
        w.director.startLastStand();
        break;
      default:
        break;
    }
    w.emit({ type: 'objective', index: this.index, label: o.label, done: false });
  }

  private completeCurrent(): void {
    const o = this.current;
    if (!o) return;
    o.done = true;
    o.progress = 1;
    this.w.scoring.onObjective();
    this.w.emit({ type: 'objective', index: this.index, label: o.label, done: true });
    this.index += 1;
    this.activate();
  }

  onKill(victim: Actor): void {
    const o = this.current;
    if (!o) return;
    if (o.spec.kind === 'eliminate' && victim.team === 1) {
      o.count += 1;
    }
    if (victim.kind === 'hostage') this.failed = 'The hostage was killed';
  }

  update(dt: number): void {
    const o = this.current;
    if (!o) return;
    const w = this.w;
    const p = w.player;
    const s = o.spec;
    switch (s.kind) {
      case 'eliminate': {
        const remaining = w.actors.filter((a) => a.alive && a.team === 1).length;
        o.progress = Math.min(1, o.count / o.target);
        o.detail = `${Math.min(o.count, o.target)}/${o.target} neutralized`;
        // Anti-frustration: ping the last few hostiles on radar.
        if (o.target - o.count <= 3) for (const a of w.actors) if (a.alive && a.team === 1) a.radarUntil = w.tick + 30;
        if (o.count >= o.target || remaining === 0) this.completeCurrent();
        break;
      }
      case 'hold': {
        const z = s.zone!;
        const inside = Math.hypot(p.x - z.x, p.z - z.z) <= z.r;
        let contested = false;
        for (const a of w.actors) {
          if (a.alive && a.team === 1 && Math.hypot(a.x - z.x, a.z - z.z) <= z.r) contested = true;
        }
        o.contested = contested;
        const seconds = s.seconds ?? 20;
        const waves = s.waves ?? 1;
        if (inside && !contested) o.timer += dt;
        // Waves trigger by elapsed hold fraction (first one when you step in).
        const due = inside || o.timer > 0 ? Math.min(waves, 1 + Math.floor((o.timer / seconds) * waves)) : 0;
        while (o.wavesSpawned < due) {
          o.wavesSpawned += 1;
          w.director.spawnWave(w.waveSize(o.wavesSpawned), z, o.wavesSpawned === waves && waves >= 3);
        }
        o.progress = Math.min(1, o.timer / seconds);
        o.detail = contested ? 'Contested! Clear the zone' : inside ? `Holding ${Math.floor(o.timer)}/${seconds}s` : 'Get inside the zone';
        if (o.timer >= seconds) this.completeCurrent();
        break;
      }
      case 'sabotage':
      case 'intel': {
        const done = o.interactIds.filter((id) => w.interactable(id)?.done).length;
        o.count = done;
        o.progress = done / Math.max(1, o.target);
        o.detail = `${done}/${o.target} ${s.kind === 'intel' ? 'collected' : 'charges planted'}`;
        if (done >= o.target) this.completeCurrent();
        break;
      }
      case 'rescue': {
        const h = w.actorById(o.actorId);
        if (!h || !h.alive) {
          this.failed = 'The hostage was killed';
          break;
        }
        const it = w.interactable(o.interactIds[0]);
        if (it) {
          it.x = h.x;
          it.z = h.z;
        }
        o.detail = it?.done ? 'Hostage freed' : 'Reach the hostage';
        if (it?.done) {
          h.followId = p.id;
          this.completeCurrent();
        }
        break;
      }
      case 'hvt': {
        const t = w.actorById(o.actorId);
        if (!t || !t.alive) {
          this.completeCurrent();
          break;
        }
        o.detail = t.brain?.state === 'flee' ? 'Target is fleeing!' : 'Eliminate the target';
        if (s.escape && Math.hypot(t.x - s.escape.x, t.z - s.escape.z) < 2.5) {
          o.escapeTimer += dt;
          o.detail = `Target escaping… ${Math.max(0, 8 - o.escapeTimer).toFixed(1)}s`;
          if (o.escapeTimer >= 8) this.failed = 'The target escaped';
        }
        break;
      }
      case 'extract': {
        const z = s.zone!;
        const inside = Math.hypot(p.x - z.x, p.z - z.z) <= z.r;
        const hostage = this.hostage();
        const hostageOk = !hostage || (hostage.alive && Math.hypot(hostage.x - z.x, hostage.z - z.z) <= z.r + 1.5);
        o.detail = inside && !hostageOk ? 'Bring the hostage to extraction' : 'Reach the extraction point';
        o.progress = inside ? 1 : 0;
        if (inside && hostageOk) this.completeCurrent();
        break;
      }
      case 'survive': {
        const d = w.director;
        o.detail = d.waveBreak > 0 ? `Wave ${d.wave + 1} in ${Math.ceil(d.waveBreak)}s` : `Wave ${d.wave} · ${d.aliveHostiles()} hostiles`;
        o.progress = 0;
        break;
      }
    }
  }

  private hostage(): Actor | null {
    for (const o of this.list) if (o.spec.kind === 'rescue') return this.w.actorById(o.actorId) ?? null;
    return null;
  }

  /** World markers for HUD/minimap (current objective only, plus escort). */
  markers(out: ObjectiveMarker[]): ObjectiveMarker[] {
    out.length = 0;
    const o = this.current;
    if (!o) return out;
    const w = this.w;
    const s = o.spec;
    switch (s.kind) {
      case 'hold':
        out.push({ x: s.zone!.x, z: s.zone!.z, kind: 'zone', label: 'HOLD', radius: s.zone!.r });
        break;
      case 'extract':
        out.push({ x: s.zone!.x, z: s.zone!.z, kind: 'extract', label: 'EXFIL', radius: s.zone!.r });
        break;
      case 'sabotage':
      case 'intel':
        o.interactIds.forEach((id, n) => {
          const it = w.interactable(id);
          if (it && !it.done) out.push({ x: it.x, z: it.z, kind: s.kind === 'intel' ? 'intel' : 'target', label: String.fromCharCode(65 + n), radius: 1 });
        });
        break;
      case 'rescue': {
        const h = w.actorById(o.actorId);
        if (h) out.push({ x: h.x, z: h.z, kind: 'hostage', label: 'VIP', radius: 1 });
        break;
      }
      case 'hvt': {
        const t = w.actorById(o.actorId);
        if (t && t.alive) out.push({ x: t.x, z: t.z, kind: 'hvt', label: 'HVT', radius: 1 });
        break;
      }
      default:
        break;
    }
    const hostage = this.hostage();
    if (hostage && hostage.alive && hostage.followId >= 0 && s.kind !== 'rescue') {
      out.push({ x: hostage.x, z: hostage.z, kind: 'hostage', label: 'VIP', radius: 1 });
    }
    return out;
  }
}
