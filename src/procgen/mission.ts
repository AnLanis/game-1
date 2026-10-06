import { Biomes, Campaign, Difficulties, Enemies, Modifiers, PLAYER_WEAPONS } from '../content';
import { CONTRACT_TYPES, type BonusKind, type CampaignOp, type ObjectiveTemplate } from '../content/campaign';
import type { BiomeDef } from '../content/types';
import { dailySeed, hashString, mixSeed, Rng } from '../engine/rng';
import type { LevelData, Point, SquadSpawn } from '../sim/level';
import { DEFAULT_LOADOUT, type GameMode, type Loadout, type MissionConfig, type ObjectiveSpec } from '../sim/mission';
import { LevelBuilder, type LayoutResult, type Site } from './builder';
import { layoutCanyon } from './layouts/canyon';
import { layoutColony } from './layouts/colony';
import { layoutCompound } from './layouts/compound';
import { layoutFields } from './layouts/fields';
import { layoutTown } from './layouts/town';
import { layoutYard } from './layouts/yard';

const LAYOUTS: Record<BiomeDef['layout'], (b: LevelBuilder) => LayoutResult> = {
  town: layoutTown,
  fields: layoutFields,
  canyon: layoutCanyon,
  yard: layoutYard,
  compound: layoutCompound,
  colony: layoutColony,
};

export const GENERATOR_VERSION = 1;

export interface GeneratedLevel {
  level: LevelData;
  layout: LayoutResult;
  dist: Int32Array;
  maxDist: number;
}

/** Pure: (biome, seed) → level. Same inputs always give the same map. */
export function generateLevel(biomeId: string, seed: number): GeneratedLevel {
  const biome = Biomes.get(biomeId);
  const rng = new Rng(mixSeed(seed, hashString(`${biomeId}:v${GENERATOR_VERSION}`)));
  const b = new LevelBuilder(biome, rng.fork('layout'), biome.size[0], biome.size[1]);
  const layout = LAYOUTS[biome.layout](b);
  b.ensureConnected(layout.spawn.x, layout.spawn.z);
  const level = b.finalize(seed, layout.spawn);
  const dist = b.distanceField(layout.spawn.x, layout.spawn.z);
  let maxDist = 1;
  for (let k = 0; k < dist.length; k += 1) if (dist[k] > maxDist) maxDist = dist[k];
  // Layouts place hold/extract/site anchors by coordinate; some land inside props or
  // walls. Snap them to the nearest reachable cell rather than silently dropping them
  // (dropping left some maps with no extraction point and objectives on arbitrary sites).
  const snapAll = <T extends Point>(list: T[]): T[] => {
    const out: T[] = [];
    for (const s of list) {
      const p = snapReachable(level, dist, s);
      if (p) out.push({ ...s, x: p.x, z: p.z });
    }
    return out;
  };
  layout.sites = snapAll(layout.sites);
  layout.holds = snapAll(layout.holds);
  layout.extracts = snapAll(layout.extracts);
  level.reinforcements = snapAll(level.reinforcements);
  return { level, layout, dist, maxDist };
}

/** Nearest reachable (dist >= 0) cell centre within `maxR` cells of a point; the point itself if already reachable. */
export function snapReachable(level: LevelData, dist: Int32Array, p: Point, maxR = 12): Point | null {
  const g = level.grid;
  const i0 = g.cellX(p.x);
  const j0 = g.cellZ(p.z);
  if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return null;
  if (g.inBounds(i0, j0) && dist[j0 * g.w + i0] >= 0) return p;
  for (let r = 1; r <= maxR; r += 1) {
    let best: Point | null = null;
    let bd = Infinity;
    for (let dj = -r; dj <= r; dj += 1) {
      for (let di = -r; di <= r; di += 1) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = i0 + di;
        const j = j0 + dj;
        if (!g.inBounds(i, j) || dist[j * g.w + i] < 0) continue;
        const d = di * di + dj * dj;
        if (d < bd) {
          bd = d;
          best = { x: g.centerX(i), z: g.centerZ(j) };
        }
      }
    }
    if (best) return best;
  }
  return null;
}

function distAt(level: LevelData, dist: Int32Array, x: number, z: number): number {
  const g = level.grid;
  const i = g.cellX(x);
  const j = g.cellZ(z);
  if (!g.inBounds(i, j)) return -1;
  return dist[j * g.w + i];
}

export interface PlanRequest {
  mode: GameMode;
  biomeId: string;
  seed: number;
  difficultyId: string;
  objectives: ObjectiveTemplate[];
  threat: number;
  special?: string[];
  civilians?: number;
  loadout?: Loadout;
  modifiers?: string[];
  title: string;
  codename: string;
  parTime: number;
  bonus: { kind: BonusKind; target: number; label: string } | null;
  recordKey: string;
}

const THREAT_COST: Record<string, number> = { rifleman: 1, rusher: 1, breacher: 1.2, marksman: 1.2, grenadier: 1.2, juggernaut: 3, officer: 2 };

const objectiveLabel = (t: ObjectiveTemplate, biome: BiomeDef, where: string): string => {
  switch (t.kind) {
    case 'eliminate':
      return (t.count ?? 1) >= 1 ? 'Eliminate all hostiles' : 'Break the defenders';
    case 'hold':
      return `Hold ${where}`;
    case 'sabotage':
      return biome.id === 'port' ? 'Sabotage the fuel pumps' : biome.layout === 'colony' ? 'Destroy the comm arrays' : 'Destroy the weapons caches';
    case 'intel':
      return 'Recover the intel';
    case 'rescue':
      return 'Rescue the hostage';
    case 'hvt':
      return 'Eliminate the HVT';
    case 'extract':
      return 'Reach extraction';
    case 'survive':
      return 'Survive the onslaught';
  }
};

/** Build a complete, deterministic mission from a request. */
export function planMission(req: PlanRequest): MissionConfig {
  const biome = Biomes.get(req.biomeId);
  const diff = Difficulties.get(req.difficultyId);
  const gen = generateLevel(req.biomeId, req.seed);
  const { level, layout, dist, maxDist } = gen;
  const rng = new Rng(mixSeed(req.seed, hashString(`plan:${req.recordKey}`)));
  const modifiers = req.modifiers ?? [];
  const lastStand = req.mode === 'laststand';

  const d = (p: Point): number => distAt(level, dist, p.x, p.z);
  const used: Point[] = [];
  let lastStandCenter: Point = level.playerSpawn;
  const farEnough = (p: Point, min: number): boolean => used.every((u) => Math.hypot(u.x - p.x, u.z - p.z) >= min);

  if (lastStand) {
    // Defend the most central hold point.
    const center = layout.holds[0] ?? layout.sites[0] ?? level.playerSpawn;
    // Spawn 2 m off the centre, snapped onto reachable ground (the raw offset can land inside a prop).
    const spawn = snapReachable(level, dist, { x: center.x, z: center.z - 2 }) ?? center;
    level.playerSpawn = { x: spawn.x, z: spawn.z, yaw: rng.range(-Math.PI, Math.PI) };
    lastStandCenter = { x: center.x, z: center.z };
  }

  const pickSites = (n: number, minFrac: number, prefer: Site['kind'][], spacing: number): Site[] => {
    const candidates = layout.sites
      .filter((s) => d(s) >= minFrac * maxDist)
      .map((s) => ({ s, score: (prefer.includes(s.kind) ? 2 : 0) + rng.next() + (d(s) / maxDist) * 0.8 }))
      .sort((a, b) => b.score - a.score);
    const out: Site[] = [];
    for (const { s } of candidates) {
      if (out.length >= n) break;
      if (!farEnough(s, spacing)) continue;
      out.push(s);
      used.push(s);
    }
    // Relax spacing if we couldn't place enough.
    for (const { s } of candidates) {
      if (out.length >= n) break;
      if (out.includes(s)) continue;
      out.push(s);
      used.push(s);
    }
    return out;
  };

  const specs: ObjectiveSpec[] = [];
  const guardSites: { p: Point; weight: number }[] = [];
  let hvtSite: Site | null = null;
  for (const t of req.objectives) {
    const base = { kind: t.kind, count: t.count, seconds: t.seconds, waves: t.waves } as ObjectiveSpec;
    switch (t.kind) {
      case 'hold':
      case 'survive': {
        const holds = [...layout.holds].sort((a, b) => Math.abs(d(a) / maxDist - 0.6) - Math.abs(d(b) / maxDist - 0.6));
        const c = lastStand ? lastStandCenter : holds[0] ?? layout.sites[0] ?? level.playerSpawn;
        const lm = nearestLandmark(level, c);
        base.zone = { x: c.x, z: c.z, r: t.kind === 'survive' ? 14 : 6 };
        base.label = objectiveLabel(t, biome, lm ? `the ${lm}` : 'the zone');
        used.push(c);
        if (!lastStand) guardSites.push({ p: c, weight: 2 });
        break;
      }
      case 'extract': {
        const ex = [...layout.extracts].sort((a, b) => d(b) - d(a))[0] ?? [...layout.sites].sort((a, b) => d(b) - d(a))[0] ?? level.playerSpawn;
        base.zone = { x: ex.x, z: ex.z, r: 4 };
        base.label = objectiveLabel(t, biome, '');
        break;
      }
      case 'sabotage':
      case 'intel': {
        const n = t.count ?? 3;
        const sites = pickSites(n, 0.3, ['courtyard', 'interior', 'building', 'landmark', 'alley', 'edge'], 16);
        base.targets = sites.map((s) => ({ x: s.x, z: s.z }));
        base.label = objectiveLabel(t, biome, '');
        for (const s of sites) guardSites.push({ p: s, weight: 1.3 });
        break;
      }
      case 'rescue': {
        const [s] = pickSites(1, 0.5, ['interior', 'courtyard', 'building'], 20);
        base.targets = s ? [{ x: s.x, z: s.z }] : [];
        base.label = objectiveLabel(t, biome, '');
        if (s) guardSites.push({ p: s, weight: 2 });
        break;
      }
      case 'hvt': {
        const [s] = pickSites(1, 0.45, ['landmark', 'building', 'courtyard', 'checkpoint'], 20);
        hvtSite = s ?? null;
        base.label = objectiveLabel(t, biome, '');
        break;
      }
      case 'eliminate':
        base.label = objectiveLabel(t, biome, '');
        break;
    }
    specs.push(base);
  }

  // ------------------------------------------------------------- squads
  const countMult = diff.enemyCountMult * (modifiers.includes('reinforced') ? 1.4 : 1);
  let budget = lastStand ? 0 : req.threat * countMult;
  const roster = Object.entries(biome.roster)
    .filter(([id, w]) => id !== 'officer' && (w ?? 0) > 0)
    .map(([id, w]) => [id, id === 'marksman' && modifiers.includes('marksmen') ? (w ?? 0) * 3 : w ?? 0] as [string, number]);
  const squads: SquadSpawn[] = [];
  const spawnPt = level.playerSpawn;
  const minSpawnDist = 22;

  if (hvtSite) {
    squads.push({ x: hvtSite.x, z: hvtSite.z, members: ['officer', 'rifleman', 'breacher'], patrol: [], behavior: 'hvt', order: d(hvtSite) });
    budget -= 3;
  }
  const special = [...(req.special ?? [])].filter((id) => id !== 'officer' || !hvtSite);
  // Special enemies guard the deepest objective.
  const deepest = [...guardSites].sort((a, b) => d(b.p) - d(a.p))[0]?.p ?? [...layout.sites].sort((a, b) => d(b) - d(a))[0];
  for (const id of special) {
    if (!Enemies.has(id) || !deepest) continue;
    squads.push({ x: deepest.x + rng.range(-2, 2), z: deepest.z + rng.range(-2, 2), members: [id], patrol: [], behavior: 'guard', order: d(deepest) });
    budget -= THREAT_COST[id] ?? 1;
  }

  // Objective guards first, then general sites ordered by distance for pacing.
  const sites = [...layout.sites].filter((s) => Math.hypot(s.x - spawnPt.x, s.z - spawnPt.z) > minSpawnDist);
  sites.sort((a, b) => d(a) - d(b));
  const queue: { p: Point; weight: number }[] = [...guardSites.filter((g) => Math.hypot(g.p.x - spawnPt.x, g.p.z - spawnPt.z) > minSpawnDist)];
  for (const s of sites) if (!queue.some((q) => Math.hypot(q.p.x - s.x, q.p.z - s.z) < 8)) queue.push({ p: s, weight: 1 });
  let qi = 0;
  let guard = 0;
  while (budget > 0.5 && queue.length && guard < 200) {
    guard += 1;
    const slot = queue[qi % queue.length];
    qi += 1;
    const frac = d(slot.p) / maxDist;
    const size = Math.max(1, Math.min(4, Math.round((1.5 + frac * 2) * slot.weight * rng.range(0.8, 1.2))));
    const members: string[] = [];
    for (let n = 0; n < size && budget > 0.5; n += 1) {
      let id = rng.weighted(roster, (r) => r[1])[0];
      // Early encounters stay gentle: no heavies close to spawn.
      if (frac < 0.35 && (id === 'juggernaut' || id === 'marksman')) id = 'rifleman';
      members.push(id);
      budget -= THREAT_COST[id] ?? 1;
    }
    if (!members.length) break;
    const patrolTarget = rng.chance(0.3) ? nearestOther(layout.sites, slot.p) : null;
    squads.push({
      x: slot.p.x + rng.range(-1.5, 1.5),
      z: slot.p.z + rng.range(-1.5, 1.5),
      members,
      patrol: patrolTarget ? [{ x: slot.p.x, z: slot.p.z }, patrolTarget, { x: slot.p.x, z: slot.p.z }] : [],
      behavior: patrolTarget ? 'patrol' : 'guard',
      order: d(slot.p),
    });
  }
  level.squads = squads;

  // Civilians (market biomes mostly).
  const civCount = req.civilians ?? 0;
  const civSites = layout.sites.filter((s) => s.kind === 'plaza' || s.kind === 'open');
  for (let n = 0; n < civCount && civSites.length; n += 1) {
    const s = civSites[n % civSites.length];
    level.civilians.push({ x: s.x + rng.range(-3, 3), z: s.z + rng.range(-3, 3) });
  }

  // Pickups: ammo caches along the way, grenades deeper in.
  const pickupSites = rng.shuffle([...layout.sites]).slice(0, 7);
  pickupSites.forEach((s, n) => level.pickups.push({ x: s.x + 1.2, z: s.z - 1.2, kind: n % 3 === 2 ? 'grenade' : 'ammo' }));
  if (modifiers.includes('ironman')) for (const s of pickupSites.slice(0, 4)) level.pickups.push({ x: s.x - 1, z: s.z + 1, kind: 'medkit' });

  for (const s of specs) {
    if (s.zone) level.markers.push({ kind: s.kind === 'extract' ? 'extract' : 'hold', x: s.zone.x, z: s.zone.z, radius: s.zone.r });
    for (const t of s.targets ?? []) level.markers.push({ kind: s.kind === 'intel' ? 'intel' : s.kind === 'rescue' ? 'hostage' : 'cache', x: t.x, z: t.z, radius: 1 });
  }

  return {
    mode: req.mode,
    seed: req.seed,
    title: req.title,
    codename: req.codename,
    biomeId: req.biomeId,
    difficultyId: req.difficultyId,
    level,
    loadout: req.loadout ?? DEFAULT_LOADOUT,
    modifiers,
    objectives: specs,
    parTime: req.parTime,
    bonus: req.bonus,
    recordKey: req.recordKey,
  };
}

function nearestLandmark(level: LevelData, p: Point): string | null {
  let best: string | null = null;
  let bd = 14;
  for (const l of level.landmarks) {
    const dd = Math.hypot(l.x - p.x, l.z - p.z);
    if (dd < bd) {
      bd = dd;
      best = l.name;
    }
  }
  return best;
}

function nearestOther(sites: Site[], p: Point): Point | null {
  let best: Site | null = null;
  let bd = Infinity;
  for (const s of sites) {
    const dd = Math.hypot(s.x - p.x, s.z - p.z);
    if (dd < 8 || dd > 30) continue;
    if (dd < bd) {
      bd = dd;
      best = s;
    }
  }
  return best ? { x: best.x, z: best.z } : null;
}

// ------------------------------------------------------------- mode builders

export function campaignMission(op: CampaignOp, difficultyId: string, loadout: Loadout): MissionConfig {
  return planMission({
    mode: 'campaign',
    biomeId: op.biome,
    seed: op.seed,
    difficultyId,
    objectives: op.objectives,
    threat: op.threat,
    special: op.special,
    civilians: op.civilians,
    loadout,
    modifiers: [],
    title: op.name,
    codename: op.codename,
    parTime: op.parTime,
    bonus: op.bonus,
    recordKey: op.id,
  });
}

export interface DailyInfo {
  key: string;
  dayNumber: number;
  seed: number;
  biomeId: string;
  contractId: string;
  modifiers: string[];
  loadout: Loadout;
}

/** Everyone on Earth (and Mars) gets the same Daily Op. */
export function dailyInfo(date = new Date()): DailyInfo {
  const { seed, key, dayNumber } = dailySeed(date);
  const rng = new Rng(seed);
  const biomeId = rng.pick(Biomes.all()).id;
  const contract = rng.pick(CONTRACT_TYPES.filter((c) => c.id !== 'rescue'));
  const warnings = Modifiers.all().filter((m) => m.kind === 'warning');
  const anomalies = Modifiers.all().filter((m) => m.kind === 'anomaly');
  const modifiers = [rng.pick(warnings).id];
  if (rng.chance(0.6)) modifiers.push(rng.pick(anomalies).id);
  const primaries = PLAYER_WEAPONS.filter((w) => w.slot === 'primary');
  const secondaries = PLAYER_WEAPONS.filter((w) => w.slot === 'secondary');
  const loadout: Loadout = {
    primary: rng.pick(primaries).id,
    primaryAtt: [],
    secondary: rng.pick(secondaries).id,
    secondaryAtt: [],
    perk: 'quickhands',
  };
  return { key, dayNumber, seed, biomeId, contractId: contract.id, modifiers, loadout };
}

export function dailyMission(info: DailyInfo): MissionConfig {
  const contract = CONTRACT_TYPES.find((c) => c.id === info.contractId) ?? CONTRACT_TYPES[0];
  const biome = Biomes.get(info.biomeId);
  return planMission({
    mode: 'daily',
    biomeId: info.biomeId,
    seed: info.seed,
    difficultyId: 'regular',
    objectives: contract.objectives,
    threat: 16,
    special: contract.id === 'hvt' ? ['officer'] : [],
    civilians: biome.layout === 'town' ? 3 : 0,
    loadout: info.loadout,
    modifiers: info.modifiers,
    title: `Daily Op #${info.dayNumber}`,
    codename: `DAILY ${info.key}`,
    parTime: 330,
    bonus: { kind: 'headshots', target: 8, label: '8 headshots' },
    recordKey: `daily-${info.key}`,
  });
}

export function contractMission(biomeId: string, contractId: string, seed: number, difficultyId: string, loadout: Loadout, modifiers: string[] = []): MissionConfig {
  const contract = CONTRACT_TYPES.find((c) => c.id === contractId) ?? CONTRACT_TYPES[0];
  const biome = Biomes.get(biomeId);
  return planMission({
    mode: 'contract',
    biomeId,
    seed,
    difficultyId,
    objectives: contract.objectives,
    threat: 15,
    special: contract.id === 'hvt' ? ['officer'] : [],
    civilians: biome.layout === 'town' ? 3 : 0,
    loadout,
    modifiers,
    title: `${contract.name}: ${biome.name}`,
    codename: contract.name.toUpperCase(),
    parTime: 360,
    bonus: { kind: 'accuracy', target: 0.35, label: '35% accuracy' },
    recordKey: `contract-${biomeId}-${contractId}`,
  });
}

export function lastStandMission(biomeId: string, seed: number, difficultyId: string, loadout: Loadout): MissionConfig {
  const biome = Biomes.get(biomeId);
  return planMission({
    mode: 'laststand',
    biomeId,
    seed,
    difficultyId,
    objectives: [{ kind: 'survive' }],
    threat: 0,
    loadout,
    modifiers: [],
    title: `Last Stand: ${biome.name}`,
    codename: 'LAST STAND',
    parTime: 0,
    bonus: null,
    recordKey: `laststand-${biomeId}`,
  });
}

export { Campaign };
