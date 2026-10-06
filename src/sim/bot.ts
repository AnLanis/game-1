import { angleDiff, clamp, dampAngle, DEG, pitchTo, yawTo } from '../engine/math';
import { mixSeed, Rng } from '../engine/rng';
import { newRayHit } from './grid';
import type { Point } from './level';
import { eyeHeight } from './movement';
import { Btn, emptyCmd, type Actor, type InputCmd } from './types';
import type { SimWorld } from './world';

const ray = newRayHit();

/**
 * Autopilot for the player actor. Produces the same InputCmd a human would.
 * Used by headless tests (full-mission completion), browser bot playtests and
 * the menu attract-mode. Deliberately imperfect aim so it plays like a person.
 */
export class PlayerBot {
  private path: Point[] | null = null;
  private pathIdx = 0;
  private pathTick = -999;
  private goal: Point | null = null;
  private targetId = -1;
  private yaw: number;
  private pitch = 0;
  private strafe = 1;
  private strafeTick = 0;
  private readonly cmd: InputCmd = emptyCmd();
  private lastX = 0;
  private lastZ = 0;
  private stuck = 0;
  private jumpTick = -999;

  /** The bot's own dice: it must never draw from the world RNG, or recorded command streams could not be replayed. */
  private readonly rng: Rng;

  constructor(
    private readonly w: SimWorld,
    private readonly skill = 1,
    /** Varies the bot's choices (strafe direction) without touching the simulation. */
    seed = 0,
  ) {
    this.yaw = w.player.yaw;
    this.rng = new Rng(mixSeed(0xb07, seed));
  }

  next(): InputCmd {
    const w = this.w;
    const p = w.player;
    const cmd = this.cmd;
    cmd.buttons = 0;
    cmd.slot = 0;
    cmd.moveF = 0;
    cmd.moveR = 0;
    if (!p.alive) return cmd;
    const dt = 1 / 60;
    const ex = p.x;
    const ey = p.y + eyeHeight(p);
    const ez = p.z;

    // Target selection every 6 ticks.
    if (w.tick % 6 === 0) this.targetId = this.pickTarget(ex, ey, ez);
    let target = this.targetId >= 0 ? w.actorById(this.targetId) : undefined;
    // A fleeing HVT is chased flat out: ignore his bodyguards, shoot only him, never strafe.
    const hvt = this.hvtTarget();
    const chasing = hvt !== null && hvt.brain?.state === 'flee';
    if (chasing && target && target !== hvt) target = undefined;

    // Goal: current objective marker, else nearest living hostile.
    if (w.tick - this.pathTick > 60 || (!this.path && w.tick - this.pathTick > 10)) this.plan();

    let lookYaw = this.yaw;
    let lookPitch = 0;
    if (target && target.alive) {
      const ty = target.y + target.height * (this.skill > 1.2 ? 0.85 : 0.68);
      lookYaw = yawTo(ex, ez, target.x, target.z);
      lookPitch = pitchTo({ x: ex, y: ey, z: ez }, { x: target.x, y: ty, z: target.z });
    } else if (this.path && this.path[this.pathIdx]) {
      const wp = this.path[this.pathIdx];
      lookYaw = yawTo(ex, ez, wp.x, wp.z);
    }
    this.yaw = dampAngle(this.yaw, lookYaw, 9 * this.skill, dt);
    this.pitch = dampAngle(this.pitch, lookPitch, 9 * this.skill, dt);
    // Compensate recoil a little like a human pulling down.
    const slot = p.weapons[p.current];
    cmd.yaw = this.yaw;
    cmd.pitch = clamp(this.pitch - (slot ? slot.recoilPitch * 0.6 : 0), -1.3, 1.3);

    // Movement along path.
    let dirX = 0;
    let dirZ = 0;
    if (this.path) {
      let wp = this.path[this.pathIdx];
      while (wp && Math.hypot(wp.x - p.x, wp.z - p.z) < 0.6 && this.pathIdx < this.path.length - 1) {
        this.pathIdx += 1;
        wp = this.path[this.pathIdx];
      }
      if (wp) {
        const dx = wp.x - p.x;
        const dz = wp.z - p.z;
        const dd = Math.hypot(dx, dz);
        const atGoal = this.pathIdx === this.path.length - 1 && dd < 0.8;
        if (!atGoal && dd > 1e-3) {
          dirX = dx / dd;
          dirZ = dz / dd;
        }
      }
    }
    const fighting = target && target.alive && !chasing;
    if (fighting) {
      // Keep moving but slower; strafe a bit.
      if (w.tick - this.strafeTick > 50) {
        this.strafeTick = w.tick;
        this.strafe = this.rng.next() < 0.5 ? -1 : 1;
      }
      const tx = target!.x - p.x;
      const tz = target!.z - p.z;
      const td = Math.hypot(tx, tz) || 1;
      dirX = dirX * 0.5 + (-tz / td) * this.strafe * 0.5;
      dirZ = dirZ * 0.5 + (tx / td) * this.strafe * 0.5;
      cmd.buttons |= Btn.Ads;
    }
    const l = Math.hypot(dirX, dirZ);
    if (l > 1e-3) {
      dirX /= l;
      dirZ /= l;
      const sy = Math.sin(p.yaw);
      const cy = Math.cos(p.yaw);
      cmd.moveF = dirX * -sy + dirZ * -cy;
      cmd.moveR = dirX * cy + dirZ * -sy;
      if (!fighting && cmd.moveF > 0.7) cmd.buttons |= Btn.Sprint;
    }

    // Unstick by jumping.
    const moved = Math.hypot(p.x - this.lastX, p.z - this.lastZ);
    this.lastX = p.x;
    this.lastZ = p.z;
    if (l > 0 && moved < 0.01) this.stuck += 1;
    else this.stuck = 0;
    if (this.stuck > 30 && w.tick - this.jumpTick > 40) {
      cmd.buttons |= Btn.Jump;
      this.jumpTick = w.tick;
      this.pathTick = -999;
    }

    // Shooting.
    // While chasing, hold fire until the HVT is in decent range so the bot keeps sprinting.
    const shooting = target && target.alive && (!chasing || Math.hypot(target.x - p.x, target.z - p.z) < 28);
    if (shooting && slot) {
      const aligned = Math.abs(angleDiff(p.yaw, lookYaw)) < 4 * DEG;
      if (aligned && slot.mag > 0) {
        if (slot.def.auto || (p.prevButtons & Btn.Fire) === 0) cmd.buttons |= Btn.Fire;
      }
      if (slot.mag === 0) {
        if (slot.reserve > 0) cmd.buttons |= Btn.Reload;
        else cmd.slot = p.current === 0 ? 2 : 1;
      }
    } else if (slot && slot.mag < slot.def.magSize * 0.5 && slot.reserve > 0) {
      cmd.buttons |= Btn.Reload;
    }

    // Objectives: hold interact when a prompt is available.
    if (w.promptId >= 0) cmd.buttons |= Btn.Interact;
    return cmd;
  }

  private pickTarget(ex: number, ey: number, ez: number): number {
    const w = this.w;
    // The HVT outranks his bodyguards whenever we have a shot at him.
    const hvt = this.hvtTarget();
    if (hvt && Math.hypot(hvt.x - ex, hvt.z - ez) < 70 && w.grid.lineOfSight(ex, ey, ez, hvt.x, hvt.y + hvt.height * 0.7, hvt.z, ray)) return hvt.id;
    let best = -1;
    let bd = 70;
    for (const a of w.actors) {
      if (!a.alive || a.team !== 1) continue;
      const d = Math.hypot(a.x - ex, a.z - ez);
      if (d > bd) continue;
      if (!w.grid.lineOfSight(ex, ey, ez, a.x, a.y + a.height * 0.7, a.z, ray)) continue;
      bd = d;
      best = a.id;
    }
    return best;
  }

  /** The living HVT while the manhunt objective is active. */
  private hvtTarget(): Actor | null {
    const o = this.w.objectives.current;
    if (!o || o.spec.kind !== 'hvt') return null;
    const t = this.w.actorById(o.actorId);
    return t && t.alive ? t : null;
  }

  private plan(): void {
    const w = this.w;
    const p = w.player;
    this.pathTick = w.tick;
    this.goal = null;
    this.path = null;
    this.pathIdx = 0;
    // Try the best few candidates: an unreachable "nearest" hostile must not park the bot forever.
    const goals = this.pickGoals(p);
    for (let n = 0; n < goals.length && n < 4; n += 1) {
      const path = w.nav.findPath(p.x, p.z, goals[n].x, goals[n].z, 12000);
      if (path) {
        this.goal = goals[n];
        this.path = path;
        return;
      }
    }
  }

  /** Candidate destinations for the current objective, best first. */
  private pickGoals(p: Actor): Point[] {
    const w = this.w;
    const o = w.objectives.current;
    if (!o) return [];
    if (o.spec.kind === 'eliminate' || o.spec.kind === 'survive') {
      const hostiles = w.actors.filter((a) => a.alive && a.team === 1).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z) || a.id - b.id);
      const out: Point[] = hostiles.map((a) => ({ x: a.x, z: a.z }));
      if (o.spec.zone) out.push(o.spec.zone);
      return out;
    }
    if (o.spec.kind === 'hold' && o.spec.zone) {
      const zone = o.spec.zone;
      // Clear contesting enemies first.
      if (o.contested) {
        const inZone = w.actors.filter((a) => a.alive && a.team === 1 && Math.hypot(a.x - zone.x, a.z - zone.z) <= zone.r + 2);
        if (inZone.length) return inZone.map((a) => ({ x: a.x, z: a.z })).concat([{ x: zone.x, z: zone.z }]);
      }
      return [{ x: zone.x, z: zone.z }];
    }
    // The escorted hostage is also listed as a marker while another objective is active;
    // it follows us anyway, so never treat it as the destination (the bot would just idle beside it).
    const wantKind = o.spec.kind === 'extract' ? 'extract' : null;
    const markers = w.markers().filter((m) => (wantKind ? m.kind === wantKind : m.kind !== 'hostage' || o.spec.kind === 'rescue'));
    markers.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    return markers.map((m) => ({ x: m.x, z: m.z }));
  }

  get currentGoal(): Point | null {
    return this.goal;
  }
}
