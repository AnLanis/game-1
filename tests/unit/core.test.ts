import { describe, expect, it } from 'vitest';
import { codeToSeed, dailySeed, hashString, Rng, seedToCode } from '../../src/engine/rng';
import { dirFromYawPitch, yawTo } from '../../src/engine/math';
import { Grid, newRayHit, Shape } from '../../src/sim/grid';
import { NavGrid } from '../../src/sim/nav';
import { Biomes, Campaign, Enemies, PLAYER_WEAPONS, resolveWeapon, Weapons } from '../../src/content';

describe('rng', () => {
  it('is deterministic per seed and forks independently', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const xs = Array.from({ length: 50 }, () => a.next());
    const ys = Array.from({ length: 50 }, () => b.next());
    expect(xs).toEqual(ys);
    expect(new Rng(43).next()).not.toEqual(new Rng(42).next());
    const f1 = new Rng(7).fork('ai');
    const f2 = new Rng(7).fork('ai');
    expect(f1.next()).toEqual(f2.next());
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('round-trips shareable seed codes', () => {
    for (const seed of [0, 1, 123456, 0xdeadbeef >>> 0, 987654321]) {
      const code = seedToCode(seed);
      expect(code).toHaveLength(6);
      // Codes cover 32^6 ≈ 1.07e9 values; larger seeds wrap.
      expect(codeToSeed(code)).toBe(seed % 32 ** 6);
    }
  });

  it('gives everyone the same daily seed for a UTC day', () => {
    const a = dailySeed(new Date(Date.UTC(2026, 8, 30, 1)));
    const b = dailySeed(new Date(Date.UTC(2026, 8, 30, 23)));
    const c = dailySeed(new Date(Date.UTC(2026, 9, 1, 1)));
    expect(a.seed).toBe(b.seed);
    expect(a.seed).not.toBe(c.seed);
    expect(a.key).toBe('2026-09-30');
    expect(hashString('x')).toBe(hashString('x'));
  });
});

describe('math conventions', () => {
  it('yaw 0 looks down -Z and yawTo inverts dirFromYawPitch', () => {
    const d = dirFromYawPitch(0, 0, { x: 0, y: 0, z: 0 });
    expect(d.z).toBeCloseTo(-1);
    for (const yaw of [0, 0.5, -1.2, 2.8]) {
      const v = dirFromYawPitch(yaw, 0, { x: 0, y: 0, z: 0 });
      expect(yawTo(0, 0, v.x, v.z)).toBeCloseTo(yaw);
    }
  });
});

describe('heightfield grid', () => {
  const grid = Grid.centered(20, 20);
  // Wall at cell i=15 (x = 5..6), 3 m tall, spanning all j.
  for (let j = 0; j < 20; j += 1) grid.set(15, j, 3, 1);
  // Low crate at (10, 10) → x 0..1, z 0..1, 1 m tall.
  grid.set(10, 10, 1, 2);
  // Pillar at (12, 5)
  grid.set(12, 5, 4, 3);
  grid.shape[5 * 20 + 12] = Shape.Cylinder;
  grid.radius[5 * 20 + 12] = 0.25;
  const hit = newRayHit();

  it('hits a wall side at the exact distance', () => {
    expect(grid.raycast(0.5, 1.5, 3.5, 1, 0, 0, 100, hit)).toBe(true);
    expect(hit.x).toBeCloseTo(5);
    expect(hit.nx).toBe(-1);
  });

  it('passes over low cover but not through it', () => {
    expect(grid.raycast(-5, 1.6, 0.5, 1, 0, 0, 100, hit)).toBe(true);
    expect(hit.x).toBeCloseTo(5); // flew over the 1 m crate, hit the wall
    expect(grid.raycast(-5, 0.6, 0.5, 1, 0, 0, 100, hit)).toBe(true);
    expect(hit.x).toBeCloseTo(0); // crate side
  });

  it('lands on the top face when shooting down', () => {
    const dx = 1;
    const dy = -0.5;
    const l = Math.hypot(dx, dy);
    expect(grid.raycast(-0.6, 1.5, 0.5, dx / l, dy / l, 0, 100, hit)).toBe(true);
    expect(hit.ny).toBe(1);
    expect(hit.y).toBeCloseTo(1);
  });

  it('hits the ground', () => {
    const l = Math.hypot(1, -1);
    expect(grid.raycast(-8, 2, -8.5, 1 / l, -1 / l, 0, 100, hit)).toBe(true);
    expect(hit.y).toBeCloseTo(0);
    expect(hit.x).toBeCloseTo(-6);
  });

  it('treats cylinder cells as round', () => {
    // Ray grazing the cell corner misses a 0.25 m pillar centred in the cell.
    expect(grid.raycast(2.05, 1, -9, 0, 0, 1, 30, hit) && hit.x < 2.6 && Math.abs(hit.z + 5) < 1).toBe(false);
    expect(grid.raycast(2.5, 1, -9, 0, 0, 1, 30, hit)).toBe(true);
    expect(hit.z).toBeCloseTo(-4.75);
  });

  it('computes line of sight', () => {
    expect(grid.lineOfSight(-5, 1.5, 0.5, 4, 1.5, 0.5, hit)).toBe(true);
    expect(grid.lineOfSight(-5, 1.5, 0.5, 7, 1.5, 0.5, hit)).toBe(false);
  });
});

describe('navigation', () => {
  it('finds a path around a wall with a gap', () => {
    const grid = Grid.centered(30, 30);
    for (let j = 0; j < 30; j += 1) if (j !== 25) grid.set(15, j, 3, 1);
    const nav = new NavGrid(grid);
    const path = nav.findPath(-10, -10, 10, -10);
    expect(path).not.toBeNull();
    // Must route through the gap near z = 10.5.
    expect(path!.some((p) => p.z > 8)).toBe(true);
    nav.buildFlow(10, -10);
    expect(Number.isFinite(nav.flowDistance(-10, -10))).toBe(true);
    expect(nav.flowDistance(-10, -10)).toBeGreaterThan(40);
  });

  it('returns null when unreachable', () => {
    const grid = Grid.centered(20, 20);
    for (let j = 0; j < 20; j += 1) grid.set(10, j, 3, 1);
    const nav = new NavGrid(grid);
    expect(nav.findPath(-5, 0, 5, 0)).toBeNull();
  });
});

describe('content registries', () => {
  it('cross-references resolve', () => {
    expect(Weapons.size).toBeGreaterThan(8);
    expect(Enemies.size).toBeGreaterThanOrEqual(7);
    expect(Biomes.size).toBe(6);
    expect(Campaign.size).toBe(12);
    for (const e of Enemies.all()) expect(Weapons.has(e.weapon)).toBe(true);
    expect(PLAYER_WEAPONS.every((w) => !w.aiOnly)).toBe(true);
  });

  it('applies attachments multiplicatively', () => {
    const base = Weapons.get('carbine');
    const w = resolveWeapon('carbine', ['compensator', 'extmag']);
    expect(w.recoil.vertical).toBeCloseTo(base.recoil.vertical * 0.78);
    expect(w.magSize).toBe(Math.round(base.magSize * 1.4));
    expect(w.reloadTime).toBeCloseTo(base.reloadTime * 1.15);
    const s = resolveWeapon('carbine', ['suppressor']);
    expect(s.audio.suppressed).toBe(true);
  });
});
