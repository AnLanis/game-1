import { approach, clamp, clamp01, coneDirection, DEG, dirFromYawPitch, lerp, smoothstep, type Vec3 } from '../engine/math';
import { CellFlag, newRayHit } from './grid';
import { eyeHeight } from './movement';
import { Btn, type Actor, type HitZone, type WeaponSlot } from './types';
import type { SimWorld } from './world';

const dirScratch: Vec3 = { x: 0, y: 0, z: 0 };
const ray = newRayHit();
const MAX_RECOIL_PITCH = 7 * DEG;
const MAX_RECOIL_YAW = 4 * DEG;

/** Deterministic per-weapon horizontal recoil pattern in roughly [-1.3, 1.3]. */
export function recoilPattern(seed: number, shot: number): number {
  const ramp = Math.min(1, shot / 4);
  return (Math.sin(shot * 0.9 + seed) * 0.8 + Math.sin(shot * 0.37 + seed * 1.7) * 0.5) * ramp;
}

export function damageFalloff(dist: number, start: number, end: number, minMult: number): number {
  return lerp(1, minMult, smoothstep(start, end, dist));
}

/** Weapon handling for one actor for one tick: switch, ADS, reload, fire, recovery. */
export function updateWeapons(w: SimWorld, a: Actor, dt: number): void {
  const cmd = a.cmd;
  const b = cmd.buttons;
  const pressed = b & ~a.prevButtons;
  const n = a.weapons.length;
  if (n === 0) return;

  let target = -1;
  if (cmd.slot > 0 && cmd.slot - 1 < n && cmd.slot - 1 !== a.current) target = cmd.slot - 1;
  if (pressed & Btn.Next) target = (a.current + 1) % n;
  if (pressed & Btn.Prev) target = (a.current - 1 + n) % n;
  if (target >= 0 && target !== a.current) {
    const old = a.weapons[a.current];
    old.reloadTimer = 0;
    a.current = target;
    a.switchTimer = a.weapons[target].def.switchTime;
    w.emit({ type: 'switch', actorId: a.id, weaponId: a.weapons[target].def.id });
  }

  const slot = a.weapons[a.current];
  const def = slot.def;
  if (slot.cooldown > 0) slot.cooldown -= dt;
  if (a.switchTimer > 0) a.switchTimer = Math.max(0, a.switchTimer - dt);
  if (a.throwTimer > 0) a.throwTimer = Math.max(0, a.throwTimer - dt);

  const wantAds = (b & Btn.Ads) !== 0 && !a.sprinting && slot.reloadTimer <= 0 && a.switchTimer <= 0 && a.throwTimer <= 0;
  a.ads = approach(a.ads, wantAds ? 1 : 0, dt / Math.max(0.05, def.adsTime));

  if (slot.reloadTimer > 0) {
    slot.reloadTimer -= dt;
    if (slot.reloadTimer <= 0) {
      slot.reloadTimer = 0;
      const take = Math.min(def.magSize - slot.mag, slot.reserve);
      slot.mag += take;
      slot.reserve -= take;
      w.emit({ type: 'reloadDone', actorId: a.id });
    }
  } else if (
    ((pressed & Btn.Reload) !== 0 || (slot.mag === 0 && (b & Btn.Fire) !== 0)) &&
    slot.mag < def.magSize &&
    slot.reserve > 0 &&
    a.switchTimer <= 0
  ) {
    slot.reloadTotal = def.reloadTime * (slot.mag === 0 ? 1.12 : 1);
    slot.reloadTimer = slot.reloadTotal;
    w.emit({ type: 'reload', actorId: a.id, weaponId: def.id, time: slot.reloadTotal });
    if (a.kind === 'player') w.onPlayerReload();
  }

  const trigger = (b & Btn.Fire) !== 0;
  const triggerPressed = (pressed & Btn.Fire) !== 0;
  const canFire = slot.cooldown <= 0 && slot.reloadTimer <= 0 && a.switchTimer <= 0 && a.throwTimer <= 0 && slot.mag > 0;
  if (trigger && (def.auto || triggerPressed) && canFire) {
    a.sprinting = false;
    fire(w, a, slot);
  } else if (triggerPressed && slot.mag === 0 && slot.reserve === 0) {
    w.emit({ type: 'dryfire', actorId: a.id });
  }

  // Recoil recovery and pattern reset.
  const since = (w.tick - slot.lastShotTick) * dt;
  if (since > 0.06) {
    const k = 1 - Math.exp(-def.recoil.recovery * dt);
    slot.recoilPitch -= slot.recoilPitch * k;
    slot.recoilYaw -= slot.recoilYaw * k;
  }
  if (since > 0.45) slot.shotIndex = 0;
  slot.bloom = Math.max(0, slot.bloom - (def.bloomMax * 2 + 0.01) * dt);

  // Grenade.
  if ((pressed & Btn.Grenade) !== 0) throwGrenade(w, a);
}

export function currentSpread(a: Actor, slot: WeaponSlot): number {
  const def = slot.def;
  const hSpeed = Math.hypot(a.vx, a.vz);
  const moveFactor = clamp01(hSpeed / 6);
  let spread = lerp(def.hipSpread, def.adsSpread, a.ads);
  spread *= 1 + moveFactor * (def.moveSpreadMult - 1) * (1 - a.ads * 0.5);
  if (a.crouch > 0.5) spread *= 0.8;
  if (!a.onGround) spread *= 2;
  spread += slot.bloom * (1 - 0.6 * a.ads);
  return spread;
}

function fire(w: SimWorld, a: Actor, slot: WeaponSlot): void {
  const def = slot.def;
  const interval = 60 / def.rpm;
  slot.mag -= 1;
  slot.cooldown = Math.max(slot.cooldown, -1 / 60) + interval;
  slot.lastShotTick = w.tick;
  slot.shotIndex += 1;
  a.stats.shots += 1;

  const ex = a.x;
  const ey = a.y + eyeHeight(a);
  const ez = a.z;
  let spread = currentSpread(a, slot);
  if (a.kind === 'enemy') spread *= 0.55;
  const yaw0 = a.yaw + slot.recoilYaw;
  const pitch0 = a.pitch + slot.recoilPitch;
  let anyHit = false;
  w.shotSerial += 1;
  for (let p = 0; p < def.pellets; p += 1) {
    coneDirection(yaw0, pitch0, spread, w.rng.next(), w.rng.next(), dirScratch);
    if (traceShot(w, a, ex, ey, ez, dirScratch.x, dirScratch.y, dirScratch.z, slot, p)) anyHit = true;
  }
  if (anyHit) a.stats.hits += 1;

  const aiMult = a.kind === 'enemy' ? 0.45 : 1;
  const v = def.recoil.vertical * (slot.shotIndex === 1 ? 0.7 : 1) * (1 - 0.3 * a.ads) * (a.crouch > 0.5 ? 0.85 : 1) * aiMult;
  const h = (def.recoil.horizontal * recoilPattern(def.recoil.pattern, slot.shotIndex) + def.recoil.horizontal * 0.25 * (w.rng.next() * 2 - 1)) * aiMult;
  slot.recoilPitch = Math.min(MAX_RECOIL_PITCH, slot.recoilPitch + v);
  slot.recoilYaw = clamp(slot.recoilYaw + h, -MAX_RECOIL_YAW, MAX_RECOIL_YAW);
  slot.bloom = Math.min(def.bloomMax, slot.bloom + def.bloomPerShot);

  const suppressed = Boolean(def.audio.suppressed);
  w.noise(a.x, a.z, suppressed ? 12 : 45 + def.audio.power * 25, a.id);
  if (!suppressed) a.radarUntil = w.tick + 120;
}

/** Resolve one hitscan ray. Returns true if an actor was hit. */
export function traceShot(
  w: SimWorld,
  a: Actor,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  slot: WeaponSlot,
  pellet: number,
): boolean {
  const def = slot.def;
  const grid = w.grid;
  const hitWorld = grid.raycast(ox, oy, oz, dx, dy, dz, def.maxRange, ray);
  const tWorld = hitWorld ? ray.t : def.maxRange;
  let bestT = tWorld;
  let best: Actor | null = null;
  let bestZone: HitZone = 'torso';

  for (const b of w.actors) {
    if (!b.alive || b === a) continue;
    if (a.team === 1 && (b.team === 1 || b.kind === 'civilian')) continue;
    if (a.team === 0 && b.team === 0) continue;
    const hit = rayActor(ox, oy, oz, dx, dy, dz, b, bestT);
    if (hit) {
      bestT = hitT;
      best = b;
      bestZone = hitZone;
    }
  }

  const hx = ox + dx * bestT;
  const hy = oy + dy * bestT;
  const hz = oz + dz * bestT;
  const suppressed = Boolean(def.audio.suppressed);

  if (best) {
    const falloff = damageFalloff(bestT, def.rangeStart, def.rangeEnd, def.minDamageMult);
    let zoneMult = bestZone === 'head' ? def.headMult : bestZone === 'legs' ? def.limbMult : 1;
    if (bestZone === 'head' && w.hasModifier('bighead')) zoneMult *= 1.15;
    let dmg = def.damage * falloff * zoneMult;
    if (a.team === 1) dmg *= w.difficulty.enemyDamage;
    applyDamage(w, best, dmg, a, bestZone, dx, dz, 'bullet', def.id);
    w.emit({
      type: 'shot',
      actorId: a.id,
      weaponId: def.id,
      ox,
      oy,
      oz,
      hx,
      hy,
      hz,
      nx: -dx,
      ny: -dy,
      nz: -dz,
      surface: 255,
      hitActor: best.id,
      zone: bestZone,
      pellet,
      suppressed,
    });
  } else {
    if (hitWorld) {
      const k = ray.cell;
      if (k >= 0 && (grid.flags[k] & CellFlag.Breakable) !== 0) {
        const explosive = (grid.flags[k] & CellFlag.Explosive) !== 0;
        if (grid.damageCell(k, def.damage)) w.onBreak(k, explosive, a.id);
      }
    }
    w.emit({
      type: 'shot',
      actorId: a.id,
      weaponId: def.id,
      ox,
      oy,
      oz,
      hx,
      hy,
      hz,
      nx: hitWorld ? ray.nx : 0,
      ny: hitWorld ? ray.ny : 1,
      nz: hitWorld ? ray.nz : 0,
      surface: hitWorld ? ray.surface : 254,
      hitActor: -1,
      zone: '',
      pellet,
      suppressed,
    });
  }

  // Near-miss feedback and suppression (only first pellet to avoid spam).
  if (pellet === 0) {
    if (a.team === 1) {
      const p = w.player;
      if (p.alive && best !== p) {
        const hy2 = p.y + eyeHeight(p);
        const miss = closestApproach(ox, oy, oz, dx, dy, dz, bestT, p.x, hy2, p.z);
        if (miss.d < 1.4 && miss.t > 2) {
          w.emit({ type: 'whiz', x: miss.x, y: miss.y, z: miss.z, shooterId: a.id });
        }
      }
    } else if (a.team === 0) {
      for (const e of w.actors) {
        if (!e.alive || e.team !== 1 || e === best) continue;
        const miss = closestApproach(ox, oy, oz, dx, dy, dz, bestT, e.x, e.y + e.height * 0.7, e.z);
        if (miss.d < 1.6 && miss.t > 1) e.fear = Math.min(1, e.fear + 0.22);
      }
    }
  }
  return best !== null;
}

let hitT = 0;
let hitZone: HitZone = 'torso';

/** Ray vs actor (vertical cylinder body + head sphere). Sets module hitT/hitZone. */
function rayActor(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: Actor, maxT: number): boolean {
  // Cheap reject: closest XZ approach to the actor column.
  const rx = b.x - ox;
  const rz = b.z - oz;
  const hLen = dx * dx + dz * dz;
  const tc = hLen > 1e-8 ? (rx * dx + rz * dz) / hLen : 0;
  if (tc < -1 || tc > maxT + 1) return false;
  const cx = ox + dx * tc - b.x;
  const cz = oz + dz * tc - b.z;
  if (cx * cx + cz * cz > 2.25 * b.scale * b.scale) return false;

  const headR = 0.13 * b.scale * b.headScale;
  const headY = b.y + b.height - headR * 0.95;
  let found = false;
  let t = maxT;
  // Head sphere (slightly generous for game feel).
  {
    const R = headR * 1.2;
    const fx = ox - b.x;
    const fy = oy - headY;
    const fz = oz - b.z;
    const bb = fx * dx + fy * dy + fz * dz;
    const c = fx * fx + fy * fy + fz * fz - R * R;
    const disc = bb * bb - c;
    if (disc >= 0) {
      const th = -bb - Math.sqrt(disc);
      if (th > 0 && th < t) {
        t = th;
        found = true;
        hitZone = 'head';
      }
    }
  }
  // Body cylinder.
  {
    const R = 0.28 * b.scale;
    const top = b.y + b.height - headR * 2;
    const fx = ox - b.x;
    const fz = oz - b.z;
    if (hLen > 1e-8) {
      const bb = fx * dx + fz * dz;
      const c = fx * fx + fz * fz - R * R;
      const disc = bb * bb - hLen * c;
      if (disc >= 0) {
        const tb = (-bb - Math.sqrt(disc)) / hLen;
        if (tb > 0 && tb < t) {
          const y = oy + dy * tb;
          if (y >= b.y && y <= top) {
            t = tb;
            found = true;
            hitZone = (y - b.y) / Math.max(0.5, b.height) < 0.47 ? 'legs' : 'torso';
          }
        }
      }
    }
    // Top cap (shooting down onto a crouched target).
    if (dy < -1e-4) {
      const tt = (top - oy) / dy;
      if (tt > 0 && tt < t) {
        const px = ox + dx * tt - b.x;
        const pz = oz + dz * tt - b.z;
        if (px * px + pz * pz <= R * R) {
          t = tt;
          found = true;
          hitZone = 'torso';
        }
      }
    }
  }
  if (found) hitT = t;
  return found;
}

const approachOut = { d: 0, t: 0, x: 0, y: 0, z: 0 };
function closestApproach(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  tMax: number,
  px: number,
  py: number,
  pz: number,
): typeof approachOut {
  const t = clamp((px - ox) * dx + (py - oy) * dy + (pz - oz) * dz, 0, tMax);
  const x = ox + dx * t;
  const y = oy + dy * t;
  const z = oz + dz * t;
  approachOut.d = Math.hypot(px - x, py - y, pz - z);
  approachOut.t = t;
  approachOut.x = x;
  approachOut.y = y;
  approachOut.z = z;
  return approachOut;
}

export function applyDamage(
  w: SimWorld,
  target: Actor,
  amount: number,
  source: Actor | null,
  zone: HitZone,
  dirX: number,
  dirZ: number,
  kind: 'bullet' | 'explosion',
  weaponId: string,
): void {
  if (!target.alive || amount <= 0) return;
  if (target.kind === 'player' && w.invulnerable) return;
  if (zone !== 'head' || kind === 'explosion') amount *= 1 - Math.min(0.6, target.armor / 150);
  if (target.kind === 'hostage') amount *= 0.5;
  target.hp -= amount;
  target.lastDamageTick = w.tick;
  target.hitFlash = 0.14;
  target.hitStop = zone === 'head' ? 0.09 : 0.05;
  target.lastHitZone = zone;
  const l = Math.hypot(dirX, dirZ) || 1;
  target.lastHitX = dirX / l;
  target.lastHitZ = dirZ / l;
  if (source) source.stats.damageDealt += amount;
  target.stats.damageTaken += amount;
  const killed = target.hp <= 0;
  w.emit({
    type: 'damage',
    targetId: target.id,
    sourceId: source ? source.id : -1,
    amount,
    zone,
    dirX: target.lastHitX,
    dirZ: target.lastHitZ,
    kind,
    killed,
  });
  w.onDamaged(target, source, amount);
  if (killed) w.kill(target, source, zone, weaponId, kind);
}

/** Radial explosion with line-of-sight occlusion: cover genuinely protects. */
export function explode(w: SimWorld, x: number, y: number, z: number, radius: number, damage: number, sourceId: number): void {
  w.emit({ type: 'explosion', x, y, z, radius, sourceId });
  w.noise(x, z, 90, sourceId);
  const source = w.actorById(sourceId);
  for (const b of w.actors) {
    if (!b.alive) continue;
    const cy = b.y + b.height * 0.55;
    const d = Math.hypot(b.x - x, cy - y, b.z - z);
    if (d > radius) continue;
    if (d > 1.2 && !w.grid.lineOfSight(x, y + 0.35, z, b.x, cy, b.z, ray)) continue;
    const f = 1 - d / radius;
    let dmg = damage * (f * f * 0.8 + f * 0.2);
    if (b.kind === 'player') {
      dmg *= w.playerExplosiveResist;
      if (source && source.team === 1) dmg *= w.difficulty.enemyDamage;
      if (source === b) dmg *= 0.6;
    }
    const dx = b.x - x;
    const dz = b.z - z;
    const dl = Math.hypot(dx, dz) || 1;
    b.vx += (dx / dl) * 7 * f;
    b.vz += (dz / dl) * 7 * f;
    b.vy += 3.5 * f;
    b.onGround = false;
    applyDamage(w, b, dmg, source ?? null, 'torso', dx, dz, 'explosion', 'frag');
  }
  // Destroy breakables nearby.
  const grid = w.grid;
  const r = Math.ceil(radius * 0.45);
  const ci = grid.cellX(x);
  const cj = grid.cellZ(z);
  for (let j = cj - r; j <= cj + r; j += 1) {
    for (let i = ci - r; i <= ci + r; i += 1) {
      if (!grid.inBounds(i, j)) continue;
      const k = j * grid.w + i;
      if ((grid.flags[k] & CellFlag.Breakable) === 0) continue;
      const d = Math.hypot(grid.centerX(i) - x, grid.centerZ(j) - z);
      if (d > radius * 0.45) continue;
      const explosive = (grid.flags[k] & CellFlag.Explosive) !== 0;
      if (grid.damageCell(k, 400)) w.onBreak(k, explosive, sourceId);
    }
  }
}

export const GRENADE_FUSE = 2.3;
export const GRENADE_RADIUS = 6.5;
export const GRENADE_DAMAGE = 175;

/** Player throws along view; AI passes an explicit ballistic target. */
export function throwGrenade(w: SimWorld, a: Actor, target?: { x: number; z: number }): boolean {
  if (a.grenades <= 0 || a.throwTimer > 0 || !a.alive) return false;
  a.grenades -= 1;
  a.throwTimer = 0.75;
  const ey = a.y + eyeHeight(a);
  let vx: number;
  let vy: number;
  let vz: number;
  if (target) {
    const dx = target.x - a.x;
    const dz = target.z - a.z;
    const dist = Math.hypot(dx, dz);
    const g = w.gravity * 0.9;
    const speed = clamp(Math.sqrt(g * dist) * 1.02, 6, 19);
    // Low-arc solution if available, else 45°.
    const v2 = speed * speed;
    const disc = v2 * v2 - g * (g * dist * dist + 2 * (0 - ey + a.y) * v2);
    const angle = disc >= 0 ? Math.atan((v2 - Math.sqrt(disc)) / (g * Math.max(0.1, dist))) : Math.PI / 4;
    const h = Math.cos(angle) * speed;
    vx = (dx / Math.max(0.1, dist)) * h;
    vz = (dz / Math.max(0.1, dist)) * h;
    vy = Math.sin(angle) * speed;
  } else {
    dirFromYawPitch(a.yaw, a.pitch + 0.14, dirScratch);
    const speed = 17;
    vx = dirScratch.x * speed + a.vx * 0.5;
    vy = dirScratch.y * speed + 1.5;
    vz = dirScratch.z * speed + a.vz * 0.5;
  }
  const fwd = dirFromYawPitch(a.yaw, 0, dirScratch);
  const id = w.addProjectile(a, a.x + fwd.x * 0.45, ey - 0.1, a.z + fwd.z * 0.45, vx, vy, vz, a.team === 1 ? GRENADE_FUSE + 0.5 : GRENADE_FUSE);
  w.emit({ type: 'throw', actorId: a.id, projectileId: id });
  return true;
}
