/**
 * Progression: player level, weapon mastery, unlocks, stars, and folding a
 * finished mission into the save. Pure functions: nothing here touches storage
 * or the DOM; `applyMissionResult` returns a new save and leaves its input alone.
 */
import type { BonusKind } from '../content/campaign';
import { Attachments, Campaign, Difficulties, Modifiers, Perks, PLAYER_WEAPONS, Weapons } from '../content';
import type { AttachmentDef, PerkDef, WeaponDef } from '../content/types';
import { DEFAULT_LOADOUT, type GameMode, type Loadout } from '../sim/mission';
import { touchStreak, updateChallenges, type ChallengeDef } from './challenges';
import {
  levelFromXp,
  weaponLevelFromXp,
  weaponXpGain,
  MAX_LEVEL,
  WEAPON_MAX_LEVEL,
} from './levels';
import { cloneSave, sanitizeAttachmentList, type SaveData } from './save';

export {
  levelFromXp,
  levelProgress,
  MAX_LEVEL,
  weaponLevelFromXp,
  weaponLevelProgress,
  weaponXpForLevel,
  weaponXpGain,
  WEAPON_MAX_LEVEL,
  xpForLevel,
  type LevelProgress,
} from './levels';

export interface MissionResult {
  mode: GameMode;
  /** Campaign op id / daily date key / contract key / Last Stand biome id. */
  recordKey: string;
  opId?: string;
  success: boolean;
  /** Seconds elapsed. */
  time: number;
  parTime: number;
  kills: number;
  headshots: number;
  /** 0..1 */
  accuracy: number;
  shots: number;
  hits: number;
  damageTaken: number;
  score: number;
  /** XP from sim scoring (before difficulty / modifier multipliers). */
  xp: number;
  medals: Record<string, number>;
  stars: number;
  weaponUsage: Record<string, { kills: number; headshots: number }>;
  difficultyId: string;
  modifiers: string[];
  /** Last Stand: wave reached. */
  wave?: number;
  /** Optional extras (bonus / challenge evaluation). */
  grenadeKills?: number;
  civilianKills?: number;
  /** Pre-evaluated bonus objective; overrides derived evaluation when set. */
  bonusMet?: boolean;
}

// ------------------------------------------------------------------ unlocks

export const unlockedWeapons = (level: number): WeaponDef[] => PLAYER_WEAPONS.filter((w) => w.unlockLevel <= level);
export const isWeaponUnlocked = (level: number, weaponId: string): boolean => {
  const w = Weapons.maybe(weaponId);
  return !!w && !w.aiOnly && w.unlockLevel <= level;
};
export const unlockedPerks = (level: number): PerkDef[] => Perks.all().filter((p) => p.unlockLevel <= level);
export const isPerkUnlocked = (level: number, perkId: string): boolean => {
  const p = Perks.maybe(perkId);
  return !!p && p.unlockLevel <= level;
};

/** Attachments compatible with the weapon whose mastery requirement is met. */
export function unlockedAttachments(weaponId: string, masteryLevel: number): AttachmentDef[] {
  const w = Weapons.maybe(weaponId);
  if (!w) return [];
  return Attachments.all().filter((a) => a.mastery <= masteryLevel && a.classes.includes(w.cls));
}

/** All attachments for a weapon (locked ones included) for a full customization list. */
export function attachmentsForWeapon(weaponId: string): AttachmentDef[] {
  const w = Weapons.maybe(weaponId);
  return w ? Attachments.all().filter((a) => a.classes.includes(w.cls)) : [];
}

export const weaponMastery = (save: SaveData, weaponId: string): number => weaponLevelFromXp(save.weapons[weaponId]?.xp ?? 0);

/** Human-readable things that unlock exactly at `level`. */
export function unlocksAtLevel(level: number): string[] {
  const out: string[] = [];
  for (const w of PLAYER_WEAPONS) if (w.unlockLevel === level) out.push(`Weapon unlocked: ${w.name}`);
  for (const p of Perks.all()) if (p.unlockLevel === level) out.push(`Perk unlocked: ${p.name}`);
  return out;
}

/** The next level (after `level`) that unlocks something, for "next unlock" hints. */
export function nextUnlock(level: number): { level: number; unlocks: string[] } | null {
  for (let l = level + 1; l <= MAX_LEVEL; l += 1) {
    const u = unlocksAtLevel(l);
    if (u.length) return { level: l, unlocks: u };
  }
  return null;
}

// ------------------------------------------------------------------- loadout

/** Clamp a loadout to what the save has actually unlocked (weapons by level, attachments by mastery, perk by level). */
export function sanitizeLoadout(save: SaveData, wanted: Loadout = save.loadout): Loadout {
  const level = save.profile.level;
  const pickWeapon = (id: string, slot: 'primary' | 'secondary', fallback: string): string => {
    const w = Weapons.maybe(id);
    return w && !w.aiOnly && w.slot === slot && w.unlockLevel <= level ? w.id : fallback;
  };
  const primary = pickWeapon(wanted.primary, 'primary', DEFAULT_LOADOUT.primary);
  const secondary = pickWeapon(wanted.secondary, 'secondary', DEFAULT_LOADOUT.secondary);
  const okAtt = (weaponId: string, list: string[]): string[] => {
    const allowed = new Set(unlockedAttachments(weaponId, weaponMastery(save, weaponId)).map((a) => a.id));
    return sanitizeAttachmentList(list.filter((id) => allowed.has(id)));
  };
  return {
    primary,
    primaryAtt: okAtt(primary, wanted.primaryAtt),
    secondary,
    secondaryAtt: okAtt(secondary, wanted.secondaryAtt),
    perk: isPerkUnlocked(level, wanted.perk) ? wanted.perk : DEFAULT_LOADOUT.perk,
  };
}

/** Validate + store a loadout; also remembers each weapon's equipped attachments. */
export function setLoadout(save: SaveData, wanted: Loadout): SaveData {
  const next = cloneSave(save);
  const l = sanitizeLoadout(next, wanted);
  next.loadout = l;
  next.attachments[l.primary] = [...l.primaryAtt];
  next.attachments[l.secondary] = [...l.secondaryAtt];
  return next;
}

/** Equipped attachments remembered for a weapon (validated against current mastery). */
export function attachmentsFor(save: SaveData, weaponId: string): string[] {
  const allowed = new Set(unlockedAttachments(weaponId, weaponMastery(save, weaponId)).map((a) => a.id));
  return sanitizeAttachmentList((save.attachments[weaponId] ?? []).filter((id) => allowed.has(id)));
}

// ------------------------------------------------------------------- stars

export type StarInput = Pick<MissionResult, 'success' | 'time'> &
  Partial<Pick<MissionResult, 'parTime' | 'accuracy' | 'headshots' | 'damageTaken' | 'grenadeKills' | 'civilianKills' | 'bonusMet'>>;

export interface StarSource {
  parTime?: number;
  bonus?: { kind: BonusKind; target: number } | null;
}

/** Did the run satisfy the bonus objective? `result.bonusMet` (if the sim already decided) wins. */
export function isBonusMet(result: StarInput, bonus: StarSource['bonus']): boolean {
  if (typeof result.bonusMet === 'boolean') return result.bonusMet;
  if (!bonus) return false;
  switch (bonus.kind) {
    case 'headshots':
      return (result.headshots ?? 0) >= bonus.target;
    case 'nodamage':
      return (result.damageTaken ?? Number.POSITIVE_INFINITY) < bonus.target;
    case 'accuracy':
      return (result.accuracy ?? 0) >= bonus.target;
    case 'nocivilians':
      return (result.civilianKills ?? 0) <= bonus.target;
    case 'grenadekills':
      return (result.grenadeKills ?? 0) >= bonus.target;
    case 'speed':
      return result.time <= bonus.target;
  }
}

/** ★ complete, ★★ complete under par time, ★★★ under par and bonus objective met. */
export function computeStars(result: StarInput, op?: StarSource | null): number {
  if (!result.success) return 0;
  const par = result.parTime && result.parTime > 0 ? result.parTime : (op?.parTime ?? 0);
  if (!(par > 0) || !(result.time <= par)) return 1;
  return isBonusMet(result, op?.bonus ?? null) ? 3 : 2;
}

// ----------------------------------------------------------- applying results

export interface ApplyOutcome {
  save: SaveData;
  /** Total XP added to the profile (mission + challenge rewards). */
  xpGained: number;
  missionXp: number;
  challengeXp: number;
  /** Player levels reached by this result, ascending. */
  levelUps: number[];
  /** Human-readable unlock / achievement lines for the results screen. */
  unlocks: string[];
  /** Personal best for this mode's record (stars/time, score, or wave). */
  newBest: boolean;
  completedChallenges: ChallengeDef[];
}

const finite = (v: number | undefined, def = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : def);

/** XP multiplier from difficulty and active modifiers. */
export function xpMultiplier(difficultyId: string, modifiers: readonly string[]): number {
  const mult = Difficulties.maybe(difficultyId)?.xpMult ?? 1;
  let bonus = 0;
  for (const id of modifiers) bonus += Modifiers.maybe(id)?.xpBonus ?? 0;
  return mult * (1 + bonus);
}

export function applyMissionResult(input: SaveData, result: MissionResult, date: Date = new Date()): ApplyOutcome {
  const save = cloneSave(input);
  const unlocks: string[] = [];
  let newBest = false;

  // XP.
  const missionXp = Math.round(Math.max(0, finite(result.xp)) * xpMultiplier(result.difficultyId, result.modifiers ?? []));
  const oldLevel = levelFromXp(save.profile.xp);

  // Weapon mastery.
  for (const [id, use] of Object.entries(result.weaponUsage ?? {})) {
    const def = Weapons.maybe(id);
    if (!def || def.aiOnly) continue;
    const kills = Math.max(0, Math.floor(finite(use.kills)));
    const heads = Math.max(0, Math.floor(finite(use.headshots)));
    if (kills === 0 && heads === 0) continue;
    const cur = save.weapons[id] ?? { xp: 0, kills: 0, headshots: 0 };
    const before = weaponLevelFromXp(cur.xp);
    cur.xp += weaponXpGain(kills, heads);
    cur.kills += kills;
    cur.headshots += heads;
    save.weapons[id] = cur;
    const after = Math.min(WEAPON_MAX_LEVEL, weaponLevelFromXp(cur.xp));
    if (after > before) {
      for (const a of Attachments.all()) {
        if (a.mastery > before && a.mastery <= after && a.classes.includes(def.cls)) {
          unlocks.push(`Attachment unlocked: ${a.name} (${def.name})`);
        }
      }
    }
  }

  // Stats + medals.
  const st = save.stats;
  st.kills += Math.max(0, Math.floor(finite(result.kills)));
  st.headshots += Math.max(0, Math.floor(finite(result.headshots)));
  st.shots += Math.max(0, Math.floor(finite(result.shots)));
  st.hits += Math.max(0, Math.floor(finite(result.hits)));
  st.missions += 1;
  st.playTime += Math.max(0, finite(result.time));
  if (!result.success) st.deaths += 1;
  for (const [medal, n] of Object.entries(result.medals ?? {})) {
    if (!(n > 0) || medal === '__proto__' || medal === 'constructor') continue;
    save.medals[medal] = (save.medals[medal] ?? 0) + Math.floor(n);
  }

  // Mode records.
  const score = Math.max(0, Math.floor(finite(result.score)));
  const time = Math.max(0, finite(result.time));
  const key = result.recordKey;
  const stars = Math.max(0, Math.min(3, Math.floor(finite(result.stars))));
  switch (result.mode) {
    case 'campaign': {
      const opId = result.opId ?? key;
      if (!Campaign.has(opId)) break;
      const oldStars = save.campaign.stars[opId] ?? 0;
      if (stars > oldStars) {
        save.campaign.stars[opId] = stars;
        newBest = true;
      }
      if (result.success && time > 0) {
        const oldTime = save.campaign.bestTimes[opId];
        if (oldTime === undefined || time < oldTime) {
          save.campaign.bestTimes[opId] = time;
          newBest = true;
        }
      }
      if (result.success) {
        const nextIdx = Math.min(Campaign.indexOf(opId) + 1, Campaign.size - 1);
        if (nextIdx > save.campaign.unlockedIndex) {
          save.campaign.unlockedIndex = nextIdx;
          unlocks.push(`Operation unlocked: ${Campaign.all()[nextIdx].name}`);
        }
      }
      break;
    }
    case 'daily': {
      const old = save.records.daily[key];
      if (!old || score > old.score) {
        save.records.daily[key] = { score, stars, time };
        newBest = true;
      }
      break;
    }
    case 'laststand': {
      const wave = Math.max(0, Math.floor(finite(result.wave)));
      const old = save.records.lastStand[key];
      if (!old || wave > old.wave || (wave === old.wave && score > old.score)) {
        save.records.lastStand[key] = { wave, score };
        newBest = true;
      }
      break;
    }
    case 'contract': {
      const old = save.records.contracts[key];
      if (!old || score > old.score) {
        save.records.contracts[key] = { score };
        newBest = true;
      }
      break;
    }
  }

  // Login streak and daily challenges.
  save.streak = touchStreak(save.streak, date).streak;
  const ch = updateChallenges(save.challenges, result, date);
  save.challenges = ch.state;
  for (const c of ch.completed) unlocks.push(`Challenge complete: ${c.title} (+${c.xp} XP)`);

  // Apply XP and derive level-ups.
  const xpGained = missionXp + ch.xp;
  save.profile.xp += xpGained;
  const newLevel = Math.min(MAX_LEVEL, levelFromXp(save.profile.xp));
  save.profile.level = newLevel;
  const levelUps: number[] = [];
  for (let l = oldLevel + 1; l <= newLevel; l += 1) {
    levelUps.push(l);
    unlocks.push(...unlocksAtLevel(l));
  }
  // Keep the stored loadout consistent with what is actually unlocked.
  save.loadout = sanitizeLoadout(save);

  return { save, xpGained, missionXp, challengeXp: ch.xp, levelUps, unlocks, newBest, completedChallenges: ch.completed };
}
