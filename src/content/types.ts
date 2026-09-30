/**
 * Content schema. Every weapon, enemy, biome, mission and mode is plain data
 * registered in a Registry — adding content never requires touching systems.
 */

export type WeaponClass = 'rifle' | 'smg' | 'shotgun' | 'pistol' | 'dmr' | 'lmg' | 'sniper' | 'launcher';

export interface GunAudioProfile {
  /** Body character of the report. */
  kind: WeaponClass;
  /** 0..1 loudness / weight. */
  power: number;
  /** Pitch multiplier (1 = default). */
  pitch: number;
  /** 0..1 amount of environmental tail. */
  tail: number;
  suppressed?: boolean;
}

export interface RecoilProfile {
  /** Radians of upward aim kick per shot. */
  vertical: number;
  /** Radians of horizontal pattern amplitude. */
  horizontal: number;
  /** Pattern phase seed — the same gun always kicks the same way. */
  pattern: number;
  /** Exponential recovery rate (1/s) once firing stops. */
  recovery: number;
  /** Visual camera punch multiplier (view punch ≫ aim kick, per modern shooters). */
  punch: number;
}

export interface ViewModelSpec {
  /** Procedural builder id in render/weaponModels.ts */
  build: 'carbine' | 'smg' | 'shotgun' | 'pistol' | 'dmr' | 'lmg' | 'sniper' | 'bullpup';
  /** Base finish colour of the receiver. */
  finish: string;
  furniture: string;
  accent: string;
}

export interface WeaponDef {
  id: string;
  name: string;
  short: string;
  cls: WeaponClass;
  slot: 'primary' | 'secondary';
  description: string;
  damage: number;
  pellets: number;
  headMult: number;
  limbMult: number;
  /** Damage starts dropping at rangeStart, reaches minDamageMult at rangeEnd. */
  rangeStart: number;
  rangeEnd: number;
  minDamageMult: number;
  maxRange: number;
  rpm: number;
  auto: boolean;
  magSize: number;
  reserve: number;
  reloadTime: number;
  /** Radians (half-angle). */
  hipSpread: number;
  adsSpread: number;
  moveSpreadMult: number;
  bloomPerShot: number;
  bloomMax: number;
  recoil: RecoilProfile;
  adsTime: number;
  /** Camera zoom factor while aiming (1.2 = 20% tighter FOV). */
  adsZoom: number;
  moveSpeedMult: number;
  switchTime: number;
  audio: GunAudioProfile;
  model: ViewModelSpec;
  /** Player level required. 0 = starter. */
  unlockLevel: number;
  /** Only AI may use (tuned enemy variants). */
  aiOnly?: boolean;
}

export type AttachmentSlot = 'optic' | 'muzzle' | 'mag' | 'grip';

export interface WeaponMods {
  damageMult?: number;
  spreadMult?: number;
  adsSpreadMult?: number;
  recoilMult?: number;
  magMult?: number;
  reloadMult?: number;
  adsTimeMult?: number;
  adsZoomAdd?: number;
  rangeMult?: number;
  moveSpeedMult?: number;
  suppressed?: boolean;
}

export interface AttachmentDef {
  id: string;
  name: string;
  slot: AttachmentSlot;
  description: string;
  mods: WeaponMods;
  /** Weapon mastery level that unlocks this attachment. */
  mastery: number;
  classes: WeaponClass[];
}

export type EnemyRole = 'rifleman' | 'rusher' | 'breacher' | 'marksman' | 'grenadier' | 'heavy' | 'officer';

export type Headgear = 'helmet' | 'cap' | 'beret' | 'hood' | 'visor' | 'ghillie' | 'bare';

export interface EnemyDef {
  id: string;
  name: string;
  role: EnemyRole;
  hp: number;
  armor: number;
  runSpeed: number;
  walkSpeed: number;
  weapon: string;
  /** Base aim error cone (radians) before difficulty scaling. */
  aimError: number;
  /** Preferred engagement band (m). */
  range: [number, number];
  aggression: number;
  coverUse: number;
  flank: number;
  grenade: number;
  burst: [number, number];
  burstPause: [number, number];
  /** Laser/glint telegraph before firing (s). */
  telegraph?: number;
  scale: number;
  headgear: Headgear;
  xp: number;
}

export interface FactionDef {
  id: string;
  name: string;
  /** Uniform, vest, accent, skin tones used per-instance. */
  uniform: string[];
  vest: string[];
  accent: string;
  skin: string[];
  headgearTint: string[];
  /** Squad callsign prefixes for bark captions. */
  callsigns: string[];
}

export type LayoutStyle = 'town' | 'fields' | 'canyon' | 'yard' | 'compound' | 'colony';

export interface BiomePalette {
  skyTop: string;
  skyHorizon: string;
  fog: string;
  fogDensity: number;
  sun: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  ground: string;
  groundAlt: string;
  street: string;
  walls: string[];
  trims: string[];
  accents: string[];
  foliage: string;
  rock: string;
  metal: string;
  wood: string;
  fabric: string[];
  lamp: string;
}

export interface BiomeDef {
  id: string;
  name: string;
  theater: string;
  blurb: string;
  layout: LayoutStyle;
  size: [number, number];
  gravity: number;
  time: 'day' | 'dusk' | 'night';
  sunElevation: number;
  sunAzimuth: number;
  exposure: number;
  bloom: number;
  saturation: number;
  palette: BiomePalette;
  surface: 'sand' | 'dirt' | 'grass' | 'stone' | 'snow' | 'metal' | 'regolith';
  weather: 'dust' | 'snow' | 'embers' | 'none' | 'spores';
  faction: string;
  flashlight: boolean;
  /** Visual set pieces in the sky. */
  sky: 'sun' | 'moon' | 'mars';
  ambience: 'wind' | 'market' | 'birds' | 'harbor' | 'storm' | 'hum';
  reverb: 'town' | 'open' | 'canyon' | 'yard';
  /** Enemy roster weights for this theater. */
  roster: Partial<Record<string, number>>;
}

export interface DifficultyDef {
  id: string;
  name: string;
  blurb: string;
  enemyHp: number;
  enemyDamage: number;
  reaction: number;
  aimError: number;
  graceShots: number;
  tokens: number;
  grenadeCooldown: number;
  playerRegenDelay: number;
  ammoMult: number;
  aimAssist: number;
  xpMult: number;
  enemyCountMult: number;
}

export type ObjectiveKind = 'eliminate' | 'hold' | 'sabotage' | 'intel' | 'rescue' | 'hvt' | 'extract' | 'survive';

export interface PerkDef {
  id: string;
  name: string;
  description: string;
  unlockLevel: number;
  mods: {
    maxHp?: number;
    reloadMult?: number;
    adsTimeMult?: number;
    sprintMult?: number;
    regenDelayMult?: number;
    grenades?: number;
    ammoMult?: number;
    scavenger?: boolean;
    explosiveResist?: number;
    recoilMult?: number;
  };
}

export interface ModifierDef {
  id: string;
  name: string;
  kind: 'warning' | 'anomaly';
  description: string;
  xpBonus: number;
}
