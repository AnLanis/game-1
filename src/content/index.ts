import { ENEMIES, FACTIONS } from './actors';
import { BIOMES } from './biomes';
import { CAMPAIGN, type CampaignOp } from './campaign';
import { Registry } from './registry';
import { DIFFICULTIES, MODIFIERS, PERKS } from './rules';
import type {
  AttachmentDef,
  BiomeDef,
  DifficultyDef,
  EnemyDef,
  FactionDef,
  ModifierDef,
  PerkDef,
  WeaponDef,
  WeaponMods,
} from './types';
import { ATTACHMENTS, WEAPONS } from './weapons';

const positive = (label: string, v: number): string | null => (v > 0 && Number.isFinite(v) ? null : `${label} must be > 0`);

export const Weapons = new Registry<WeaponDef>('weapon', (w) =>
  positive('damage', w.damage) ??
  positive('rpm', w.rpm) ??
  positive('magSize', w.magSize) ??
  (w.rangeEnd > w.rangeStart ? null : 'rangeEnd must exceed rangeStart'),
);
export const Attachments = new Registry<AttachmentDef>('attachment');
export const Enemies = new Registry<EnemyDef>('enemy', (e) =>
  positive('hp', e.hp) ?? (e.range[1] >= e.range[0] ? null : 'range must be [min,max]'),
);
export const Factions = new Registry<FactionDef>('faction');
export const Biomes = new Registry<BiomeDef>('biome', (b) =>
  b.size[0] >= 40 && b.size[1] >= 40 ? null : 'maps must be at least 40×40 m',
);
export const Difficulties = new Registry<DifficultyDef>('difficulty');
export const Perks = new Registry<PerkDef>('perk');
export const Modifiers = new Registry<ModifierDef>('modifier');
export const Campaign = new Registry<CampaignOp>('campaign op');

Weapons.registerAll(WEAPONS);
Attachments.registerAll(ATTACHMENTS);
Enemies.registerAll(ENEMIES);
Factions.registerAll(FACTIONS);
Biomes.registerAll(BIOMES);
Difficulties.registerAll(DIFFICULTIES);
Perks.registerAll(PERKS);
Modifiers.registerAll(MODIFIERS);
Campaign.registerAll(CAMPAIGN);

// Cross-reference validation: fail fast at boot (and in unit tests) on typos.
for (const e of Enemies.all()) {
  if (!Weapons.has(e.weapon)) throw new Error(`enemy ${e.id}: unknown weapon ${e.weapon}`);
}
for (const b of Biomes.all()) {
  if (!Factions.has(b.faction)) throw new Error(`biome ${b.id}: unknown faction ${b.faction}`);
  for (const id of Object.keys(b.roster)) if (!Enemies.has(id)) throw new Error(`biome ${b.id}: unknown enemy ${id}`);
}
for (const op of Campaign.all()) {
  if (!Biomes.has(op.biome)) throw new Error(`op ${op.id}: unknown biome ${op.biome}`);
  for (const id of op.special ?? []) if (!Enemies.has(id)) throw new Error(`op ${op.id}: unknown enemy ${id}`);
}

export const PLAYER_WEAPONS = Weapons.all().filter((w) => !w.aiOnly);

/** Combine attachment mods multiplicatively (booleans OR, additive zoom). */
export function combineMods(ids: readonly string[]): WeaponMods {
  const out: WeaponMods = {};
  for (const id of ids) {
    const a = Attachments.maybe(id);
    if (!a) continue;
    for (const [key, value] of Object.entries(a.mods) as [keyof WeaponMods, number | boolean][]) {
      if (typeof value === 'boolean') (out as Record<string, unknown>)[key] = value || Boolean(out[key]);
      else if (key === 'adsZoomAdd') out.adsZoomAdd = (out.adsZoomAdd ?? 0) + value;
      else (out as Record<string, number>)[key] = ((out as Record<string, number>)[key] ?? 1) * value;
    }
  }
  return out;
}

/** Resolve a weapon definition with attachments and perk multipliers applied. */
export function resolveWeapon(
  id: string,
  attachments: readonly string[] = [],
  perk: { reloadMult?: number; adsTimeMult?: number; recoilMult?: number } = {},
): WeaponDef {
  const base = Weapons.get(id);
  const m = combineMods(attachments);
  const recoilMult = (m.recoilMult ?? 1) * (perk.recoilMult ?? 1);
  return {
    ...base,
    damage: base.damage * (m.damageMult ?? 1),
    hipSpread: base.hipSpread * (m.spreadMult ?? 1),
    adsSpread: base.adsSpread * (m.adsSpreadMult ?? 1) * (m.spreadMult ?? 1),
    magSize: Math.max(1, Math.round(base.magSize * (m.magMult ?? 1))),
    reloadTime: base.reloadTime * (m.reloadMult ?? 1) * (perk.reloadMult ?? 1),
    adsTime: base.adsTime * (m.adsTimeMult ?? 1) * (perk.adsTimeMult ?? 1),
    adsZoom: base.adsZoom + (m.adsZoomAdd ?? 0),
    rangeStart: base.rangeStart * (m.rangeMult ?? 1),
    rangeEnd: base.rangeEnd * (m.rangeMult ?? 1),
    moveSpeedMult: base.moveSpeedMult * (m.moveSpeedMult ?? 1),
    recoil: {
      ...base.recoil,
      vertical: base.recoil.vertical * recoilMult,
      horizontal: base.recoil.horizontal * recoilMult,
    },
    audio: { ...base.audio, suppressed: Boolean(m.suppressed) || base.audio.suppressed },
  };
}

export type { CampaignOp };
