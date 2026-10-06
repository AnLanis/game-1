/**
 * Pure XP curves (no registry / save dependencies) so both the save layer and
 * progression can use them without an import cycle.
 *
 * Player level: cumulative XP to reach level n is `XP_BASE * (n-1)^1.5`
 * (research: "x * level^1.5"), so level 2 = 900 XP, level 10 ~ 24k, level 50 ~ 309k.
 * Weapon mastery: same shape, smaller base, capped at level 10.
 */

export const MAX_LEVEL = 50;
export const XP_BASE = 900;
export const XP_EXPONENT = 1.5;

export const WEAPON_MAX_LEVEL = 10;
export const WEAPON_XP_BASE = 600;
/** Weapon XP per kill / extra per headshot kill. */
export const WEAPON_XP_PER_KILL = 100;
export const WEAPON_XP_PER_HEADSHOT = 50;

const curve = (base: number, level: number, max: number): number => {
  const l = Math.min(max, Math.floor(level));
  if (!(l > 1)) return 0;
  return Math.round((base * Math.pow(l - 1, XP_EXPONENT)) / 10) * 10;
};

const levelOf = (base: number, xp: number, max: number): number => {
  if (!(xp > 0)) return 1;
  let l = Math.min(max, Math.floor(Math.pow(xp / base, 1 / XP_EXPONENT)) + 1);
  while (l < max && curve(base, l + 1, max) <= xp) l += 1;
  while (l > 1 && curve(base, l, max) > xp) l -= 1;
  return l;
};

export interface LevelProgress {
  level: number;
  /** XP earned inside this level. */
  current: number;
  /** XP span of this level (0 at max level). */
  needed: number;
  /** 0..1 */
  fraction: number;
  maxed: boolean;
}

const progressOf = (base: number, xp: number, max: number): LevelProgress => {
  const level = levelOf(base, xp, max);
  if (level >= max) return { level, current: 0, needed: 0, fraction: 1, maxed: true };
  const lo = curve(base, level, max);
  const hi = curve(base, level + 1, max);
  const current = Math.max(0, xp - lo);
  return { level, current, needed: hi - lo, fraction: Math.min(1, current / (hi - lo)), maxed: false };
};

/** Total XP required to reach player level `n` (level 1 = 0). Strictly increasing up to MAX_LEVEL. */
export const xpForLevel = (n: number): number => curve(XP_BASE, n, MAX_LEVEL);
export const levelFromXp = (xp: number): number => levelOf(XP_BASE, xp, MAX_LEVEL);
export const levelProgress = (xp: number): LevelProgress => progressOf(XP_BASE, xp, MAX_LEVEL);

/** Total weapon XP required to reach mastery level `n` (1..10). */
export const weaponXpForLevel = (n: number): number => curve(WEAPON_XP_BASE, n, WEAPON_MAX_LEVEL);
export const weaponLevelFromXp = (xp: number): number => levelOf(WEAPON_XP_BASE, xp, WEAPON_MAX_LEVEL);
export const weaponLevelProgress = (xp: number): LevelProgress => progressOf(WEAPON_XP_BASE, xp, WEAPON_MAX_LEVEL);

export const weaponXpGain = (kills: number, headshots: number): number =>
  Math.max(0, kills) * WEAPON_XP_PER_KILL + Math.max(0, headshots) * WEAPON_XP_PER_HEADSHOT;
