/**
 * Daily challenges (3 per UTC day, one per difficulty tier) and login streak.
 * The set for a date is a pure function of `dailySeed(date)`, so every player
 * sees the same three challenges and tests are deterministic.
 */
import { Difficulties, Weapons } from '../content';
import { dailySeed, Rng } from '../engine/rng';
import type { MissionResult } from './progression';
import type { ChallengeState, StreakState } from './save';

export interface ChallengeDef {
  /** Stable pool id (unique within a day). */
  id: string;
  title: string;
  /** Count required to complete (kills, headshots, runs, waves...). */
  target: number;
  /** The rolled parameter (e.g. the accuracy % or damage cap); equals `target` for plain counters. */
  param: number;
  /** XP reward, granted automatically on completion. */
  xp: number;
  /** 0 easy, 1 medium, 2 hard. */
  tier: 0 | 1 | 2;
}

export const TIER_XP: readonly [number, number, number] = [300, 500, 800];

interface PoolEntry {
  id: string;
  tier: 0 | 1 | 2;
  /** Entries sharing a group never appear together on the same day. */
  group?: string;
  /** Rolled parameter choices. */
  targets: readonly number[];
  /** Runs needed when the parameter is a threshold rather than the count itself (default: the parameter). */
  goal?: number;
  title: (n: number) => string;
  /** 'sum' accumulates per-run contributions; 'max' keeps the best single run. */
  kind: 'sum' | 'max';
  /** Contribution of one finished run, given the rolled parameter. */
  measure: (r: MissionResult, param: number) => number;
}

const medal = (r: MissionResult, id: string): number => Math.max(0, Math.floor(r.medals?.[id] ?? 0));
const isOp = (r: MissionResult): boolean => r.mode !== 'laststand';
const wonOp = (r: MissionResult): boolean => r.success && isOp(r);
const diffRank = (id: string): number => Difficulties.indexOf(id);

function killsByClass(r: MissionResult, classes: readonly string[]): number {
  let n = 0;
  for (const [id, u] of Object.entries(r.weaponUsage ?? {})) {
    const w = Weapons.maybe(id);
    if (w && classes.includes(w.cls)) n += Math.max(0, u.kills);
  }
  return n;
}

const POOL: readonly PoolEntry[] = [
  // Easy
  { id: 'kills', tier: 0, targets: [25, 40], title: (n) => `Eliminate ${n} hostiles`, kind: 'sum', measure: (r) => r.kills },
  { id: 'grenades', tier: 0, targets: [2, 3], title: (n) => `Get ${n} grenade kills`, kind: 'sum', measure: (r) => medal(r, 'grenade') },
  { id: 'pointblank', tier: 0, targets: [3, 5], title: (n) => `Get ${n} Point Blank kills`, kind: 'sum', measure: (r) => medal(r, 'pointblank') },
  { id: 'finish', tier: 0, targets: [1], title: () => 'Complete any operation', kind: 'sum', measure: (r) => (wonOp(r) ? 1 : 0) },
  // Medium
  { id: 'headshots', tier: 1, targets: [15, 20, 25], title: (n) => `Get ${n} headshots`, kind: 'sum', measure: (r) => r.headshots },
  { id: 'double', tier: 1, targets: [2, 3, 4], title: (n) => `Get a Double Kill ×${n}`, kind: 'sum', measure: (r) => medal(r, 'double') },
  {
    id: 'smg',
    tier: 1,
    targets: [25, 30, 40],
    title: (n) => `Kill ${n} hostiles with SMGs`,
    kind: 'sum',
    measure: (r) => killsByClass(r, ['smg']),
  },
  {
    id: 'laststand',
    group: 'laststand',
    tier: 1,
    targets: [5, 6],
    title: (n) => `Reach wave ${n} in Last Stand`,
    kind: 'max',
    measure: (r) => (r.mode === 'laststand' ? Math.max(0, Math.floor(r.wave ?? 0)) : 0),
  },
  {
    id: 'accuracy',
    tier: 1,
    goal: 1,
    targets: [35, 40, 45],
    title: (n) => `Finish an op with ${n}% accuracy`,
    kind: 'sum',
    measure: (r, n) => (wonOp(r) && r.accuracy * 100 >= n ? 1 : 0),
  },
  { id: 'daily', tier: 1, targets: [1], title: () => 'Complete the Daily Op', kind: 'sum', measure: (r) => (r.mode === 'daily' && r.success ? 1 : 0) },
  // Hard
  {
    id: 'veteran',
    tier: 2,
    targets: [1],
    title: () => 'Win an op on Veteran or higher',
    kind: 'sum',
    measure: (r) => (wonOp(r) && diffRank(r.difficultyId) >= diffRank('veteran') ? 1 : 0),
  },
  {
    id: 'lowdamage',
    tier: 2,
    goal: 1,
    targets: [50, 75],
    title: (n) => `Finish an op taking under ${n} damage`,
    kind: 'sum',
    measure: (r, n) => (wonOp(r) && r.damageTaken < n ? 1 : 0),
  },
  { id: 'stars3', tier: 2, targets: [1], title: () => 'Earn 3 stars on an operation', kind: 'sum', measure: (r) => (wonOp(r) && r.stars >= 3 ? 1 : 0) },
  {
    id: 'laststand-high',
    group: 'laststand',
    tier: 2,
    targets: [8, 10, 12],
    title: (n) => `Reach wave ${n} in Last Stand`,
    kind: 'max',
    measure: (r) => (r.mode === 'laststand' ? Math.max(0, Math.floor(r.wave ?? 0)) : 0),
  },
  { id: 'ghost', tier: 2, targets: [1], title: () => 'Earn an Untouchable ×5 streak medal', kind: 'sum', measure: (r) => medal(r, 'streak5') },
];

const BY_ID = new Map(POOL.map((p) => [p.id, p]));

export const CHALLENGE_POOL_SIZE = POOL.length;

/** The three challenges for a given UTC day (deterministic per date). */
export function dailyChallenges(date: Date = new Date()): ChallengeDef[] {
  const rng = new Rng(dailySeed(date).seed).fork('challenges');
  const out: ChallengeDef[] = [];
  const groups = new Set<string>();
  for (const tier of [0, 1, 2] as const) {
    const entry = rng.pick(POOL.filter((p) => p.tier === tier && !(p.group && groups.has(p.group))));
    if (entry.group) groups.add(entry.group);
    const param = rng.pick(entry.targets);
    out.push({ id: entry.id, title: entry.title(param), target: entry.goal ?? param, param, xp: TIER_XP[tier], tier });
  }
  return out;
}

export interface ChallengeStatus {
  def: ChallengeDef;
  progress: number;
  done: boolean;
  claimed: boolean;
}

/** Per-challenge status for menus; progress is treated as zero if the stored day is stale. */
export function challengeStatus(state: ChallengeState, date: Date = new Date()): ChallengeStatus[] {
  const key = dailySeed(date).key;
  const fresh = state.dateKey === key;
  return dailyChallenges(date).map((def) => {
    const progress = fresh ? Math.min(def.target, state.progress[def.id] ?? 0) : 0;
    const claimed = fresh && state.claimed.includes(def.id);
    return { def, progress, done: progress >= def.target, claimed };
  });
}

export interface ChallengeUpdate {
  state: ChallengeState;
  /** Challenges completed (and paid out) by this result. */
  completed: ChallengeDef[];
  xp: number;
}

/** Fold one finished run into today's challenges; completed ones are claimed and paid out immediately. */
export function updateChallenges(state: ChallengeState, result: MissionResult, date: Date = new Date()): ChallengeUpdate {
  const key = dailySeed(date).key;
  const next: ChallengeState =
    state.dateKey === key
      ? { dateKey: key, progress: { ...state.progress }, claimed: [...state.claimed] }
      : { dateKey: key, progress: {}, claimed: [] };
  const completed: ChallengeDef[] = [];
  let xp = 0;
  for (const def of dailyChallenges(date)) {
    if (next.claimed.includes(def.id)) continue;
    const entry = BY_ID.get(def.id);
    if (!entry) continue;
    const gain = entry.measure(result, def.param);
    const cur = next.progress[def.id] ?? 0;
    const value = entry.kind === 'max' ? Math.max(cur, gain) : cur + gain;
    next.progress[def.id] = Math.min(def.target, value);
    if (value >= def.target) {
      next.claimed.push(def.id);
      completed.push(def);
      xp += def.xp;
    }
  }
  return { state: next, completed, xp };
}

// ------------------------------------------------------------------ streak

const DAY_MS = 86_400_000;

export interface StreakUpdate {
  streak: StreakState;
  /** First visit of a new UTC day. */
  isNewDay: boolean;
  /** A previous streak existed but lapsed. */
  broken: boolean;
}

/** Register activity today: consecutive UTC days extend the streak, a gap resets it to 1. */
export function touchStreak(streak: StreakState, date: Date = new Date()): StreakUpdate {
  const today = dailySeed(date).key;
  if (streak.lastDay === today) return { streak: { ...streak }, isNewDay: false, broken: false };
  const yesterday = dailySeed(new Date(date.getTime() - DAY_MS)).key;
  const continued = streak.lastDay === yesterday;
  return {
    streak: { lastDay: today, days: continued ? streak.days + 1 : 1 },
    isNewDay: true,
    broken: !continued && streak.days > 1,
  };
}
