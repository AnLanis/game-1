import { approach, clamp } from '../engine/math';
import { Shape, type Grid } from './grid';
import { Btn, type Actor } from './types';

export const STEP_HEIGHT = 0.45;
export const CROUCH_HEIGHT_RATIO = 0.64;
export const JUMP_SPEED = 7.2;
const GROUND_ACCEL = 60;
const GROUND_DECEL = 42;
const AIR_ACCEL = 11;
const SLIDE_SPEED = 10.5;
const SLIDE_TIME = 0.75;

/** Eye height above feet for an actor. */
export const eyeHeight = (a: Actor): number => a.height - 0.12 * a.scale;

/**
 * Integrates one actor for one tick using its current command.
 * Axis-separated AABB vs heightfield collision; anything under STEP_HEIGHT
 * above the feet is stepped onto, which also gives jump → auto-mantle onto
 * low cover. Deterministic and allocation-free.
 */
export function moveActor(a: Actor, grid: Grid, dt: number, gravity: number, events: (e: 'jump' | 'land' | 'slide', speed: number) => void): void {
  const cmd = a.cmd;
  const b = cmd.buttons;
  const wantsCrouch = (b & Btn.Crouch) !== 0;
  const wantsSprint = (b & Btn.Sprint) !== 0 && cmd.moveF > 0.3 && a.ads < 0.3 && !wantsCrouch;
  const firing = (b & Btn.Fire) !== 0;

  // Slide: sprinting + crouch press on the ground.
  const crouchPressed = wantsCrouch && (a.prevButtons & Btn.Crouch) === 0;
  const hSpeed = Math.hypot(a.vx, a.vz);
  if (crouchPressed && a.onGround && a.sprinting && hSpeed > 5.5 && a.sliding <= 0) {
    a.sliding = SLIDE_TIME;
    const l = hSpeed || 1;
    a.vx = (a.vx / l) * SLIDE_SPEED;
    a.vz = (a.vz / l) * SLIDE_SPEED;
    events('slide', hSpeed);
  }
  if (a.sliding > 0) a.sliding = Math.max(0, a.sliding - dt);

  a.crouching = wantsCrouch || a.sliding > 0;
  a.sprinting = wantsSprint && !firing && a.sliding <= 0 && a.onGround ? true : wantsSprint && !a.onGround && a.sprinting;
  a.crouch = approach(a.crouch, a.crouching ? 1 : 0, dt * 7);
  a.height = a.standHeight * (1 - (1 - CROUCH_HEIGHT_RATIO) * a.crouch);

  // Wish velocity in world space from local command.
  const sy = Math.sin(a.yaw);
  const cy = Math.cos(a.yaw);
  let mf = cmd.moveF;
  let mr = cmd.moveR;
  const ml = Math.hypot(mf, mr);
  if (ml > 1) {
    mf /= ml;
    mr /= ml;
  }
  const weapon = a.weapons[a.current];
  const weaponMult = weapon ? weapon.def.moveSpeedMult : 1;
  let speed = (a.sprinting ? a.runSpeed : a.walkSpeed) * a.speedMult * weaponMult;
  if (a.crouch > 0.5 && a.sliding <= 0) speed *= 0.55;
  speed *= 1 - a.ads * 0.38;
  // forward = (-sin, -cos), right = (cos, -sin)
  const wishX = (-sy * mf + cy * mr) * speed;
  const wishZ = (-cy * mf - sy * mr) * speed;

  if (a.sliding > 0) {
    // Slides keep momentum with friction; slight steering.
    const fr = Math.max(0, 1 - dt * 2.2);
    a.vx = a.vx * fr + wishX * dt * 1.2;
    a.vz = a.vz * fr + wishZ * dt * 1.2;
  } else if (a.onGround) {
    const rate = Math.abs(wishX) + Math.abs(wishZ) > 0.01 ? GROUND_ACCEL : GROUND_DECEL;
    a.vx = approach(a.vx, wishX, rate * dt);
    a.vz = approach(a.vz, wishZ, rate * dt);
  } else {
    a.vx = approach(a.vx, wishX, AIR_ACCEL * dt);
    a.vz = approach(a.vz, wishZ, AIR_ACCEL * dt);
  }

  // Jump.
  if ((b & Btn.Jump) !== 0 && (a.prevButtons & Btn.Jump) === 0 && a.onGround) {
    a.vy = JUMP_SPEED * (gravity < 15 ? 0.82 : 1);
    a.onGround = false;
    a.sliding = 0;
    events('jump', 0);
  }

  const wasGround = a.onGround;
  const fallSpeed = -a.vy;
  a.vy -= gravity * dt;
  a.vy = Math.max(a.vy, -40);

  const r = a.radius;
  a.x += a.vx * dt;
  resolveAxis(a, grid, r, 0);
  a.z += a.vz * dt;
  resolveAxis(a, grid, r, 1);
  a.y += a.vy * dt;

  const ground = groundHeight(grid, a.x, a.z, r, a.y);
  if (a.y <= ground + 1e-4 && a.vy <= 0) {
    a.y = ground;
    if (!wasGround && fallSpeed > 3) events('land', fallSpeed);
    a.vy = 0;
    a.onGround = true;
  } else if (wasGround && a.vy <= 0 && a.y - ground < STEP_HEIGHT && a.y > ground) {
    // Stick to the ground walking down small steps.
    a.y = ground;
    a.vy = 0;
    a.onGround = true;
  } else {
    a.onGround = false;
  }
  a.y = clamp(a.y, 0, 50);
}

/** Highest standable surface under the footprint (ignores blocks above step reach). */
export function groundHeight(grid: Grid, x: number, z: number, r: number, feetY: number): number {
  const i0 = Math.floor(x - r - grid.ox);
  const i1 = Math.floor(x + r - grid.ox);
  const j0 = Math.floor(z - r - grid.oz);
  const j1 = Math.floor(z + r - grid.oz);
  let best = 0;
  for (let j = j0; j <= j1; j += 1) {
    for (let i = i0; i <= i1; i += 1) {
      if (!grid.inBounds(i, j)) continue;
      const k = j * grid.w + i;
      const h = grid.height[k];
      if (h <= 0 || h > feetY + STEP_HEIGHT) continue;
      if (grid.shape[k] === Shape.Cylinder && !overlapsCylinder(grid, i, j, k, x, z, r)) continue;
      if (h > best) best = h;
    }
  }
  return best;
}

function overlapsCylinder(grid: Grid, i: number, j: number, k: number, x: number, z: number, r: number): boolean {
  const cx = grid.ox + i + 0.5;
  const cz = grid.oz + j + 0.5;
  const rad = grid.radius[k];
  return Math.abs(x - cx) < rad + r && Math.abs(z - cz) < rad + r;
}

function resolveAxis(a: Actor, grid: Grid, r: number, axis: 0 | 1): void {
  const i0 = Math.floor(a.x - r - grid.ox);
  const i1 = Math.floor(a.x + r - grid.ox);
  const j0 = Math.floor(a.z - r - grid.oz);
  const j1 = Math.floor(a.z + r - grid.oz);
  const limit = a.y + STEP_HEIGHT;
  for (let j = j0; j <= j1; j += 1) {
    for (let i = i0; i <= i1; i += 1) {
      const inside = grid.inBounds(i, j);
      const k = inside ? j * grid.w + i : -1;
      const h = inside ? grid.height[k] : 1e9;
      if (h <= limit) continue;
      let minX = grid.ox + i;
      let maxX = minX + 1;
      let minZ = grid.oz + j;
      let maxZ = minZ + 1;
      if (inside && grid.shape[k] === Shape.Cylinder) {
        const cx = minX + 0.5;
        const cz = minZ + 0.5;
        const rad = grid.radius[k];
        minX = cx - rad;
        maxX = cx + rad;
        minZ = cz - rad;
        maxZ = cz + rad;
      }
      if (a.x + r <= minX || a.x - r >= maxX || a.z + r <= minZ || a.z - r >= maxZ) continue;
      if (axis === 0) {
        if (a.vx > 0) a.x = minX - r - 1e-4;
        else if (a.vx < 0) a.x = maxX + r + 1e-4;
        else a.x = a.x < (minX + maxX) / 2 ? minX - r - 1e-4 : maxX + r + 1e-4;
        a.vx = 0;
      } else {
        if (a.vz > 0) a.z = minZ - r - 1e-4;
        else if (a.vz < 0) a.z = maxZ + r + 1e-4;
        else a.z = a.z < (minZ + maxZ) / 2 ? minZ - r - 1e-4 : maxZ + r + 1e-4;
        a.vz = 0;
      }
    }
  }
}

/**
 * Soft actor-vs-actor separation using a uniform spatial hash (2 m buckets),
 * O(n) average. Keeps crowds from stacking without a physics engine.
 */
export class Separation {
  private readonly buckets = new Map<number, number[]>();

  run(actors: Actor[], grid: Grid): void {
    const buckets = this.buckets;
    for (const list of buckets.values()) list.length = 0;
    for (let n = 0; n < actors.length; n += 1) {
      const a = actors[n];
      if (!a.alive) continue;
      const key = (Math.floor(a.x / 2) + 512) * 4096 + (Math.floor(a.z / 2) + 512);
      let list = buckets.get(key);
      if (!list) buckets.set(key, (list = []));
      list.push(n);
    }
    for (let n = 0; n < actors.length; n += 1) {
      const a = actors[n];
      if (!a.alive) continue;
      const bx = Math.floor(a.x / 2);
      const bz = Math.floor(a.z / 2);
      for (let ox = -1; ox <= 1; ox += 1) {
        for (let oz = -1; oz <= 1; oz += 1) {
          const list = buckets.get((bx + ox + 512) * 4096 + (bz + oz + 512));
          if (!list) continue;
          for (const m of list) {
            if (m <= n) continue;
            const b = actors[m];
            const dx = b.x - a.x;
            const dz = b.z - a.z;
            const min = a.radius + b.radius;
            const d2 = dx * dx + dz * dz;
            if (d2 >= min * min || Math.abs(a.y - b.y) > 1.2) continue;
            const d = Math.sqrt(d2) || 0.001;
            const push = (min - d) * 0.5;
            const nx = d2 > 0 ? dx / d : 1;
            const nz = d2 > 0 ? dz / d : 0;
            // The player is heavier: AI yields to the player.
            const wa = a.kind === 'player' ? 0.15 : b.kind === 'player' ? 0.85 : 0.5;
            tryShift(a, grid, -nx * push * wa * 2, -nz * push * wa * 2);
            tryShift(b, grid, nx * push * (1 - wa) * 2, nz * push * (1 - wa) * 2);
          }
        }
      }
    }
  }
}

function tryShift(a: Actor, grid: Grid, dx: number, dz: number): void {
  const nx = a.x + dx;
  const nz = a.z + dz;
  const r = a.radius;
  const limit = a.y + STEP_HEIGHT;
  for (const [ox, oz] of CORNERS) {
    if (grid.heightAt(nx + ox * r, nz + oz * r) > limit) return;
  }
  a.x = nx;
  a.z = nz;
}

const CORNERS: [number, number][] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
