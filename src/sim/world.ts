import { Biomes, Difficulties, Enemies, Factions, Perks, resolveWeapon } from '../content';
import type { BiomeDef, DifficultyDef, EnemyDef, PerkDef } from '../content/types';
import { clamp, q } from '../engine/math';
import { hashString, mixSeed, Rng } from '../engine/rng';
import { createBrain, enterCombat, hear, onDamaged as brainDamaged, updateBrain, type Brain } from './ai/brain';
import { Director } from './ai/director';
import { applyDamage, explode, updateWeapons } from './combat';
import { CellFlag, type Grid } from './grid';
import type { LevelData, Point } from './level';
import type { MissionConfig } from './mission';
import { eyeHeight, moveActor, Separation } from './movement';
import { NavGrid } from './nav';
import { Objectives, type ObjectiveMarker } from './objectives';
import { Scoring } from './scoring';
import { Btn, emptyCmd, type Actor, type ActorKind, type BarkLine, type HitZone, type InputCmd, type Interactable, type Pickup, type Projectile, type SimEvent, type Team, type WeaponSlot } from './types';

declare module './types' {
  interface Actor {
    brain?: Brain;
  }
}

export const DT = 1 / 60;
const MAX_BODIES = 40;
const MAX_EVENTS = 6000;

interface PendingExplosion {
  x: number;
  y: number;
  z: number;
  delay: number;
  sourceId: number;
  radius: number;
  damage: number;
  barrel: boolean;
}

interface PendingAlert {
  actorId: number;
  tick: number;
  x: number;
  z: number;
}

export type MissionStatus = 'running' | 'success' | 'failed';

/**
 * The authoritative simulation. Pure TypeScript: no DOM, no Three.js, no
 * Math.random, no wall clock. Advance with step(cmd); read state; drain
 * events for presentation. Same seed + same command stream ⇒ same hash.
 */
export class SimWorld {
  readonly config: MissionConfig;
  readonly level: LevelData;
  readonly grid: Grid;
  readonly nav: NavGrid;
  readonly biome: BiomeDef;
  readonly difficulty: DifficultyDef;
  readonly perk: PerkDef | undefined;
  readonly rng: Rng;
  readonly aiRng: Rng;
  readonly actors: Actor[] = [];
  readonly projectiles: Projectile[] = [];
  readonly pickups: Pickup[] = [];
  readonly interactables: Interactable[] = [];
  readonly director: Director;
  readonly scoring: Scoring;
  readonly objectives: Objectives;
  readonly events: SimEvent[] = [];
  readonly player: Actor;
  readonly gravity: number;
  readonly viewDistance: number;
  readonly flashlightOn: boolean;
  readonly playerExplosiveResist: number;
  tick = 0;
  shotSerial = 0;
  status: MissionStatus = 'running';
  endReason = '';
  endTick = 0;
  invulnerable = false;
  hpScale = 1;
  playerCampTime = 0;
  /** Interactable the player can currently use (-1 none). */
  promptId = -1;
  private nextId = 1;
  private readonly separation = new Separation();
  private readonly pendingExplosions: PendingExplosion[] = [];
  private readonly pendingAlerts: PendingAlert[] = [];
  private readonly modifiers: Set<string>;
  private readonly enemyDefCache = new Map<string, EnemyDef>();
  private campX = 0;
  private campZ = 0;
  private lastBarkTick = -999;
  private readonly squadBarkTick = new Map<number, number>();
  private explodingBarrel = false;
  private readonly markerScratch: ObjectiveMarker[] = [];

  constructor(config: MissionConfig) {
    this.config = config;
    this.level = config.level;
    this.grid = config.level.grid;
    this.biome = Biomes.get(config.biomeId);
    this.difficulty = Difficulties.get(config.difficultyId);
    this.perk = Perks.maybe(config.loadout.perk);
    this.modifiers = new Set(config.modifiers);
    this.rng = new Rng(mixSeed(config.seed, hashString(config.recordKey)));
    this.aiRng = this.rng.fork('ai');
    this.gravity = this.hasModifier('lowgrav') ? this.biome.gravity * 0.4 : this.biome.gravity;
    const baseView = this.biome.time === 'night' ? 42 : this.biome.time === 'dusk' ? 62 : 78;
    this.viewDistance = baseView * (this.hasModifier('fog') ? 0.6 : 1) * (this.biome.weather === 'snow' ? 0.8 : 1);
    this.flashlightOn = this.biome.flashlight;
    this.playerExplosiveResist = this.perk?.mods.explosiveResist ?? 1;

    this.nav = new NavGrid(this.grid);
    const spawn = this.level.playerSpawn;
    this.nav.computeReachable(spawn.x, spawn.z);

    this.player = this.createPlayer();
    this.campX = this.player.x;
    this.campZ = this.player.z;

    this.director = new Director(this);
    this.scoring = new Scoring(this);

    let squadId = 0;
    for (const squad of this.level.squads) {
      squadId += 1;
      squad.members.forEach((defId, n) => {
        const ang = (n / Math.max(1, squad.members.length)) * Math.PI * 2;
        const r = n === 0 ? 0 : 1.3;
        const x = squad.x + Math.cos(ang) * r;
        const z = squad.z + Math.sin(ang) * r;
        const pos = this.walkablePoint(x, z) ?? { x: squad.x, z: squad.z };
        const tag = squad.behavior === 'hvt' && n === 0 ? 'hvt' : squad.behavior === 'hvt' ? 'bodyguard' : 'initial';
        const behavior = squad.behavior === 'hvt' ? (n === 0 ? 'hvt' : 'bodyguard') : n === 0 || squad.behavior === 'guard' ? squad.behavior : 'guard';
        const a = this.spawnEnemy(defId, pos.x, pos.z, tag, behavior, squad.behavior === 'patrol' && n === 0 ? squad.patrol : [], squadId);
        a.yaw = this.aiRng.range(-Math.PI, Math.PI);
        a.brain!.aimYaw = a.yaw;
        a.brain!.lookYaw = a.yaw;
        if (behavior === 'hvt') {
          const esc = this.farthestReinforcement(a.x, a.z);
          a.brain!.escapeX = esc.x;
          a.brain!.escapeZ = esc.z;
        }
      });
    }
    // Patrol followers trail their leader's route loosely.
    for (const squad of this.level.squads) void squad;

    for (const c of this.level.civilians) this.spawnCivilian(c.x, c.z);
    for (const p of this.level.pickups) this.addPickup(p.kind, p.x, p.z, 0);

    this.objectives = new Objectives(this, config.objectives);
    this.objectives.start();
  }

  // ------------------------------------------------------------------ helpers

  hasModifier(id: string): boolean {
    return this.modifiers.has(id);
  }

  emit(e: SimEvent): void {
    this.events.push(e);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
  }

  drainEvents(out: SimEvent[]): SimEvent[] {
    out.length = 0;
    for (const e of this.events) out.push(e);
    this.events.length = 0;
    return out;
  }

  actorById(id: number): Actor | undefined {
    for (const a of this.actors) if (a.id === id) return a;
    return undefined;
  }

  enemyDef(a: Actor): EnemyDef {
    let d = this.enemyDefCache.get(a.defId);
    if (!d) {
      d = Enemies.get(a.defId);
      this.enemyDefCache.set(a.defId, d);
    }
    return d;
  }

  enemyXp(a: Actor): number {
    if (a.kind !== 'enemy') return 0;
    return this.enemyDef(a).xp;
  }

  interactable(id: number): Interactable | undefined {
    return this.interactables.find((i) => i.id === id);
  }

  markers(): ObjectiveMarker[] {
    return this.objectives.markers(this.markerScratch);
  }

  get elapsed(): number {
    return this.tick * DT;
  }

  walkablePoint(x: number, z: number): Point | null {
    const k = this.nav.nearestWalkable(this.grid.cellX(x), this.grid.cellZ(z), 4);
    if (k < 0) return null;
    const i = k % this.grid.w;
    return { x: this.grid.centerX(i), z: this.grid.centerZ((k - i) / this.grid.w) };
  }

  private farthestReinforcement(x: number, z: number): Point {
    let best = this.level.reinforcements[0] ?? { x, z };
    let bd = -1;
    const p = this.player;
    for (const r of this.level.reinforcements) {
      const d = Math.hypot(r.x - p.x, r.z - p.z) + Math.hypot(r.x - x, r.z - z) * 0.2;
      if (d > bd && Math.hypot(r.x - x, r.z - z) > 18) {
        bd = d;
        best = r;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ spawning

  private baseActor(kind: ActorKind, team: Team, defId: string, x: number, z: number): Actor {
    const a: Actor = {
      id: this.nextId++,
      team,
      kind,
      defId,
      alive: true,
      x,
      y: 0,
      z,
      px: x,
      py: 0,
      pz: z,
      pyaw: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: 0,
      pitch: 0,
      radius: 0.32,
      standHeight: 1.76,
      height: 1.76,
      crouch: 0,
      crouching: false,
      onGround: true,
      sprinting: false,
      sliding: 0,
      ads: 0,
      hp: 100,
      maxHp: 100,
      armor: 0,
      lastDamageTick: -9999,
      regenDelay: 4,
      weapons: [],
      current: 0,
      switchTimer: 0,
      grenades: 0,
      throwTimer: 0,
      runSpeed: 7.2,
      walkSpeed: 4.8,
      speedMult: this.hasModifier('blitz') ? 1.2 : 1,
      scale: 1,
      headScale: 1,
      cmd: emptyCmd(),
      prevButtons: 0,
      hitFlash: 0,
      lastHitZone: 'torso',
      lastHitX: 0,
      lastHitZ: 1,
      hitStop: 0,
      deathTick: 0,
      deathX: 0,
      deathZ: 1,
      stepPhase: 0,
      interactId: -1,
      interactProgress: 0,
      variant: this.rng.nextU32(),
      squad: 0,
      tag: '',
      followId: -1,
      fear: 0,
      laser: 0,
      radarUntil: 0,
      stats: { shots: 0, hits: 0, headshots: 0, kills: 0, damageDealt: 0, damageTaken: 0, grenadeKills: 0 },
    };
    this.actors.push(a);
    return a;
  }

  private makeSlot(id: string, attachments: string[], ammoMult: number, ai: boolean): WeaponSlot {
    const def = resolveWeapon(id, attachments, ai ? {} : (this.perk?.mods ?? {}));
    return {
      def,
      attachments,
      mag: def.magSize,
      reserve: ai ? 9999 : Math.round(def.reserve * ammoMult),
      cooldown: 0,
      reloadTimer: 0,
      reloadTotal: 0,
      shotIndex: 0,
      recoilPitch: 0,
      recoilYaw: 0,
      bloom: 0,
      lastShotTick: -999,
    };
  }

  private createPlayer(): Actor {
    const s = this.level.playerSpawn;
    const a = this.baseActor('player', 0, 'player', s.x, s.z);
    const lo = this.config.loadout;
    const ammoMult = this.difficulty.ammoMult * (this.perk?.mods.ammoMult ?? 1);
    a.weapons.push(this.makeSlot(lo.primary, lo.primaryAtt, ammoMult, false));
    a.weapons.push(this.makeSlot(lo.secondary, lo.secondaryAtt, ammoMult, false));
    a.maxHp = 100 + (this.perk?.mods.maxHp ?? 0);
    a.hp = a.maxHp;
    a.grenades = 2 + (this.perk?.mods.grenades ?? 0);
    a.runSpeed = 7.3 * (this.perk?.mods.sprintMult ?? 1);
    a.walkSpeed = 4.9;
    a.regenDelay = this.difficulty.playerRegenDelay * (this.perk?.mods.regenDelayMult ?? 1);
    a.yaw = s.yaw;
    a.pyaw = s.yaw;
    a.cmd.yaw = s.yaw;
    return a;
  }

  spawnEnemy(
    defId: string,
    x: number,
    z: number,
    tag: Actor['tag'],
    behavior: Brain['behavior'] = 'guard',
    patrol: Point[] = [],
    squad = 0,
  ): Actor {
    const def = Enemies.get(defId);
    const a = this.baseActor('enemy', 1, defId, x, z);
    const hpMult = this.difficulty.enemyHp * this.hpScale * (this.hasModifier('armored') ? 1.35 : 1);
    a.maxHp = def.hp * hpMult;
    a.hp = a.maxHp;
    a.armor = def.armor;
    a.runSpeed = def.runSpeed;
    a.walkSpeed = def.runSpeed * 0.72;
    a.scale = def.scale;
    a.standHeight = 1.78 * def.scale;
    a.height = a.standHeight;
    a.radius = 0.33 * def.scale;
    a.headScale = this.hasModifier('bighead') ? 1.7 : 1;
    a.weapons.push(this.makeSlot(def.weapon, [], 1, true));
    a.grenades = def.grenade > 0 ? 2 : 0;
    a.tag = tag;
    a.squad = squad || 1000 + a.id;
    a.brain = createBrain(a, patrol, behavior, a.id);
    if (tag === 'hvt') a.radarUntil = Number.MAX_SAFE_INTEGER;
    this.emit({ type: 'spawn', actorId: a.id });
    return a;
  }

  private spawnCivilian(x: number, z: number): Actor {
    const a = this.baseActor('civilian', 2, 'civilian', x, z);
    a.hp = a.maxHp = 60;
    a.runSpeed = 5.4;
    a.walkSpeed = 1.3;
    a.brain = createBrain(a, [], 'guard', a.id);
    a.yaw = this.aiRng.range(-Math.PI, Math.PI);
    return a;
  }

  spawnHostage(x: number, z: number): Actor {
    const pt = this.walkablePoint(x, z) ?? { x, z };
    const a = this.baseActor('hostage', 2, 'hostage', pt.x, pt.z);
    a.hp = a.maxHp = 160;
    a.runSpeed = 6.8;
    a.walkSpeed = 3.4;
    a.brain = createBrain(a, [], 'guard', a.id);
    return a;
  }

  addInteractable(kind: Interactable['kind'], x: number, z: number, holdTime: number, label: string, actorId = -1): number {
    const id = this.nextId++;
    this.interactables.push({ id, kind, x, z, radius: 2.1, holdTime, progress: 0, done: false, fuse: -1, label, actorId });
    return id;
  }

  addPickup(kind: Pickup['kind'], x: number, z: number, lifetime: number): void {
    this.pickups.push({ id: this.nextId++, kind, x, y: this.grid.heightAt(x, z) > 0.35 ? 0 : 0, z, alive: true, expires: lifetime ? this.tick + lifetime * 60 : 0 });
  }

  addProjectile(owner: Actor, x: number, y: number, z: number, vx: number, vy: number, vz: number, fuse: number): number {
    const id = this.nextId++;
    this.projectiles.push({ id, ownerId: owner.id, team: owner.team, x, y, z, px: x, py: y, pz: z, vx, vy, vz, fuse, bounces: 0, alive: true });
    return id;
  }

  sabotageKind(): Interactable['kind'] {
    return this.biome.id === 'port' ? 'pump' : this.biome.layout === 'colony' ? 'array' : 'cache';
  }

  rosterWeights(): [string, number][] {
    const out: [string, number][] = [];
    for (const [id, weight] of Object.entries(this.biome.roster)) {
      if (id === 'officer' || !weight) continue;
      out.push([id, id === 'marksman' && this.hasModifier('marksmen') ? weight * 3 : weight]);
    }
    return out;
  }

  waveSize(n: number): number {
    const mult = this.difficulty.enemyCountMult * (this.hasModifier('reinforced') ? 1.4 : 1);
    return Math.max(2, Math.round((2.5 + n * 1.5) * mult));
  }

  resupply(): void {
    const p = this.player;
    for (let n = 0; n < 3; n += 1) {
      const ang = (n / 3) * Math.PI * 2;
      const pt = this.walkablePoint(p.x + Math.cos(ang) * 3, p.z + Math.sin(ang) * 3);
      if (pt) this.addPickup(n === 2 ? 'grenade' : 'ammo', pt.x, pt.z, 40);
    }
    if (this.hasModifier('ironman')) {
      const pt = this.walkablePoint(p.x + 2, p.z - 2);
      if (pt) this.addPickup('medkit', pt.x, pt.z, 40);
    }
  }

  // ------------------------------------------------------------------ AI hooks

  noise(x: number, z: number, radius: number, sourceId: number): void {
    for (const a of this.actors) {
      if (!a.alive || !a.brain || a.id === sourceId) continue;
      if (Math.hypot(a.x - x, a.z - z) > radius) continue;
      hear(this, a, x, z, sourceId);
    }
  }

  alertNearby(src: Actor, radius: number, delayTicks: number): void {
    const br = src.brain;
    if (!br) return;
    for (const a of this.actors) {
      if (!a.alive || a === src || a.team !== 1 || !a.brain || a.brain.state === 'combat') continue;
      const d = Math.hypot(a.x - src.x, a.z - src.z);
      if (d > radius && !(a.squad === src.squad && d < 45)) continue;
      this.pendingAlerts.push({ actorId: a.id, tick: this.tick + delayTicks + Math.floor(d * 2), x: br.lastKnownX, z: br.lastKnownZ });
    }
  }

  bark(a: Actor, line: BarkLine, force = false): void {
    const squadLast = this.squadBarkTick.get(a.squad) ?? -999;
    if (!force && (this.tick - this.lastBarkTick < 75 || this.tick - squadLast < 150)) return;
    this.lastBarkTick = this.tick;
    this.squadBarkTick.set(a.squad, this.tick);
    this.emit({ type: 'bark', actorId: a.id, line });
  }

  onPlayerReload(): void {
    const p = this.player;
    for (const a of this.actors) {
      if (!a.alive || a.team !== 1 || !a.brain?.canSee) continue;
      if (Math.hypot(a.x - p.x, a.z - p.z) > 28) continue;
      this.bark(a, 'playerReloading');
      if (this.enemyDef(a).aggression > 0.6) a.brain.tacticTimer = 0;
      break;
    }
  }

  onBreak(cell: number, explosive: boolean, sourceId: number): void {
    const grid = this.grid;
    const i = cell % grid.w;
    const j = (cell - i) / grid.w;
    const x = grid.centerX(i);
    const z = grid.centerZ(j);
    this.emit({ type: 'break', cell, x, z, kind: explosive ? 'explosive' : this.level.breakables[grid.breakId[cell]]?.kind ?? 'crate' });
    if (explosive) {
      this.pendingExplosions.push({ x, y: 0.6, z, delay: 0.12, sourceId, radius: 6, damage: 190, barrel: true });
    }
  }

  onDamaged(target: Actor, source: Actor | null, amount: number): void {
    if (target.kind === 'player') {
      this.scoring.onPlayerDamaged(amount);
      this.director.onPlayerHurt(amount);
    }
    if (target.alive && target.brain) brainDamaged(this, target, source);
  }

  kill(target: Actor, source: Actor | null, zone: HitZone, weaponId: string, kind: 'bullet' | 'explosion'): void {
    target.alive = false;
    target.hp = 0;
    target.deathTick = this.tick;
    target.deathX = target.lastHitX;
    target.deathZ = target.lastHitZ;
    target.vx = 0;
    target.vz = 0;
    target.laser = 0;
    if (target.brain && target.brain.coverCell >= 0) this.nav.releaseCover(target.id);
    const distance = source ? Math.hypot(source.x - target.x, source.z - target.z) : 0;
    if (source) {
      source.stats.kills += 1;
      if (zone === 'head' && kind === 'bullet') source.stats.headshots += 1;
      if (kind === 'explosion' && !this.explodingBarrel) source.stats.grenadeKills += 1;
    }
    this.emit({ type: 'kill', killerId: source?.id ?? -1, victimId: target.id, weaponId, zone, distance, kind });
    this.scoring.onKill(source, target, zone, distance, kind, this.explodingBarrel);
    this.objectives.onKill(target);

    if (target.team === 1) {
      const scav = this.perk?.mods.scavenger;
      if (scav || this.rng.next() < 0.4) this.addPickup('ammo', target.x, target.z, 35);
      else if (this.rng.next() < 0.08) this.addPickup('grenade', target.x, target.z, 35);
      if (this.hasModifier('ironman') && this.rng.next() < 0.2) this.addPickup('medkit', target.x + 0.5, target.z, 35);
      // Morale: officers/HVTs dying breaks nearby squads; otherwise an ally calls it out.
      const leader = target.defId === 'officer' || target.tag === 'hvt';
      let barked = false;
      for (const a of this.actors) {
        if (!a.alive || a.team !== 1 || !a.brain) continue;
        const d = Math.hypot(a.x - target.x, a.z - target.z);
        if (leader && d < 25) {
          a.brain.panicTimer = 3 + this.aiRng.next() * 2;
          a.brain.tacticTimer = 0;
          if (!barked) this.bark(a, 'surrender', true);
          barked = true;
        } else if (!barked && d < 22) {
          this.bark(a, 'mandown');
          barked = true;
          if (a.brain.state !== 'combat' && source) {
            a.brain.lastKnownX = source.x;
            a.brain.lastKnownZ = source.z;
            enterCombat(this, a, a.brain, false);
          }
        }
      }
      if (source?.kind === 'player') {
        if (distance < 6) this.director.onKillNearPlayer();
        if (this.hasModifier('vampire')) source.hp = Math.min(source.maxHp, source.hp + 20);
      }
    }
  }

  // ------------------------------------------------------------------ main step

  step(playerCmd: InputCmd): void {
    if (this.status !== 'running') return;
    this.tick += 1;
    const dt = DT;
    for (const a of this.actors) {
      a.px = a.x;
      a.py = a.y;
      a.pz = a.z;
      a.pyaw = a.yaw;
    }
    for (const pr of this.projectiles) {
      pr.px = pr.x;
      pr.py = pr.y;
      pr.pz = pr.z;
    }

    const p = this.player;
    if (p.alive) {
      const c = p.cmd;
      c.moveF = clamp(playerCmd.moveF, -1, 1);
      c.moveR = clamp(playerCmd.moveR, -1, 1);
      c.yaw = playerCmd.yaw;
      c.pitch = clamp(playerCmd.pitch, -1.45, 1.45);
      c.buttons = playerCmd.buttons;
      c.slot = playerCmd.slot;
    }

    // Delayed squad alerts.
    for (let n = this.pendingAlerts.length - 1; n >= 0; n -= 1) {
      const al = this.pendingAlerts[n];
      if (al.tick > this.tick) continue;
      this.pendingAlerts.splice(n, 1);
      const a = this.actorById(al.actorId);
      if (a?.alive && a.brain && a.brain.state !== 'combat') {
        a.brain.lastKnownX = al.x;
        a.brain.lastKnownZ = al.z;
        enterCombat(this, a, a.brain, false);
      }
    }

    this.director.update(dt);
    for (const a of this.actors) if (a.alive && a.brain) updateBrain(this, a, dt);

    for (const a of this.actors) {
      if (a.hitFlash > 0) a.hitFlash = Math.max(0, a.hitFlash - dt);
      if (a.hitStop > 0) a.hitStop = Math.max(0, a.hitStop - dt);
      if (!a.alive) continue;
      a.yaw = a.cmd.yaw;
      a.pitch = a.cmd.pitch;
      moveActor(a, this.grid, dt, this.gravity, (kind, speed) => {
        if (kind === 'land') this.emit({ type: 'land', actorId: a.id, speed });
        else if (kind === 'jump') this.emit({ type: 'jump', actorId: a.id });
        else this.emit({ type: 'slide', actorId: a.id });
      });
      updateWeapons(this, a, dt);

      // Footsteps.
      const hs = Math.hypot(a.vx, a.vz);
      if (a.onGround && hs > 1) {
        a.stepPhase += hs * dt;
        const stride = a.sprinting ? 2.1 : 1.6;
        if (a.stepPhase >= stride) {
          a.stepPhase -= stride;
          const k = this.grid.cellZ(a.z) * this.grid.w + this.grid.cellX(a.x);
          const surf = a.y > 0.3 ? this.grid.surface[k] ?? 0 : this.grid.floor[k] ?? 0;
          this.emit({ type: 'step', actorId: a.id, surface: surf, sprint: a.sprinting });
          if (a.kind === 'player' && a.sprinting && !a.crouching) this.noise(a.x, a.z, 9, a.id);
        }
      }

      // Health regeneration.
      if (a.kind === 'player' && !this.hasModifier('ironman') && this.tick - a.lastDamageTick > a.regenDelay * 60 && a.hp < a.maxHp) {
        a.hp = Math.min(a.maxHp, a.hp + 24 * dt);
      }
      a.prevButtons = a.cmd.buttons;
    }

    this.separation.run(this.actors, this.grid);
    this.updateProjectiles(dt);
    this.updateExplosions(dt);
    this.updatePickups();
    this.updateInteractables(dt);

    // Camping detection (drives AI grenade decisions).
    if (Math.hypot(p.x - this.campX, p.z - this.campZ) > 2.5) {
      this.campX = p.x;
      this.campZ = p.z;
      this.playerCampTime = 0;
    } else this.playerCampTime += dt;

    this.objectives.update(dt);
    this.cullBodies();

    if (!p.alive) this.end(false, 'You were killed in action');
    else if (this.objectives.failed) this.end(false, this.objectives.failed);
    else if (this.objectives.complete) this.end(true, 'Mission complete');
  }

  private end(success: boolean, reason: string): void {
    if (this.status !== 'running') return;
    this.status = success ? 'success' : 'failed';
    this.endReason = reason;
    this.endTick = this.tick;
    this.scoring.finalize(this.player.stats.damageTaken, success);
    this.emit({ type: 'missionEnd', success, reason });
  }

  /** Test/dev hook: force an ending. */
  forceEnd(success: boolean, reason: string): void {
    this.end(success, reason);
  }

  private updateProjectiles(dt: number): void {
    const grid = this.grid;
    const g = this.gravity * 0.9;
    for (const pr of this.projectiles) {
      if (!pr.alive) continue;
      pr.vy -= g * dt;
      // X
      let nx = pr.x + pr.vx * dt;
      if (pr.y < grid.heightAt(nx, pr.z)) {
        this.bounce(pr, Math.abs(pr.vx));
        pr.vx = -pr.vx * 0.45;
        nx = pr.x;
      }
      pr.x = nx;
      // Z
      let nz = pr.z + pr.vz * dt;
      if (pr.y < grid.heightAt(pr.x, nz)) {
        this.bounce(pr, Math.abs(pr.vz));
        pr.vz = -pr.vz * 0.45;
        nz = pr.z;
      }
      pr.z = nz;
      // Y (ground or top of cover)
      const floor = Math.max(0, grid.heightAt(pr.x, pr.z) <= pr.y + 0.05 ? grid.heightAt(pr.x, pr.z) : 0);
      pr.y += pr.vy * dt;
      if (pr.y < floor + 0.06) {
        if (pr.vy < -2) this.bounce(pr, -pr.vy);
        pr.y = floor + 0.06;
        pr.vy = -pr.vy * 0.33;
        pr.vx *= 0.7;
        pr.vz *= 0.7;
        if (Math.abs(pr.vy) < 0.6) pr.vy = 0;
      }
      pr.fuse -= dt;
      if (pr.fuse <= 0) {
        pr.alive = false;
        explode(this, pr.x, pr.y + 0.1, pr.z, 6.5, 175, pr.ownerId);
      }
    }
    for (let n = this.projectiles.length - 1; n >= 0; n -= 1) if (!this.projectiles[n].alive) this.projectiles.splice(n, 1);
  }

  private bounce(pr: Projectile, speed: number): void {
    pr.bounces += 1;
    if (speed > 1.5) this.emit({ type: 'bounce', projectileId: pr.id, x: pr.x, y: pr.y, z: pr.z, speed });
  }

  private updateExplosions(dt: number): void {
    for (let n = this.pendingExplosions.length - 1; n >= 0; n -= 1) {
      const e = this.pendingExplosions[n];
      e.delay -= dt;
      if (e.delay > 0) continue;
      this.pendingExplosions.splice(n, 1);
      this.explodingBarrel = e.barrel;
      explode(this, e.x, e.y, e.z, e.radius, e.damage, e.sourceId);
      this.explodingBarrel = false;
    }
  }

  private updatePickups(): void {
    const p = this.player;
    for (const pk of this.pickups) {
      if (!pk.alive) continue;
      if (pk.expires && this.tick > pk.expires) {
        pk.alive = false;
        continue;
      }
      if (!p.alive || Math.hypot(p.x - pk.x, p.z - pk.z) > 1.3 || Math.abs(p.y - pk.y) > 1.5) continue;
      let amount = 0;
      if (pk.kind === 'ammo') {
        for (const s of p.weapons) {
          const room = Math.round(s.def.reserve * 1.5) - s.reserve;
          const add = Math.max(0, Math.min(room, Math.ceil(s.def.magSize * 1.2)));
          s.reserve += add;
          amount += add;
        }
        if (amount === 0) continue;
      } else if (pk.kind === 'grenade') {
        if (p.grenades >= 4) continue;
        p.grenades += 1;
        amount = 1;
      } else if (pk.kind === 'medkit') {
        if (p.hp >= p.maxHp) continue;
        amount = Math.min(50, p.maxHp - p.hp);
        p.hp += amount;
      } else {
        amount = 25;
      }
      pk.alive = false;
      this.emit({ type: 'pickup', actorId: p.id, kind: pk.kind, amount });
    }
    if (this.tick % 120 === 0) {
      for (let n = this.pickups.length - 1; n >= 0; n -= 1) if (!this.pickups[n].alive) this.pickups.splice(n, 1);
    }
  }

  private updateInteractables(dt: number): void {
    const p = this.player;
    const holding = (p.cmd.buttons & Btn.Interact) !== 0;
    let nearest: Interactable | null = null;
    let nd = Infinity;
    const current = this.objectives.current;
    for (const it of this.interactables) {
      if (it.fuse >= 0) {
        it.fuse -= dt;
        if (it.fuse < 0) {
          it.fuse = -2;
          explode(this, it.x, 0.8, it.z, 7.5, 220, p.id);
          this.emit({ type: 'charge', id: it.id, x: it.x, z: it.z });
        }
      }
      if (it.done || !p.alive) continue;
      // Only interactables belonging to the active objective are usable.
      if (current && !current.interactIds.includes(it.id)) continue;
      const d = Math.hypot(p.x - it.x, p.z - it.z);
      if (d < it.radius && d < nd) {
        nearest = it;
        nd = d;
      }
    }
    this.promptId = nearest ? nearest.id : -1;
    for (const it of this.interactables) {
      if (it.done) continue;
      if (it === nearest && holding) {
        it.progress = Math.min(1, it.progress + dt / it.holdTime);
        if (it.progress >= 1) {
          it.done = true;
          if (it.kind === 'cache' || it.kind === 'pump' || it.kind === 'array') it.fuse = 4;
          this.emit({ type: 'interact', id: it.id, kind: it.kind, done: true });
        }
      } else if (it.progress > 0) {
        it.progress = Math.max(0, it.progress - dt * 0.6);
      }
    }
  }

  private cullBodies(): void {
    if (this.tick % 60 !== 0) return;
    let dead = 0;
    for (const a of this.actors) if (!a.alive && a.kind !== 'player') dead += 1;
    while (dead > MAX_BODIES) {
      const idx = this.actors.findIndex((a) => !a.alive && a.kind !== 'player');
      if (idx < 0) break;
      this.actors.splice(idx, 1);
      dead -= 1;
    }
  }

  // ------------------------------------------------------------------ snapshot

  /** Quantized state hash for determinism tests, replay verification and desync detection. */
  hash(): number {
    let h = hashString(`t${this.tick}`);
    const mix = (v: number): void => {
      h = Math.imul(h ^ (v | 0), 0x01000193) >>> 0;
    };
    for (const a of this.actors) {
      mix(a.id);
      mix(q(a.x));
      mix(q(a.y));
      mix(q(a.z));
      mix(q(a.yaw));
      mix(q(a.hp));
      mix(a.alive ? 1 : 0);
      for (const s of a.weapons) {
        mix(s.mag);
        mix(s.reserve);
      }
    }
    for (const pr of this.projectiles) {
      mix(q(pr.x));
      mix(q(pr.y));
      mix(q(pr.z));
    }
    for (const v of this.rng.getState()) mix(v);
    mix(this.scoring.score);
    return h >>> 0;
  }

  /** Compact serialisable view (net snapshot / save-state / debugging). */
  snapshot(): {
    tick: number;
    status: MissionStatus;
    actors: { id: number; kind: ActorKind; x: number; y: number; z: number; yaw: number; hp: number; alive: boolean }[];
  } {
    return {
      tick: this.tick,
      status: this.status,
      actors: this.actors.map((a) => ({ id: a.id, kind: a.kind, x: q(a.x) / 1000, y: q(a.y) / 1000, z: q(a.z) / 1000, yaw: q(a.yaw) / 1000, hp: Math.round(a.hp), alive: a.alive })),
    };
  }

  /** Where the player's eye is (for presentation). */
  playerEye(): { x: number; y: number; z: number } {
    const p = this.player;
    return { x: p.x, y: p.y + eyeHeight(p), z: p.z };
  }

  /** Count of breakable cells (for tests). */
  breakableCount(): number {
    let n = 0;
    for (let k = 0; k < this.grid.flags.length; k += 1) if (this.grid.flags[k] & CellFlag.Breakable) n += 1;
    return n;
  }

  applyDamageToPlayerForTest(amount: number): void {
    applyDamage(this, this.player, amount, null, 'torso', 0, 1, 'bullet', 'test');
  }

  factionId(): string {
    return Factions.get(this.biome.faction).id;
  }
}
