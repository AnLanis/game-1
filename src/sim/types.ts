import type { WeaponDef } from '../content/types';

/** Button bitmask carried in every input command. */
export const Btn = {
  Fire: 1,
  Ads: 2,
  Jump: 4,
  Crouch: 8,
  Sprint: 16,
  Reload: 32,
  Interact: 64,
  Grenade: 128,
  Next: 256,
  Prev: 512,
} as const;

/**
 * One tick of intent. Players produce these from devices; AI brains produce
 * them from decisions; a network client would send exactly this struct.
 * yaw/pitch are absolute (authoritative look), movement is local-space.
 */
export interface InputCmd {
  moveF: number;
  moveR: number;
  yaw: number;
  pitch: number;
  buttons: number;
  /** 0 = no change, otherwise weapon slot index + 1. */
  slot: number;
}

export const emptyCmd = (): InputCmd => ({ moveF: 0, moveR: 0, yaw: 0, pitch: 0, buttons: 0, slot: 0 });

export type Team = 0 | 1 | 2;
export type ActorKind = 'player' | 'enemy' | 'civilian' | 'hostage';
export type HitZone = 'head' | 'torso' | 'legs';

export interface WeaponSlot {
  def: WeaponDef;
  attachments: string[];
  mag: number;
  reserve: number;
  cooldown: number;
  reloadTimer: number;
  reloadTotal: number;
  shotIndex: number;
  recoilPitch: number;
  recoilYaw: number;
  bloom: number;
  lastShotTick: number;
}

export interface Actor {
  id: number;
  team: Team;
  kind: ActorKind;
  defId: string;
  alive: boolean;
  /** Feet position. */
  x: number;
  y: number;
  z: number;
  /** Previous-tick position/look for render interpolation. */
  px: number;
  py: number;
  pz: number;
  pyaw: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  radius: number;
  standHeight: number;
  height: number;
  crouch: number;
  crouching: boolean;
  onGround: boolean;
  sprinting: boolean;
  sliding: number;
  ads: number;
  hp: number;
  maxHp: number;
  armor: number;
  lastDamageTick: number;
  regenDelay: number;
  weapons: WeaponSlot[];
  current: number;
  switchTimer: number;
  grenades: number;
  throwTimer: number;
  runSpeed: number;
  walkSpeed: number;
  speedMult: number;
  scale: number;
  headScale: number;
  cmd: InputCmd;
  prevButtons: number;
  hitFlash: number;
  lastHitZone: HitZone;
  lastHitX: number;
  lastHitZ: number;
  hitStop: number;
  deathTick: number;
  deathX: number;
  deathZ: number;
  stepPhase: number;
  interactId: number;
  interactProgress: number;
  /** Deterministic variety seed for looks. */
  variant: number;
  squad: number;
  tag: '' | 'hvt' | 'bodyguard' | 'reinforcement' | 'initial';
  followId: number;
  fear: number;
  /** Marksman telegraph (0 = off, else seconds of laser remaining). */
  laser: number;
  /** Visible on minimap (fired recently / spotted). */
  radarUntil: number;
  stats: { shots: number; hits: number; headshots: number; kills: number; damageDealt: number; damageTaken: number; grenadeKills: number };
}

export interface Projectile {
  id: number;
  ownerId: number;
  team: Team;
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  fuse: number;
  bounces: number;
  alive: boolean;
}

export interface Pickup {
  id: number;
  kind: 'ammo' | 'medkit' | 'grenade' | 'armor';
  x: number;
  y: number;
  z: number;
  alive: boolean;
  /** Tick after which it disappears (0 = never). */
  expires: number;
}

export interface Interactable {
  id: number;
  kind: 'cache' | 'intel' | 'hostage' | 'array' | 'pump';
  x: number;
  z: number;
  radius: number;
  holdTime: number;
  progress: number;
  done: boolean;
  /** Detonation countdown for planted charges (seconds, -1 = none). */
  fuse: number;
  label: string;
  actorId: number;
}

export type BarkLine =
  | 'contact'
  | 'reloading'
  | 'grenade'
  | 'flanking'
  | 'mandown'
  | 'takingfire'
  | 'lost'
  | 'moving'
  | 'suppressing'
  | 'fleeing'
  | 'playerReloading'
  | 'heavy'
  | 'surrender';

export type Medal =
  | 'headshot'
  | 'double'
  | 'triple'
  | 'multi'
  | 'longshot'
  | 'pointblank'
  | 'collateral'
  | 'grenade'
  | 'streak5'
  | 'streak10'
  | 'comeback'
  | 'firstblood'
  | 'barrel'
  | 'untouchable'
  | 'quickdraw';

export type SimEvent =
  | {
      type: 'shot';
      actorId: number;
      weaponId: string;
      ox: number;
      oy: number;
      oz: number;
      hx: number;
      hy: number;
      hz: number;
      nx: number;
      ny: number;
      nz: number;
      surface: number;
      hitActor: number;
      zone: HitZone | '';
      pellet: number;
      suppressed: boolean;
    }
  | { type: 'damage'; targetId: number; sourceId: number; amount: number; zone: HitZone; dirX: number; dirZ: number; kind: 'bullet' | 'explosion'; killed: boolean }
  | { type: 'kill'; killerId: number; victimId: number; weaponId: string; zone: HitZone; distance: number; kind: 'bullet' | 'explosion' }
  | { type: 'reload'; actorId: number; weaponId: string; time: number }
  | { type: 'reloadDone'; actorId: number }
  | { type: 'switch'; actorId: number; weaponId: string }
  | { type: 'dryfire'; actorId: number }
  | { type: 'jump'; actorId: number }
  | { type: 'land'; actorId: number; speed: number }
  | { type: 'step'; actorId: number; surface: number; sprint: boolean }
  | { type: 'slide'; actorId: number }
  | { type: 'throw'; actorId: number; projectileId: number }
  | { type: 'bounce'; projectileId: number; x: number; y: number; z: number; speed: number }
  | { type: 'explosion'; x: number; y: number; z: number; radius: number; sourceId: number }
  | { type: 'break'; cell: number; x: number; z: number; kind: 'crate' | 'barrel' | 'explosive' }
  | { type: 'whiz'; x: number; y: number; z: number; shooterId: number }
  | { type: 'bark'; actorId: number; line: BarkLine }
  | { type: 'pickup'; actorId: number; kind: Pickup['kind']; amount: number }
  | { type: 'interact'; id: number; kind: Interactable['kind']; done: boolean }
  | { type: 'charge'; id: number; x: number; z: number }
  | { type: 'objective'; index: number; label: string; done: boolean }
  | { type: 'medal'; medal: Medal; xp: number }
  | { type: 'wave'; wave: number; count: number; heavy: boolean }
  | { type: 'waveClear'; wave: number }
  | { type: 'spawn'; actorId: number }
  | { type: 'laser'; actorId: number }
  | { type: 'alert'; actorId: number }
  | { type: 'missionEnd'; success: boolean; reason: string };
