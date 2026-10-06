/**
 * Versioned persistence. Every storage access is wrapped in try/catch and
 * falls back to an in-memory map (private windows, blocked storage, previews,
 * SSR/tests), so the game always runs. Saves are sanitized on load: any
 * malformed field is replaced by its default rather than crashing the boot.
 */
import { Attachments, Campaign, Difficulties, Perks, Weapons } from '../content';
import { DEFAULT_LOADOUT, type Loadout } from '../sim/mission';
import { levelFromXp, MAX_LEVEL } from './levels';
import { cloneSettings, DEFAULT_DIFFICULTY, defaultSettings, sanitizeSettings, type GameSettings } from './settings';

export const SAVE_VERSION = 2;
export const SAVE_KEY = 'dusty-duty-save-v2';
export const LEGACY_SAVE_KEY = 'dusty-duty-campaign-v1';
const BACKUP_KEY = 'dusty-duty-save-v2-backup';

export interface WeaponProgress {
  xp: number;
  kills: number;
  headshots: number;
}
export interface DailyRecord {
  score: number;
  stars: number;
  time: number;
}
export interface LastStandRecord {
  wave: number;
  score: number;
}
export interface ContractRecord {
  score: number;
}
export interface SaveStats {
  kills: number;
  headshots: number;
  deaths: number;
  missions: number;
  /** Seconds. */
  playTime: number;
  shots: number;
  hits: number;
}
export interface ChallengeState {
  /** UTC day key (YYYY-MM-DD) the progress belongs to. */
  dateKey: string;
  progress: Record<string, number>;
  claimed: string[];
}
export interface StreakState {
  /** UTC day key of the last login/play day. */
  lastDay: string;
  days: number;
}

export interface SaveData {
  version: number;
  profile: { xp: number; level: number; callsign: string };
  campaign: {
    /** Highest unlocked operation index in campaign order (inclusive). */
    unlockedIndex: number;
    stars: Record<string, number>;
    bestTimes: Record<string, number>;
  };
  weapons: Record<string, WeaponProgress>;
  loadout: Loadout;
  /** Equipped attachments remembered per weapon. */
  attachments: Record<string, string[]>;
  settings: GameSettings;
  records: {
    daily: Record<string, DailyRecord>;
    lastStand: Record<string, LastStandRecord>;
    contracts: Record<string, ContractRecord>;
  };
  stats: SaveStats;
  challenges: ChallengeState;
  medals: Record<string, number>;
  streak: StreakState;
}

// ---------------------------------------------------------------- defaults

export function newSave(): SaveData {
  return {
    version: SAVE_VERSION,
    profile: { xp: 0, level: 1, callsign: 'Operator' },
    campaign: { unlockedIndex: 0, stars: {}, bestTimes: {} },
    weapons: {},
    loadout: { ...DEFAULT_LOADOUT, primaryAtt: [...DEFAULT_LOADOUT.primaryAtt], secondaryAtt: [...DEFAULT_LOADOUT.secondaryAtt] },
    attachments: {},
    settings: defaultSettings(),
    records: { daily: {}, lastStand: {}, contracts: {} },
    stats: { kills: 0, headshots: 0, deaths: 0, missions: 0, playTime: 0, shots: 0, hits: 0 },
    challenges: { dateKey: '', progress: {}, claimed: [] },
    medals: {},
    streak: { lastDay: '', days: 0 },
  };
}

export function cloneSave(s: SaveData): SaveData {
  const c = JSON.parse(JSON.stringify({ ...s, settings: undefined })) as SaveData;
  c.settings = cloneSettings(s.settings);
  return c;
}

// ------------------------------------------------------------- sanitizers

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const fin = (v: unknown, def: number, lo = 0, hi = Number.MAX_SAFE_INTEGER): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
const int = (v: unknown, def: number, lo = 0, hi = Number.MAX_SAFE_INTEGER): number => Math.floor(fin(v, def, lo, hi));

function mapRecord<T>(raw: unknown, conv: (v: unknown, key: string) => T | null, maxEntries = 400): Record<string, T> {
  const out: Record<string, T> = {};
  if (!isObj(raw)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (UNSAFE_KEYS.has(k) || k.length === 0 || k.length > 64) continue;
    const c = conv(v, k);
    if (c === null) continue;
    out[k] = c;
    if (++n >= maxEntries) break;
  }
  return out;
}

/** One attachment per slot, known ids only, unique, at most 4. */
export function sanitizeAttachmentList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const slots = new Set<string>();
  const out: string[] = [];
  for (const id of raw) {
    if (typeof id !== 'string') continue;
    const def = Attachments.maybe(id);
    if (!def || slots.has(def.slot)) continue;
    slots.add(def.slot);
    out.push(id);
    if (out.length >= 4) break;
  }
  return out;
}

function sanitizeLoadoutRaw(raw: unknown): Loadout {
  const r = isObj(raw) ? raw : {};
  const d = DEFAULT_LOADOUT;
  const weapon = (id: unknown, slot: 'primary' | 'secondary', def: string): string => {
    const w = typeof id === 'string' ? Weapons.maybe(id) : undefined;
    return w && !w.aiOnly && w.slot === slot ? w.id : def;
  };
  const perk = typeof r.perk === 'string' && Perks.has(r.perk) ? r.perk : d.perk;
  return {
    primary: weapon(r.primary, 'primary', d.primary),
    primaryAtt: sanitizeAttachmentList(r.primaryAtt),
    secondary: weapon(r.secondary, 'secondary', d.secondary),
    secondaryAtt: sanitizeAttachmentList(r.secondaryAtt),
    perk,
  };
}

/** Turn arbitrary parsed data into a valid current-version save (missing/invalid fields fall back to defaults). */
export function sanitizeSave(raw: unknown): SaveData {
  const base = newSave();
  if (!isObj(raw)) return base;
  const profile = isObj(raw.profile) ? raw.profile : {};
  const campaign = isObj(raw.campaign) ? raw.campaign : {};
  const records = isObj(raw.records) ? raw.records : {};
  const stats = isObj(raw.stats) ? raw.stats : {};
  const challenges = isObj(raw.challenges) ? raw.challenges : {};
  const streak = isObj(raw.streak) ? raw.streak : {};

  const xp = int(profile.xp, 0);
  const callsign = typeof profile.callsign === 'string' ? profile.callsign.replace(/[^\w \-.]/g, '').trim().slice(0, 16) : '';

  const dailyAll = mapRecord<DailyRecord>(records.daily, (v, k) => {
    if (!DAY_RE.test(k) || !isObj(v)) return null;
    return { score: int(v.score, 0), stars: int(v.stars, 0, 0, 3), time: fin(v.time, 0) };
  });
  // Keep the most recent 120 days.
  const dailyKeys = Object.keys(dailyAll).sort().slice(-120);
  const daily: Record<string, DailyRecord> = {};
  for (const k of dailyKeys) daily[k] = dailyAll[k];

  const unlockedMax = Math.max(0, Campaign.size - 1);
  const starsRec = mapRecord<number>(campaign.stars, (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(3, Math.max(0, Math.floor(v))) : null));
  const timesRec = mapRecord<number>(campaign.bestTimes, (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null));
  let unlockedIndex = int(campaign.unlockedIndex, 0, 0, unlockedMax);
  // An op with stars was necessarily unlocked.
  for (const id of Object.keys(starsRec)) {
    const i = Campaign.indexOf(id);
    if (i > unlockedIndex && starsRec[id] > 0) unlockedIndex = i;
  }

  const attachments: Record<string, string[]> = {};
  for (const [id, list] of Object.entries(mapRecord<unknown>(raw.attachments, (v) => v))) {
    if (Weapons.has(id)) attachments[id] = sanitizeAttachmentList(list);
  }

  const weapons: Record<string, WeaponProgress> = {};
  for (const [id, p] of Object.entries(
    mapRecord<WeaponProgress>(raw.weapons, (v) =>
      isObj(v) ? { xp: int(v.xp, 0), kills: int(v.kills, 0), headshots: int(v.headshots, 0) } : null,
    ),
  )) {
    if (Weapons.has(id)) weapons[id] = p;
  }

  return {
    version: SAVE_VERSION,
    profile: { xp, level: Math.min(MAX_LEVEL, levelFromXp(xp)), callsign: callsign || base.profile.callsign },
    campaign: { unlockedIndex, stars: starsRec, bestTimes: timesRec },
    weapons,
    loadout: sanitizeLoadoutRaw(raw.loadout),
    attachments,
    settings: sanitizeSettings(raw.settings),
    records: {
      daily,
      lastStand: mapRecord<LastStandRecord>(records.lastStand, (v) =>
        isObj(v) ? { wave: int(v.wave, 0), score: int(v.score, 0) } : null,
      ),
      contracts: mapRecord<ContractRecord>(records.contracts, (v) => (isObj(v) ? { score: int(v.score, 0) } : null)),
    },
    stats: {
      kills: int(stats.kills, 0),
      headshots: int(stats.headshots, 0),
      deaths: int(stats.deaths, 0),
      missions: int(stats.missions, 0),
      playTime: fin(stats.playTime, 0),
      shots: int(stats.shots, 0),
      hits: int(stats.hits, 0),
    },
    challenges: {
      dateKey: typeof challenges.dateKey === 'string' && DAY_RE.test(challenges.dateKey) ? challenges.dateKey : '',
      progress: mapRecord<number>(challenges.progress, (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null), 16),
      claimed: Array.isArray(challenges.claimed)
        ? challenges.claimed.filter((c): c is string => typeof c === 'string' && c.length <= 40).slice(0, 16)
        : [],
    },
    medals: mapRecord<number>(raw.medals, (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : null), 64),
    streak: {
      lastDay: typeof streak.lastDay === 'string' && DAY_RE.test(streak.lastDay) ? streak.lastDay : '',
      days: int(streak.days, 0, 0, 100000),
    },
  };
}

// --------------------------------------------------------------- migration

/** Original game's three missions → the first op of the matching v2 biome/chapter. */
export const V1_OP_MAP: Record<string, string> = {
  market: 'op-market-sweep',
  fields: 'op-orchard-run',
  mountain: 'op-ridge-push',
};
const V1_DIFFICULTY_MAP: Record<string, string> = { recruit: 'recruit', veteran: 'veteran', dust: 'dust' };

export interface LegacyV1Save {
  unlocked?: string[];
  bestStars?: Partial<Record<string, number>>;
  difficulty?: string;
}

export function looksLikeV1(raw: unknown): raw is LegacyV1Save {
  return isObj(raw) && raw.version === undefined && (Array.isArray(raw.unlocked) || isObj(raw.bestStars) || typeof raw.difficulty === 'string');
}

/** Migrate the original game's `dusty-duty-campaign-v1` payload into a fresh v2 save. */
export function migrateV1(raw: unknown): SaveData {
  const save = newSave();
  if (!isObj(raw)) return save;
  const stars: Record<string, number> = {};
  const bs = isObj(raw.bestStars) ? raw.bestStars : {};
  for (const [oldId, opId] of Object.entries(V1_OP_MAP)) {
    const v = bs[oldId];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) stars[opId] = Math.min(3, Math.max(0, Math.floor(v)));
  }
  let unlockedIndex = 0;
  const unlocked = Array.isArray(raw.unlocked) ? raw.unlocked : [];
  const consider = (opId: string): void => {
    const i = Campaign.indexOf(opId);
    if (i > unlockedIndex) unlockedIndex = i;
  };
  for (const oldId of unlocked) if (typeof oldId === 'string' && V1_OP_MAP[oldId]) consider(V1_OP_MAP[oldId]);
  for (const opId of Object.keys(stars)) consider(opId);
  save.campaign = { unlockedIndex: Math.min(unlockedIndex, Math.max(0, Campaign.size - 1)), stars, bestTimes: {} };
  const diff = typeof raw.difficulty === 'string' ? V1_DIFFICULTY_MAP[raw.difficulty] : undefined;
  save.settings.difficulty = diff && Difficulties.has(diff) ? diff : DEFAULT_DIFFICULTY;
  return save;
}

/** Any historical payload (v1, v2, garbage, null) → valid current save. */
export function migrateSave(raw: unknown): SaveData {
  if (looksLikeV1(raw)) return migrateV1(raw);
  return sanitizeSave(raw);
}

export const serializeSave = (s: SaveData): string => JSON.stringify(s);

/** Parse a JSON string (also used for import). Returns null if it is not JSON. */
export function parseSave(text: string): SaveData | null {
  try {
    return migrateSave(JSON.parse(text));
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ storage

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** localStorage if it works at all, else null (blocked, private mode, no DOM). */
export function browserStorage(): StorageLike | null {
  try {
    const s = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (!s) return null;
    const probe = '__dd_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export class SaveStore {
  private data: SaveData | null = null;
  private readonly memory = new Map<string, string>();
  private storageOk = true;

  constructor(private readonly getStorage: () => StorageLike | null = browserStorage) {}

  /** True while writes actually reach durable storage. */
  get persistent(): boolean {
    return this.storageOk;
  }

  private read(key: string): string | null {
    try {
      const s = this.getStorage();
      if (s) {
        const v = s.getItem(key);
        if (v !== null) return v;
      }
    } catch {
      this.storageOk = false;
    }
    return this.memory.get(key) ?? null;
  }

  private write(key: string, value: string): void {
    this.memory.set(key, value);
    try {
      const s = this.getStorage();
      if (!s) {
        this.storageOk = false;
        return;
      }
      s.setItem(key, value);
    } catch {
      this.storageOk = false;
    }
  }

  private remove(key: string): void {
    this.memory.delete(key);
    try {
      this.getStorage()?.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  /** Read + migrate + sanitize. Corrupt payloads are kept under a backup key, then replaced. */
  load(): SaveData {
    const current = this.read(SAVE_KEY);
    if (current !== null) {
      try {
        this.data = migrateSave(JSON.parse(current));
        return this.data;
      } catch {
        this.write(BACKUP_KEY, current);
      }
    } else {
      const legacy = this.read(LEGACY_SAVE_KEY);
      if (legacy !== null) {
        try {
          this.data = migrateSave(JSON.parse(legacy));
          this.persist();
          return this.data;
        } catch {
          /* fall through to a fresh save */
        }
      }
    }
    this.data = newSave();
    return this.data;
  }

  get(): SaveData {
    return this.data ?? this.load();
  }

  /** Replace the save and persist it. */
  set(next: SaveData): SaveData {
    this.data = next;
    this.persist();
    return next;
  }

  /** Mutate a copy in place (or return a replacement), then persist. */
  update(fn: (draft: SaveData) => SaveData | void): SaveData {
    const draft = cloneSave(this.get());
    const result = fn(draft);
    return this.set(result ?? draft);
  }

  persist(): boolean {
    if (!this.data) return true;
    this.storageOk = true;
    this.write(SAVE_KEY, serializeSave(this.data));
    return this.storageOk;
  }

  /** Wipe the v2 save (and the legacy key so it is not re-imported). */
  reset(): SaveData {
    this.remove(SAVE_KEY);
    this.remove(LEGACY_SAVE_KEY);
    this.data = newSave();
    this.persist();
    return this.data;
  }

  exportText(): string {
    return serializeSave(this.get());
  }

  importText(text: string): boolean {
    const s = parseSave(text);
    if (!s) return false;
    this.set(s);
    return true;
  }
}

/** Shared app-wide store. */
export const saveStore = new SaveStore();
