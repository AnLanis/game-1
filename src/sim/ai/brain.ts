import type { EnemyDef } from '../../content/types';
import { angleDiff, clamp, dampAngle, DEG, pitchTo, yawTo } from '../../engine/math';
import { throwGrenade } from '../combat';
import { newRayHit } from '../grid';
import type { Point } from '../level';
import { eyeHeight } from '../movement';
import { Btn, type Actor, type BarkLine } from '../types';
import type { SimWorld } from '../world';

export type BrainState = 'idle' | 'patrol' | 'investigate' | 'combat' | 'search' | 'flee' | 'cower' | 'captive' | 'follow';
export type Tactic = 'cover' | 'advance' | 'flank' | 'rush' | 'hold' | 'retreat' | 'none';

export interface Brain {
  state: BrainState;
  tactic: Tactic;
  awareness: number;
  lastKnownX: number;
  lastKnownZ: number;
  lastSeenTick: number;
  canSee: boolean;
  investigateX: number;
  investigateZ: number;
  path: Point[] | null;
  pathIdx: number;
  goalX: number;
  goalZ: number;
  hasGoal: boolean;
  wantRepath: boolean;
  coverCell: number;
  atCover: boolean;
  coverHigh: boolean;
  peekTimer: number;
  peeking: boolean;
  thinkPhase: number;
  reaction: number;
  aimYaw: number;
  aimPitch: number;
  errYaw: number;
  errPitch: number;
  burstLeft: number;
  burstPause: number;
  shotsThisBurst: number;
  graceLeft: number;
  lastShotSeen: number;
  token: boolean;
  strafeDir: number;
  strafeTimer: number;
  stuckTimer: number;
  stuckTries: number;
  lastX: number;
  lastZ: number;
  homeX: number;
  homeZ: number;
  patrol: Point[];
  patrolIdx: number;
  waitTimer: number;
  lookTimer: number;
  lookYaw: number;
  panicTimer: number;
  telegraph: number;
  flanker: boolean;
  tacticTimer: number;
  searchTimer: number;
  escapeX: number;
  escapeZ: number;
  behavior: 'guard' | 'patrol' | 'hvt' | 'bodyguard';
  combatTick: number;
}

export function createBrain(a: Actor, patrol: Point[], behavior: Brain['behavior'], phase: number): Brain {
  return {
    state: patrol.length > 1 && behavior === 'patrol' ? 'patrol' : 'idle',
    tactic: 'none',
    awareness: 0,
    lastKnownX: a.x,
    lastKnownZ: a.z,
    lastSeenTick: -99999,
    canSee: false,
    investigateX: a.x,
    investigateZ: a.z,
    path: null,
    pathIdx: 0,
    goalX: a.x,
    goalZ: a.z,
    hasGoal: false,
    wantRepath: false,
    coverCell: -1,
    atCover: false,
    coverHigh: false,
    peekTimer: 0,
    peeking: true,
    thinkPhase: phase % 6,
    reaction: 0,
    aimYaw: a.yaw,
    aimPitch: 0,
    errYaw: 0,
    errPitch: 0,
    burstLeft: 0,
    burstPause: 0.5,
    shotsThisBurst: 0,
    graceLeft: 0,
    lastShotSeen: -1,
    token: false,
    strafeDir: 1,
    strafeTimer: 0,
    stuckTimer: 0,
    stuckTries: 0,
    lastX: a.x,
    lastZ: a.z,
    homeX: a.x,
    homeZ: a.z,
    patrol,
    patrolIdx: 0,
    waitTimer: 0,
    lookTimer: 0,
    lookYaw: a.yaw,
    panicTimer: 0,
    telegraph: 0,
    flanker: false,
    tacticTimer: 0,
    searchTimer: 0,
    escapeX: a.x,
    escapeZ: a.z,
    behavior,
    combatTick: -1,
  };
}

const ray = newRayHit();
const flowOut: Point = { x: 0, z: 0 };
const THINK_DT = 6 / 60;
/** Metres within which an HVT reacts to gunfire/explosions. */
const HVT_HEARING = 45;

/** Per-tick AI: perception + decisions at 10 Hz (staggered), steering/aim/fire every tick. */
export function updateBrain(w: SimWorld, a: Actor, dt: number): void {
  const br = a.brain!;
  const cmd = a.cmd;
  cmd.buttons = 0;
  cmd.slot = 0;
  if (a.kind === 'civilian' || a.kind === 'hostage') {
    updateCivilian(w, a, br, dt);
    return;
  }
  const def = w.enemyDef(a);
  if ((w.tick + br.thinkPhase) % 6 === 0) {
    perceive(w, a, br);
    decide(w, a, br, def);
  }
  steer(w, a, br, def, dt);
  aim(w, a, br, def, dt);
  shoot(w, a, br, def, dt);
}

// ---------------------------------------------------------------- perception

function perceive(w: SimWorld, a: Actor, br: Brain): void {
  const p = w.player;
  br.canSee = false;
  if (!p.alive) return;
  const dx = p.x - a.x;
  const dz = p.z - a.z;
  const dist = Math.hypot(dx, dz);
  let viewDist = w.viewDistance;
  if (w.flashlightOn) viewDist *= 1.5;
  if (dist > viewDist) {
    decayAwareness(br);
    return;
  }
  const facing = br.state === 'combat' ? br.aimYaw : a.yaw;
  const ang = Math.abs(angleDiff(facing, yawTo(a.x, a.z, p.x, p.z)));
  let rate = 0;
  if (ang < 55 * DEG) rate = 1;
  else if (ang < 100 * DEG) rate = 0.45;
  else if (dist < 3.5) rate = 0.8;
  if (br.state === 'combat' && dist < viewDist) rate = Math.max(rate, 0.6);
  if (rate <= 0) {
    decayAwareness(br);
    return;
  }
  const ey = a.y + eyeHeight(a);
  const grid = w.grid;
  const visible =
    grid.lineOfSight(a.x, ey, a.z, p.x, p.y + eyeHeight(p) - 0.05, p.z, ray) ||
    grid.lineOfSight(a.x, ey, a.z, p.x, p.y + p.height * 0.5, p.z, ray);
  if (!visible) {
    decayAwareness(br);
    return;
  }
  br.canSee = true;
  br.lastKnownX = p.x;
  br.lastKnownZ = p.z;
  br.lastSeenTick = w.tick;
  if (br.state === 'combat') {
    br.awareness = 1;
    return;
  }
  const distFactor = clamp(1.8 - dist / 35, 0.35, 1.8);
  let stance = p.crouch > 0.5 ? 0.55 : p.sprinting ? 1.4 : 1;
  if (p.radarUntil > w.tick) stance *= 2.5;
  if (w.flashlightOn) stance *= 1.5;
  const primed = br.state === 'investigate' || br.state === 'search' ? 1.8 : 1;
  br.awareness += THINK_DT * 1.6 * rate * distFactor * stance * primed;
  if (br.awareness >= 1) enterCombat(w, a, br, true);
}

function decayAwareness(br: Brain): void {
  if (br.state !== 'combat') br.awareness = Math.max(0, br.awareness - THINK_DT * 0.18);
}

export function enterCombat(w: SimWorld, a: Actor, br: Brain, spotted: boolean): void {
  if (br.state === 'combat') return;
  if (br.behavior === 'hvt') {
    br.state = 'flee';
    br.tactic = 'retreat';
    setGoal(br, br.escapeX, br.escapeZ);
    w.bark(a, 'fleeing', true);
    w.alertNearby(a, 30, 18);
    return;
  }
  const first = br.combatTick < 0;
  br.state = 'combat';
  br.awareness = 1;
  br.combatTick = w.tick;
  br.tacticTimer = 0;
  br.reaction = w.difficulty.reaction * (a.kind === 'enemy' && w.enemyDef(a).role === 'marksman' ? 1.3 : 1) * (0.8 + w.aiRng.next() * 0.4);
  if (!spotted) br.reaction += 0.25;
  if (first) br.graceLeft = w.difficulty.graceShots;
  w.emit({ type: 'alert', actorId: a.id });
  if (spotted) {
    w.bark(a, 'contact');
    w.alertNearby(a, 26, 36);
  }
}

/** A sound was heard (gunshot, explosion, footsteps). */
export function hear(w: SimWorld, a: Actor, x: number, z: number, sourceId: number): void {
  const br = a.brain;
  if (!br || !a.alive) return;
  if (a.kind === 'civilian') {
    panicCivilian(w, a, br, x, z);
    return;
  }
  if (a.kind !== 'enemy') return;
  // A high-value target only reacts to trouble it can plausibly hear (a gunshot across the
  // whole map must not start his escape countdown while the player is 80+ m away).
  if (br.behavior === 'hvt' && Math.hypot(x - a.x, z - a.z) > HVT_HEARING) return;
  const src = w.actorById(sourceId);
  if (src && src.team === 1) {
    // Ally fire: get curious, and if they're in combat so are we.
    if (src.brain?.state === 'combat') {
      br.lastKnownX = src.brain.lastKnownX;
      br.lastKnownZ = src.brain.lastKnownZ;
      enterCombat(w, a, br, false);
    } else if (br.state !== 'combat') investigate(br, x, z);
    return;
  }
  if (br.state === 'combat') {
    if (!br.canSee) {
      br.lastKnownX = x + (w.aiRng.next() - 0.5) * 4;
      br.lastKnownZ = z + (w.aiRng.next() - 0.5) * 4;
    }
    return;
  }
  if (br.behavior === 'hvt') {
    enterCombat(w, a, br, false);
    return;
  }
  br.awareness = Math.max(br.awareness, 0.55);
  br.lastKnownX = x;
  br.lastKnownZ = z;
  if (Math.hypot(x - a.x, z - a.z) < 22) enterCombat(w, a, br, false);
  else investigate(br, x, z);
}

function investigate(br: Brain, x: number, z: number): void {
  br.state = 'investigate';
  br.investigateX = x;
  br.investigateZ = z;
  br.searchTimer = 8;
  setGoal(br, x, z);
}

export function onDamaged(w: SimWorld, a: Actor, source: Actor | null): void {
  const br = a.brain;
  if (!br) return;
  if (a.kind === 'civilian') {
    if (source) panicCivilian(w, a, br, source.x, source.z);
    return;
  }
  if (source && source.team !== a.team) {
    br.lastKnownX = source.x;
    br.lastKnownZ = source.z;
    br.lastSeenTick = w.tick;
  }
  a.fear = Math.min(1, a.fear + 0.3);
  if (br.state !== 'combat') enterCombat(w, a, br, false);
  else if (w.aiRng.next() < 0.3) w.bark(a, 'takingfire');
  // Getting shot at cover without being able to shoot back → relocate soon.
  if (br.atCover && !br.canSee) br.tacticTimer = Math.min(br.tacticTimer, 0.3);
}

// ------------------------------------------------------------------ decisions

function decide(w: SimWorld, a: Actor, br: Brain, def: EnemyDef): void {
  const p = w.player;
  a.fear = Math.max(0, a.fear - THINK_DT * 0.35);
  if (a.fear > 0.85 && br.state === 'combat' && br.panicTimer <= 0 && def.role !== 'heavy' && w.aiRng.next() < 0.25) {
    br.panicTimer = 2.5 + w.aiRng.next() * 2;
    br.tacticTimer = 0;
  }
  if (br.panicTimer > 0) br.panicTimer -= THINK_DT;

  switch (br.state) {
    case 'idle': {
      br.lookTimer -= THINK_DT;
      if (br.lookTimer <= 0) {
        br.lookTimer = 2 + w.aiRng.next() * 3;
        br.lookYaw = a.yaw + (w.aiRng.next() - 0.5) * 2.2;
      }
      if (br.behavior === 'bodyguard' || br.behavior === 'hvt') {
        // Loiter near home.
        if (Math.hypot(a.x - br.homeX, a.z - br.homeZ) > 3) setGoal(br, br.homeX, br.homeZ);
      }
      return;
    }
    case 'patrol': {
      if (br.waitTimer > 0) {
        br.waitTimer -= THINK_DT;
        return;
      }
      const target = br.patrol[br.patrolIdx];
      if (!target) {
        br.state = 'idle';
        return;
      }
      if (Math.hypot(target.x - a.x, target.z - a.z) < 1) {
        br.patrolIdx = (br.patrolIdx + 1) % br.patrol.length;
        br.waitTimer = 1 + w.aiRng.next() * 2.5;
        br.hasGoal = false;
      } else if (!br.hasGoal) setGoal(br, target.x, target.z);
      return;
    }
    case 'investigate': {
      br.searchTimer -= THINK_DT;
      if (!br.hasGoal || Math.hypot(br.investigateX - a.x, br.investigateZ - a.z) < 1.5) {
        br.hasGoal = false;
        br.lookTimer -= THINK_DT;
        if (br.lookTimer <= 0) {
          br.lookTimer = 1.2;
          br.lookYaw = a.yaw + (w.aiRng.next() - 0.5) * 3;
        }
      }
      if (br.searchTimer <= 0) {
        br.state = br.patrol.length > 1 ? 'patrol' : 'idle';
        br.awareness = 0.3;
        setGoal(br, br.homeX, br.homeZ);
      }
      return;
    }
    case 'search': {
      br.searchTimer -= THINK_DT;
      if (br.canSee) {
        br.state = 'combat';
        return;
      }
      if (br.searchTimer <= 0) {
        br.state = 'investigate';
        br.searchTimer = 6;
      }
      return;
    }
    case 'flee': {
      if (!br.hasGoal) setGoal(br, br.escapeX, br.escapeZ);
      return;
    }
    case 'combat':
      break;
    default:
      return;
  }

  // ---- combat ----
  if (!p.alive) return;
  const dist = Math.hypot(p.x - a.x, p.z - a.z);
  const sinceSeen = (w.tick - br.lastSeenTick) / 60;
  br.tacticTimer -= THINK_DT;

  if (sinceSeen > 12) {
    br.state = 'search';
    br.searchTimer = 10;
    br.tactic = 'none';
    releaseCover(w, a, br);
    setGoal(br, br.lastKnownX, br.lastKnownZ);
    w.bark(a, 'lost');
    return;
  }

  // Grenades: flush out a camping player we can't see.
  if (
    def.grenade > 0 &&
    a.grenades > 0 &&
    !br.canSee &&
    sinceSeen > 1.2 &&
    sinceSeen < 9 &&
    w.playerCampTime > 2.5 &&
    w.director.canGrenade()
  ) {
    const gd = Math.hypot(br.lastKnownX - a.x, br.lastKnownZ - a.z);
    if (gd > 7 && gd < 30 && w.aiRng.next() < def.grenade * 0.35) {
      if (throwGrenade(w, a, { x: br.lastKnownX, z: br.lastKnownZ })) {
        w.director.grenadeUsed();
        w.bark(a, 'grenade', true);
        return;
      }
    }
  }

  // Morale: panic briefly when frightened or the squad leader died.
  if (br.panicTimer > 0) {
    if (br.tactic !== 'retreat') chooseCover(w, a, br, def, 'retreat');
    return;
  }

  if (br.tacticTimer > 0 && br.tactic !== 'none' && !br.wantRepath) {
    // Keep current plan; refresh rush goals.
    if (br.tactic === 'rush' && br.canSee) setGoal(br, p.x, p.z);
    return;
  }

  const role = def.role;
  const [minR, maxR] = def.range;
  br.tacticTimer = 2.5 + w.aiRng.next() * 2;

  if (role === 'rusher' || role === 'breacher' || (role === 'heavy' && dist > maxR * 0.6)) {
    if (br.flanker && dist > 14) {
      chooseFlank(w, a, br, def);
    } else {
      br.tactic = 'rush';
      releaseCover(w, a, br);
      if (dist > minR) setGoal(br, p.x, p.z);
      else br.hasGoal = false;
    }
    return;
  }

  if (role === 'heavy') {
    br.tactic = 'advance';
    releaseCover(w, a, br);
    if (!br.canSee || dist > maxR) setGoal(br, p.x, p.z);
    else br.hasGoal = false;
    return;
  }

  if (br.flanker && dist > 12 && w.aiRng.next() < 0.7) {
    chooseFlank(w, a, br, def);
    return;
  }

  // Cover-based roles: rifleman, grenadier, marksman, officer.
  const tooClose = dist < minR * 0.8;
  const tooFar = dist > maxR * 1.15 || (sinceSeen > 3.5 && br.atCover);
  if (br.atCover && br.canSee && !tooClose && !tooFar && a.fear < 0.8) {
    br.tactic = 'cover';
    return;
  }
  if (tooClose && role === 'marksman') chooseCover(w, a, br, def, 'retreat');
  else if (tooFar) chooseCover(w, a, br, def, 'advance');
  else chooseCover(w, a, br, def, 'cover');
}

function chooseFlank(w: SimWorld, a: Actor, br: Brain, def: EnemyDef): void {
  const p = w.player;
  br.tactic = 'flank';
  releaseCover(w, a, br);
  // Pick a point ~90° off the player's facing, at mid range, not visible from the player.
  const side = w.aiRng.next() < 0.5 ? -1 : 1;
  const r = clamp((def.range[0] + def.range[1]) / 2, 6, 16);
  const base = p.yaw + side * (Math.PI / 2 + (w.aiRng.next() - 0.5) * 0.6);
  let best: Point | null = null;
  for (let tries = 0; tries < 6; tries += 1) {
    const ang = base + (tries - 2.5) * 0.25;
    const x = p.x - Math.sin(ang) * r;
    const z = p.z - Math.cos(ang) * r;
    const k = w.nav.nearestWalkable(w.grid.cellX(x), w.grid.cellZ(z), 3);
    if (k < 0 || !w.nav.reachable[k]) continue;
    const i = k % w.grid.w;
    const cx = w.grid.centerX(i);
    const cz = w.grid.centerZ((k - i) / w.grid.w);
    best = { x: cx, z: cz };
    break;
  }
  if (!best) {
    br.tactic = 'rush';
    setGoal(br, p.x, p.z);
    return;
  }
  setGoal(br, best.x, best.z);
  w.bark(a, 'flanking');
  br.tacticTimer = 5;
}

function releaseCover(w: SimWorld, a: Actor, br: Brain): void {
  if (br.coverCell >= 0) w.nav.releaseCover(a.id);
  br.coverCell = -1;
  br.atCover = false;
}

/** Score cover points around us relative to the threat and move to the best one. */
function chooseCover(w: SimWorld, a: Actor, br: Brain, def: EnemyDef, mode: 'cover' | 'advance' | 'retreat'): void {
  const nav = w.nav;
  nav.refreshCovers();
  const tx = br.lastKnownX;
  const tz = br.lastKnownZ;
  const [minR, maxR] = def.range;
  const ideal = mode === 'retreat' ? maxR : mode === 'advance' ? (minR + maxR) * 0.45 : (minR + maxR) * 0.5;
  const myDist = Math.hypot(tx - a.x, tz - a.z);
  let best = -1;
  let bestScore = -Infinity;
  const covers = nav.covers;
  const searchR = mode === 'advance' ? 22 : 16;
  const grid = w.grid;
  let checked = 0;
  for (let n = 0; n < covers.length; n += 1) {
    const c = covers[n];
    if (c.reservedBy >= 0 && c.reservedBy !== a.id) continue;
    const dSelf = Math.hypot(c.x - a.x, c.z - a.z);
    if (dSelf > searchR) continue;
    const dx = tx - c.x;
    const dz = tz - c.z;
    const dThreat = Math.hypot(dx, dz);
    if (dThreat < 4) continue;
    const ux = dx / dThreat;
    const uz = dz / dThreat;
    let protect = 0;
    for (const [cx, cz] of c.dirs) protect = Math.max(protect, cx * ux + cz * uz);
    if (protect < 0.55) continue;
    let score = protect * 3 - Math.abs(dThreat - ideal) * 0.18 - dSelf * 0.12;
    if (mode === 'advance' && dThreat > myDist - 3) score -= 6;
    if (mode === 'retreat' && dThreat < myDist) score -= 6;
    // Prefer low cover (can peek) for shooters; spread the squad out.
    if (c.height < 1.6) score += 1.2;
    for (const o of w.actors) {
      if (o !== a && o.alive && o.team === 1 && Math.hypot(o.x - c.x, o.z - c.z) < 2.2) score -= 2;
    }
    if (score <= bestScore) continue;
    // Peek check: standing eye must see the threat for low cover.
    if (c.height < 1.6 && checked < 10) {
      checked += 1;
      if (!grid.lineOfSight(c.x, 1.55, c.z, tx, 1.2, tz, ray)) score -= 2.5;
    }
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }
  releaseCover(w, a, br);
  br.tactic = mode === 'cover' ? 'cover' : mode;
  if (best < 0) {
    // No cover: hold ground or push toward the band.
    br.tactic = 'advance';
    if (myDist > maxR) setGoal(br, tx, tz);
    else br.hasGoal = false;
    return;
  }
  const c = covers[best];
  c.reservedBy = a.id;
  br.coverCell = c.cell;
  br.coverHigh = c.height >= 1.6;
  br.peekTimer = 1 + w.aiRng.next();
  setGoal(br, c.x, c.z);
  if (mode === 'advance') w.bark(a, 'moving');
}

export function setGoal(br: Brain, x: number, z: number): void {
  if (br.hasGoal && Math.hypot(br.goalX - x, br.goalZ - z) < 1.2 && br.path) return;
  br.goalX = x;
  br.goalZ = z;
  br.hasGoal = true;
  br.wantRepath = true;
  br.path = null;
  br.pathIdx = 0;
  br.atCover = false;
}

// ------------------------------------------------------------------- steering

function steer(w: SimWorld, a: Actor, br: Brain, def: EnemyDef, dt: number): void {
  const cmd = a.cmd;
  cmd.moveF = 0;
  cmd.moveR = 0;
  let dirX = 0;
  let dirZ = 0;
  let remaining = 0;

  if (br.hasGoal) {
    if (br.wantRepath && w.director.requestPath()) {
      br.wantRepath = false;
      br.path = w.nav.findPath(a.x, a.z, br.goalX, br.goalZ);
      w.director.spendPath(w.nav.lastExpanded);
      br.pathIdx = 0;
      if (!br.path) {
        br.hasGoal = false;
        br.tacticTimer = 0;
      }
    }
    if (br.path) {
      let wp = br.path[br.pathIdx];
      while (wp && Math.hypot(wp.x - a.x, wp.z - a.z) < 0.45 && br.pathIdx < br.path.length - 1) {
        br.pathIdx += 1;
        wp = br.path[br.pathIdx];
      }
      if (wp) {
        const dx = wp.x - a.x;
        const dz = wp.z - a.z;
        const d = Math.hypot(dx, dz);
        remaining = Math.hypot(br.goalX - a.x, br.goalZ - a.z);
        if (br.pathIdx === br.path.length - 1 && d < 0.4) {
          br.hasGoal = false;
          br.path = null;
          if (br.coverCell >= 0) br.atCover = true;
        } else if (d > 1e-3) {
          dirX = dx / d;
          dirZ = dz / d;
        }
      }
    } else if (br.tactic === 'rush' && w.nav.flowDir(a.x, a.z, flowOut)) {
      // Path budget exhausted: follow the shared flow field toward the player.
      dirX = flowOut.x;
      dirZ = flowOut.z;
      remaining = 10;
    }
  }

  // Close-range strafing for aggressive roles while shooting.
  const p = w.player;
  const dist = Math.hypot(p.x - a.x, p.z - a.z);
  if (br.state === 'combat' && br.canSee && (def.role === 'rusher' || def.role === 'breacher' || def.role === 'heavy')) {
    br.strafeTimer -= dt;
    if (br.strafeTimer <= 0) {
      br.strafeTimer = 0.6 + w.aiRng.next() * 0.9;
      br.strafeDir = w.aiRng.next() < 0.5 ? -1 : 1;
    }
    if (dist < def.range[1]) {
      const ux = (p.x - a.x) / (dist || 1);
      const uz = (p.z - a.z) / (dist || 1);
      const k = dist < def.range[0] ? -0.4 : 0.35;
      dirX = dirX * 0.4 + (-uz * br.strafeDir + ux * k) * 0.8;
      dirZ = dirZ * 0.4 + (ux * br.strafeDir + uz * k) * 0.8;
    }
  }

  // Stuck detection.
  const moved = Math.hypot(a.x - br.lastX, a.z - br.lastZ);
  if ((dirX !== 0 || dirZ !== 0) && moved < 0.8 * dt) {
    br.stuckTimer += dt;
    if (br.stuckTimer > 0.9) {
      br.stuckTimer = 0;
      br.stuckTries += 1;
      br.wantRepath = true;
      if (br.stuckTries > 3) {
        br.hasGoal = false;
        br.stuckTries = 0;
        br.tacticTimer = 0;
      }
    }
  } else {
    br.stuckTimer = Math.max(0, br.stuckTimer - dt);
    if (moved > 0.02) br.stuckTries = 0;
  }
  br.lastX = a.x;
  br.lastZ = a.z;

  const l = Math.hypot(dirX, dirZ);
  if (l > 1e-3) {
    dirX /= l;
    dirZ /= l;
    // Convert world direction into the actor's local frame.
    const sy = Math.sin(a.yaw);
    const cy = Math.cos(a.yaw);
    cmd.moveF = dirX * -sy + dirZ * -cy;
    cmd.moveR = dirX * cy + dirZ * -sy;
    const fleeing = br.state === 'flee' || br.tactic === 'retreat';
    const relaxed = br.state === 'patrol' || br.state === 'idle';
    if (!relaxed && (remaining > 6 || fleeing) && (!br.canSee || fleeing || def.role === 'rusher')) cmd.buttons |= Btn.Sprint;
    if (relaxed) {
      // Actor walkSpeed is the combat jog; patrols stroll at the def's walk speed.
      const k = Math.min(1, def.walkSpeed / Math.max(0.1, a.walkSpeed));
      cmd.moveF *= k;
      cmd.moveR *= k;
    }
  }

  // Crouch behind low cover between peeks.
  if (br.atCover && br.state === 'combat') {
    br.peekTimer -= dt;
    if (br.peekTimer <= 0) {
      br.peeking = !br.peeking;
      br.peekTimer = br.peeking ? 1.6 + w.aiRng.next() * 1.6 : 0.9 + w.aiRng.next() * 1.4;
      if (!br.peeking && a.fear > 0.5) br.peekTimer += 1;
    }
    const slot = a.weapons[a.current];
    const reloading = slot && slot.reloadTimer > 0;
    if (!br.coverHigh && (!br.peeking || reloading)) cmd.buttons |= Btn.Crouch;
  }
}

// ------------------------------------------------------------------------ aim

function aim(w: SimWorld, a: Actor, br: Brain, def: EnemyDef, dt: number): void {
  const p = w.player;
  const cmd = a.cmd;
  const sinceSeen = (w.tick - br.lastSeenTick) / 60;
  let targetYaw = a.yaw;
  let targetPitch = 0;
  let turn = def.role === 'heavy' ? 5 : 9;

  if (br.state === 'combat' && p.alive && (br.canSee || sinceSeen < 1.5)) {
    const ey = a.y + eyeHeight(a);
    const headshot = def.role === 'marksman' && (a.variant & 3) === 0;
    const ty = p.y + (headshot ? eyeHeight(p) : p.height * 0.62);
    const tx = br.canSee ? p.x : br.lastKnownX;
    const tz = br.canSee ? p.z : br.lastKnownZ;
    const burstMult = 1.5 - 0.75 * Math.min(1, br.shotsThisBurst / 5);
    targetYaw = yawTo(a.x, a.z, tx, tz) + br.errYaw * burstMult;
    targetPitch = pitchTo({ x: a.x, y: ey, z: a.z }, { x: tx, y: ty, z: tz }) + br.errPitch * burstMult;
    turn = def.role === 'heavy' ? 6 : 12;
  } else if (br.state === 'combat' || br.state === 'search') {
    targetYaw = moveYaw(a, br) ?? yawTo(a.x, a.z, br.lastKnownX, br.lastKnownZ);
  } else if (br.hasGoal) {
    targetYaw = moveYaw(a, br) ?? a.yaw;
  } else {
    targetYaw = br.lookYaw;
    turn = 2.5;
  }
  br.aimYaw = dampAngle(br.aimYaw, targetYaw, turn, dt);
  br.aimPitch = dampAngle(br.aimPitch, clamp(targetPitch, -1.2, 1.2), turn, dt);
  cmd.yaw = br.aimYaw;
  cmd.pitch = br.aimPitch;
}

function moveYaw(a: Actor, br: Brain): number | null {
  if (!br.path) return null;
  const wp = br.path[br.pathIdx];
  if (!wp) return null;
  if (Math.hypot(wp.x - a.x, wp.z - a.z) < 0.2) return null;
  return yawTo(a.x, a.z, wp.x, wp.z);
}

// ---------------------------------------------------------------------- shoot

function rerollError(w: SimWorld, a: Actor, br: Brain, def: EnemyDef): void {
  const p = w.player;
  const pSpeed = Math.hypot(p.vx, p.vz);
  let mag = def.aimError * w.difficulty.aimError;
  mag *= 1 + (pSpeed / 6) * 0.6;
  if (p.crouch > 0.5) mag *= 1.12;
  mag *= 1 + a.fear * 0.8;
  if (br.panicTimer > 0) mag *= 1.8;
  br.errYaw = w.aiRng.gaussian() * mag * 0.7;
  br.errPitch = w.aiRng.gaussian() * mag * 0.45;
  if (br.graceLeft > 0) {
    const s = w.aiRng.next() < 0.5 ? -1 : 1;
    br.errYaw = s * (2.6 * DEG + mag);
    br.errPitch = (w.aiRng.next() - 0.3) * 1.5 * DEG;
  }
}

function shoot(w: SimWorld, a: Actor, br: Brain, def: EnemyDef, dt: number): void {
  const cmd = a.cmd;
  const slot = a.weapons[a.current];
  if (!slot) return;

  // Track shots actually fired last tick.
  if (slot.lastShotTick !== br.lastShotSeen && slot.lastShotTick >= w.tick - 1) {
    br.lastShotSeen = slot.lastShotTick;
    br.burstLeft = Math.max(0, br.burstLeft - 1);
    br.shotsThisBurst += 1;
    if (br.graceLeft > 0) {
      br.graceLeft -= 1;
      rerollError(w, a, br, def);
    }
    if (br.burstLeft === 0) {
      br.burstPause = w.aiRng.range(def.burstPause[0], def.burstPause[1]);
      if (br.panicTimer > 0) br.burstPause *= 1.6;
    }
  }

  // Reload when dry, or topping off when safe.
  if (slot.mag === 0 || (slot.mag < slot.def.magSize * 0.3 && !br.canSee)) {
    if (slot.reloadTimer <= 0 && slot.reserve > 0) {
      cmd.buttons |= Btn.Reload;
      if (br.canSee && w.aiRng.next() < 0.4) w.bark(a, 'reloading');
    }
    return;
  }

  a.laser = Math.max(0, a.laser - dt);
  if (br.state !== 'combat' || !br.canSee || !w.player.alive) {
    br.telegraph = 0;
    a.laser = 0;
    return;
  }
  if (br.reaction > 0) {
    br.reaction -= dt;
    return;
  }
  if (!br.token) {
    br.telegraph = 0;
    return;
  }
  if (br.atCover && !br.peeking && !br.coverHigh) return;
  if (br.burstPause > 0) {
    br.burstPause -= dt;
    return;
  }
  if (br.burstLeft <= 0) {
    br.burstLeft = w.aiRng.int(def.burst[0], def.burst[1]);
    br.shotsThisBurst = 0;
    rerollError(w, a, br, def);
    if (def.telegraph) {
      br.telegraph = def.telegraph;
      a.laser = def.telegraph + 0.2;
      w.emit({ type: 'laser', actorId: a.id });
    }
  }
  if (br.telegraph > 0) {
    br.telegraph -= dt;
    return;
  }
  // Only fire when roughly on target.
  const p = w.player;
  const ideal = yawTo(a.x, a.z, p.x, p.z);
  if (Math.abs(angleDiff(br.aimYaw, ideal)) > 12 * DEG + Math.abs(br.errYaw) * 1.6) return;
  if (slot.def.auto) cmd.buttons |= Btn.Fire;
  else if ((a.prevButtons & Btn.Fire) === 0 && slot.cooldown <= 0) cmd.buttons |= Btn.Fire;
}

// ------------------------------------------------------------------ civilians

function panicCivilian(w: SimWorld, a: Actor, br: Brain, x: number, z: number): void {
  if (a.kind !== 'civilian' || br.state === 'cower') return;
  br.state = 'flee';
  br.panicTimer = 6 + w.aiRng.next() * 4;
  const dx = a.x - x;
  const dz = a.z - z;
  const d = Math.hypot(dx, dz) || 1;
  setGoal(br, a.x + (dx / d) * 14 + (w.aiRng.next() - 0.5) * 6, a.z + (dz / d) * 14 + (w.aiRng.next() - 0.5) * 6);
}

function updateCivilian(w: SimWorld, a: Actor, br: Brain, dt: number): void {
  const cmd = a.cmd;
  const p = w.player;
  if (a.kind === 'hostage') {
    if (a.followId < 0) {
      br.state = 'captive';
      cmd.buttons |= Btn.Crouch;
      cmd.moveF = 0;
      cmd.moveR = 0;
      cmd.yaw = a.yaw;
      return;
    }
    br.state = 'follow';
    const d = Math.hypot(p.x - a.x, p.z - a.z);
    if ((w.tick + br.thinkPhase) % 12 === 0 && d > 2.6) setGoal(br, p.x, p.z);
    if (d < 2.2) br.hasGoal = false;
  } else if (br.state === 'flee') {
    br.panicTimer -= dt;
    if (!br.hasGoal || br.panicTimer <= 0) {
      br.state = 'cower';
      br.waitTimer = 8 + w.aiRng.next() * 10;
    }
  } else if (br.state === 'cower') {
    cmd.buttons |= Btn.Crouch;
    br.waitTimer -= dt;
    if (br.waitTimer <= 0) br.state = 'idle';
  } else if ((w.tick + br.thinkPhase) % 60 === 0 && !br.hasGoal) {
    // Wander around home.
    const ang = w.aiRng.next() * Math.PI * 2;
    const r = 2 + w.aiRng.next() * 6;
    const k = w.nav.nearestWalkable(w.grid.cellX(br.homeX + Math.cos(ang) * r), w.grid.cellZ(br.homeZ + Math.sin(ang) * r), 2);
    if (k >= 0 && w.aiRng.next() < 0.5) {
      const i = k % w.grid.w;
      setGoal(br, w.grid.centerX(i), w.grid.centerZ((k - i) / w.grid.w));
    }
  }
  // Reuse steering with a neutral enemy-like profile.
  steerCivilian(w, a, br);
}

function steerCivilian(w: SimWorld, a: Actor, br: Brain): void {
  const cmd = a.cmd;
  cmd.moveF = 0;
  cmd.moveR = 0;
  if (!br.hasGoal) {
    cmd.yaw = a.yaw;
    return;
  }
  if (br.wantRepath && w.director.requestPath()) {
    br.wantRepath = false;
    br.path = w.nav.findPath(a.x, a.z, br.goalX, br.goalZ, 2500);
    w.director.spendPath(w.nav.lastExpanded);
    br.pathIdx = 0;
    if (!br.path) br.hasGoal = false;
  }
  if (!br.path) return;
  let wp = br.path[br.pathIdx];
  while (wp && Math.hypot(wp.x - a.x, wp.z - a.z) < 0.45 && br.pathIdx < br.path.length - 1) {
    br.pathIdx += 1;
    wp = br.path[br.pathIdx];
  }
  if (!wp) return;
  const d = Math.hypot(wp.x - a.x, wp.z - a.z);
  if (br.pathIdx === br.path.length - 1 && d < 0.4) {
    br.hasGoal = false;
    br.path = null;
    return;
  }
  const yaw = yawTo(a.x, a.z, wp.x, wp.z);
  cmd.yaw = dampAngle(a.yaw, yaw, 8, 1 / 60);
  cmd.moveF = Math.max(0, Math.cos(angleDiff(cmd.yaw, yaw)));
  const run = br.state === 'flee' || (a.kind === 'hostage' && Math.hypot(w.player.x - a.x, w.player.z - a.z) > 6);
  if (run) cmd.buttons |= Btn.Sprint;
}

export const barkLines: Record<BarkLine, string[]> = {
  contact: ['Contact!', 'Enemy spotted!', 'There he is!', 'Hostile, front!'],
  reloading: ['Reloading!', 'Changing mag!', 'Cover me, reloading!'],
  grenade: ['Frag out!', 'Grenade!', 'Flush him out!'],
  flanking: ['Flanking!', 'Moving around the side!', "I'll take the left!"],
  mandown: ['Man down!', "We've lost one!", 'He got Rafi!'],
  takingfire: ['Taking fire!', "I'm hit!", 'Suppressing fire!'],
  lost: ['Lost visual!', 'Where did he go?', 'Anyone see him?'],
  moving: ['Moving up!', 'Pushing forward!', 'Advancing!'],
  suppressing: ['Keep his head down!', 'Suppressing!'],
  fleeing: ['Get me out of here!', 'Protect me!', 'Fall back!'],
  playerReloading: ["He's reloading, push!", 'He is dry, go go!'],
  heavy: ['Heavy coming through!', "Let's see you try."],
  surrender: ['Pull back!', 'Retreat!', 'Fall back, fall back!'],
};
