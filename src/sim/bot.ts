import { angleDiff, clamp, dampAngle, DEG, pitchTo, yawTo } from '../engine/math';
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

  constructor(
    private readonly w: SimWorld,
    private readonly skill = 1,
  ) {
    this.yaw = w.player.yaw;
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
    const target = this.targetId >= 0 ? w.actorById(this.targetId) : undefined;

    // Goal: current objective marker, else nearest living hostile.
    if (w.tick - this.pathTick > 60 || !this.path) this.plan();

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
    const fighting = target && target.alive;
    if (fighting) {
      // Keep moving but slower; strafe a bit.
      if (w.tick - this.strafeTick > 50) {
        this.strafeTick = w.tick;
        this.strafe = w.rng.next() < 0.5 ? -1 : 1;
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
    if (fighting && slot) {
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

  private plan(): void {
    const w = this.w;
    const p = w.player;
    this.pathTick = w.tick;
    const goal = this.pickGoal(p);
    this.goal = goal;
    if (!goal) {
      this.path = null;
      return;
    }
    this.path = w.nav.findPath(p.x, p.z, goal.x, goal.z, 12000);
    this.pathIdx = 0;
  }

  private pickGoal(p: Actor): Point | null {
    const w = this.w;
    const o = w.objectives.current;
    if (!o) return null;
    const markers = w.markers();
    if (o.spec.kind === 'eliminate' || o.spec.kind === 'survive') {
      let best: Actor | null = null;
      let bd = Infinity;
      for (const a of w.actors) {
        if (!a.alive || a.team !== 1) continue;
        const d = Math.hypot(a.x - p.x, a.z - p.z);
        if (d < bd) {
          bd = d;
          best = a;
        }
      }
      return best ? { x: best.x, z: best.z } : o.spec.zone ?? null;
    }
    if (o.spec.kind === 'hold' && o.spec.zone) {
      // Clear contesting enemies first.
      if (o.contested) {
        for (const a of w.actors) if (a.alive && a.team === 1 && Math.hypot(a.x - o.spec.zone.x, a.z - o.spec.zone.z) <= o.spec.zone.r + 2) return { x: a.x, z: a.z };
      }
      return { x: o.spec.zone.x, z: o.spec.zone.z };
    }
    let best: Point | null = null;
    let bd = Infinity;
    for (const m of markers) {
      const d = Math.hypot(m.x - p.x, m.z - p.z);
      if (d < bd) {
        bd = d;
        best = { x: m.x, z: m.z };
      }
    }
    return best;
  }

  get currentGoal(): Point | null {
    return this.goal;
  }
}
