import { describe, expect, it } from 'vitest';
import { Biomes, Campaign } from '../../src/content';
import { CONTRACT_TYPES } from '../../src/content/campaign';
import { campaignMission, contractMission, dailyInfo, dailyMission, generateLevel, lastStandMission } from '../../src/procgen/mission';
import { CellFlag } from '../../src/sim/grid';
import { DEFAULT_LOADOUT, type MissionConfig } from '../../src/sim/mission';
import { NavGrid } from '../../src/sim/nav';
import { hashGrid, nonBorderCount } from './helpers';

const SEEDS = [1, 2, 3, 17, 101, 4242, 90210, 0xbeef];

function reachableNav(cfg: { level: { grid: import('../../src/sim/grid').Grid; playerSpawn: { x: number; z: number } } }): NavGrid {
  const nav = new NavGrid(cfg.level.grid);
  nav.computeReachable(cfg.level.playerSpawn.x, cfg.level.playerSpawn.z);
  return nav;
}

function isReachable(nav: NavGrid, x: number, z: number): boolean {
  const g = nav.grid;
  const i = g.cellX(x);
  const j = g.cellZ(z);
  return g.inBounds(i, j) && g.walkable(i, j) && nav.reachable[j * g.w + i] === 1;
}

describe('procgen: level validity', () => {
  for (const biome of Biomes.all()) {
    it(`${biome.id}: ${SEEDS.length} seeds generate walkable, connected, deterministic levels`, () => {
      for (const seed of SEEDS) {
        const gen = generateLevel(biome.id, seed);
        const { level } = gen;
        const g = level.grid;
        expect(g.w).toBe(biome.size[0]);
        expect(g.h).toBe(biome.size[1]);

        // Spawn.
        const sx = g.cellX(level.playerSpawn.x);
        const sz = g.cellZ(level.playerSpawn.z);
        expect(g.walkable(sx, sz), `${biome.id}/${seed}: spawn cell walkable`).toBe(true);
        expect(Number.isFinite(level.playerSpawn.yaw)).toBe(true);

        // Walkable + reachable share of the interior.
        const nav = reachableNav({ level });
        let reachable = 0;
        for (let k = 0; k < nav.reachable.length; k += 1) if (nav.reachable[k]) reachable += 1;
        const frac = reachable / nonBorderCount(g);
        expect(frac, `${biome.id}/${seed}: reachable fraction ${frac.toFixed(2)}`).toBeGreaterThanOrEqual(0.35);

        // Every walkable cell must be reachable (ensureConnected guarantees no pockets).
        let walkable = 0;
        for (let j = 0; j < g.h; j += 1) for (let i = 0; i < g.w; i += 1) if (g.walkable(i, j)) walkable += 1;
        expect(reachable, `${biome.id}/${seed}: unreachable walkable pockets`).toBe(walkable);

        // Reinforcement points.
        expect(level.reinforcements.length, `${biome.id}/${seed}: reinforcement points`).toBeGreaterThanOrEqual(2);
        for (const r of level.reinforcements) {
          expect(Number.isFinite(r.x) && Number.isFinite(r.z)).toBe(true);
          expect(isReachable(nav, r.x, r.z), `${biome.id}/${seed}: reinforcement ${r.x},${r.z} reachable`).toBe(true);
        }

        // Sites / holds / extracts the mission planner draws on.
        for (const s of [...gen.layout.sites, ...gen.layout.holds, ...gen.layout.extracts]) {
          expect(Number.isFinite(s.x) && Number.isFinite(s.z)).toBe(true);
          expect(isReachable(nav, s.x, s.z), `${biome.id}/${seed}: site reachable`).toBe(true);
        }
        expect(gen.layout.sites.length).toBeGreaterThanOrEqual(5);
        expect(gen.layout.extracts.length).toBeGreaterThanOrEqual(1);

        // No NaNs anywhere in the arrays.
        for (let k = 0; k < g.height.length; k += 1) {
          if (!Number.isFinite(g.height[k]) || !Number.isFinite(g.radius[k])) throw new Error(`NaN cell ${k}`);
        }
        // Border ring is solid.
        for (let i = 0; i < g.w; i += 1) expect(g.flags[i] & CellFlag.Border).toBeTruthy();

        // Breakables reference live breakable cells.
        for (const b of level.breakables) expect(g.flags[b.cell] & CellFlag.Breakable).toBeTruthy();
      }
    });

    it(`${biome.id}: same seed gives an identical map, different seeds differ`, () => {
      const a = generateLevel(biome.id, 777).level;
      const b = generateLevel(biome.id, 777).level;
      expect(hashGrid(a.grid)).toBe(hashGrid(b.grid));
      expect(a.playerSpawn).toEqual(b.playerSpawn);
      expect(a.reinforcements).toEqual(b.reinforcements);
      expect(a.props.length).toBe(b.props.length);
      const c = generateLevel(biome.id, 778).level;
      expect(hashGrid(c.grid)).not.toBe(hashGrid(a.grid));
    });
  }
});

/** Every point an objective needs the player (or an NPC) to stand on. */
function objectivePoints(cfg: MissionConfig): { label: string; x: number; z: number }[] {
  const out: { label: string; x: number; z: number }[] = [];
  for (const o of cfg.objectives) {
    if (o.zone) out.push({ label: `${o.kind} zone`, x: o.zone.x, z: o.zone.z });
    for (const t of o.targets ?? []) out.push({ label: `${o.kind} target`, x: t.x, z: t.z });
  }
  return out;
}

function validateMission(cfg: MissionConfig, tag: string): void {
  const level = cfg.level;
  const g = level.grid;
  const nav = reachableNav(cfg);
  const sp = level.playerSpawn;
  expect(g.walkable(g.cellX(sp.x), g.cellZ(sp.z)), `${tag}: spawn walkable`).toBe(true);
  for (const p of objectivePoints(cfg)) {
    expect(Number.isFinite(p.x) && Number.isFinite(p.z), `${tag}: ${p.label} finite`).toBe(true);
    expect(isReachable(nav, p.x, p.z), `${tag}: ${p.label} (${p.x.toFixed(1)},${p.z.toFixed(1)}) reachable`).toBe(true);
  }
  for (const o of cfg.objectives) {
    if (o.kind === 'sabotage' || o.kind === 'intel') expect(o.targets?.length, `${tag}: ${o.kind} targets`).toBe(o.count ?? 3);
    if (o.kind === 'rescue') expect(o.targets?.length, `${tag}: rescue target`).toBe(1);
    if (o.kind === 'hold' || o.kind === 'extract' || o.kind === 'survive') expect(o.zone, `${tag}: ${o.kind} zone`).toBeTruthy();
  }
  if (cfg.objectives.some((o) => o.kind === 'hvt')) {
    expect(level.squads.some((s) => s.behavior === 'hvt'), `${tag}: hvt squad`).toBe(true);
  }
  for (const s of level.squads) {
    expect(Number.isFinite(s.x) && Number.isFinite(s.z), `${tag}: squad finite`).toBe(true);
    const d = Math.hypot(s.x - sp.x, s.z - sp.z);
    expect(d, `${tag}: squad ${s.members.join(',')} ${d.toFixed(1)} m from spawn`).toBeGreaterThanOrEqual(20);
    // Squads must not spawn inside walls (walkablePoint may only nudge them a few cells).
    const k = nav.nearestWalkable(g.cellX(s.x), g.cellZ(s.z), 4);
    expect(k, `${tag}: squad has walkable ground nearby`).toBeGreaterThanOrEqual(0);
    expect(nav.reachable[k], `${tag}: squad ground reachable`).toBe(1);
    for (const p of s.patrol) expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
  }
  for (const c of level.civilians) expect(Number.isFinite(c.x) && Number.isFinite(c.z)).toBe(true);
  for (const p of level.pickups) expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
}

describe('procgen: mission planning', () => {
  for (const biome of Biomes.all()) {
    it(`${biome.id}: every contract type places reachable objectives on ${SEEDS.length} seeds`, () => {
      for (const contract of CONTRACT_TYPES) {
        for (const seed of SEEDS) {
          const cfg = contractMission(biome.id, contract.id, seed, 'regular', DEFAULT_LOADOUT);
          validateMission(cfg, `${biome.id}/${contract.id}/${seed}`);
        }
      }
    });
  }

  it('campaign ops plan valid missions on several difficulties', () => {
    for (const op of Campaign.all()) {
      for (const diff of ['recruit', 'regular', 'dust']) {
        validateMission(campaignMission(op, diff, DEFAULT_LOADOUT), `${op.id}/${diff}`);
      }
    }
  });

  it('planning is deterministic (squads, objectives, spawn)', () => {
    for (const op of Campaign.all()) {
      const a = campaignMission(op, 'regular', DEFAULT_LOADOUT);
      const b = campaignMission(op, 'regular', DEFAULT_LOADOUT);
      expect(hashGrid(a.level.grid)).toBe(hashGrid(b.level.grid));
      expect(a.level.squads).toEqual(b.level.squads);
      expect(a.objectives).toEqual(b.objectives);
      expect(a.level.playerSpawn).toEqual(b.level.playerSpawn);
    }
  });

  it('last stand puts a walkable spawn and a walkable defence zone in every biome', () => {
    for (const biome of Biomes.all()) {
      for (const seed of SEEDS) {
        const cfg = lastStandMission(biome.id, seed, 'regular', DEFAULT_LOADOUT);
        validateMission(cfg, `laststand/${biome.id}/${seed}`);
        expect(cfg.level.squads.length).toBe(0);
      }
    }
  });

  it('daily ops are valid for a run of days', () => {
    for (let day = 0; day < 20; day += 1) {
      const info = dailyInfo(new Date(Date.UTC(2026, 8, 1 + day, 12)));
      validateMission(dailyMission(info), `daily/${info.key}/${info.biomeId}/${info.contractId}`);
    }
  });
});
