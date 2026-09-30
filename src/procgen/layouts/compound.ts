import { Surface } from '../../sim/grid';
import type { Point } from '../../sim/level';
import { Owner, type LayoutResult, type LevelBuilder, type Site } from '../builder';
import { barrelGroup, coverCluster, crateStack, edgeEntries, rcx, rcz, rockCluster, scatterDecor, vehicle, type Rect } from '../common';

/**
 * Fortified compound in the snow: perimeter wall with gates and corner
 * towers, bunkers and barracks inside, a fuel dump that chain-reacts,
 * and snowdrift/rock cover in the approach fields outside.
 */
export function layoutCompound(b: LevelBuilder): LayoutResult {
  const rng = b.rng;
  const BORDER = 2;
  b.border(BORDER, 10, Surface.Rock);
  const spawn = { x: b.cx(Math.floor(b.w / 2)), z: b.cz(BORDER + 2), yaw: Math.PI };
  b.reserve(Math.floor(b.w / 2) - 4, BORDER, Math.floor(b.w / 2) + 4, BORDER + 6);
  const sites: Site[] = [];
  const holds: Point[] = [];
  const m = Math.floor(Math.min(b.w, b.h) * 0.22);
  const inner: Rect = { i0: m, j0: m + 2, i1: b.w - m - 1, j1: b.h - m + 2 };
  // Perimeter wall (3.2 m) with 3 gates.
  const WALL = 3.2;
  const gateW = 4;
  const gates = {
    south: Math.floor((inner.i0 + inner.i1) / 2) + rng.int(-4, 4),
    west: Math.floor((inner.j0 + inner.j1) / 2) + rng.int(-4, 4),
    east: Math.floor((inner.j0 + inner.j1) / 2) + rng.int(-4, 4),
  };
  for (let i = inner.i0; i <= inner.i1; i += 1) {
    if (Math.abs(i - gates.south) > gateW / 2) b.solid(i, inner.j0, WALL, Surface.Concrete, Owner.Block);
    b.solid(i, inner.j1, WALL, Surface.Concrete, Owner.Block);
  }
  for (let j = inner.j0; j <= inner.j1; j += 1) {
    if (Math.abs(j - gates.west) > gateW / 2) b.solid(inner.i0, j, WALL, Surface.Concrete, Owner.Block);
    if (Math.abs(j - gates.east) > gateW / 2) b.solid(inner.i1, j, WALL, Surface.Concrete, Owner.Block);
  }
  // Corner towers.
  for (const [i, j] of [
    [inner.i0 - 1, inner.j0 - 1],
    [inner.i1 - 1, inner.j0 - 1],
    [inner.i0 - 1, inner.j1 - 1],
    [inner.i1 - 1, inner.j1 - 1],
  ]) {
    b.solidRect(i, j, i + 2, j + 2, 7, Surface.Concrete, Owner.Prop);
    b.prop('tower', b.cx(i) + 1, b.cz(j) + 1, { sx: 3, sy: 9, sz: 3 });
    b.lamp(b.cx(i) + 1, b.cz(j) + 1, 8.5, b.biome.palette.lamp, 1.4);
  }
  b.paintRect(b.grid.ox + inner.i0 + 1, b.grid.oz + inner.j0 + 1, b.grid.ox + inner.i1, b.grid.oz + inner.j1, 'pad', Surface.Concrete);

  // Keep gate approaches open.
  b.reserve(gates.south - 2, inner.j0 - 3, gates.south + 2, inner.j0 + 3);
  // Buildings inside: command, barracks, two bunkers, garage.
  const ci = Math.floor((inner.i0 + inner.i1) / 2);
  const cj = Math.floor((inner.j0 + inner.j1) / 2);
  const bld: [Rect, number, 'bunker' | 'warehouse' | 'brick', string][] = [
    [{ i0: ci - 5, j0: cj + 6, i1: ci + 5, j1: cj + 12 }, 6, 'brick', 'Command'],
    [{ i0: inner.i0 + 3, j0: cj + 4, i1: inner.i0 + 9, j1: inner.j1 - 4 }, 4, 'bunker', 'Barracks'],
    [{ i0: inner.i1 - 9, j0: cj + 3, i1: inner.i1 - 3, j1: cj + 9 }, 3.4, 'bunker', 'Bunker East'],
    [{ i0: inner.i0 + 4, j0: inner.j0 + 4, i1: inner.i0 + 10, j1: inner.j0 + 9 }, 3.4, 'bunker', 'Bunker West'],
    [{ i0: inner.i1 - 12, j0: inner.j0 + 3, i1: inner.i1 - 4, j1: inner.j0 + 8 }, 5, 'warehouse', 'Garage'],
  ];
  for (const [r, h, style, name] of bld) {
    if (!b.isFree(r.i0, r.j0, r.i1, r.j1, true)) continue;
    b.building(r.i0, r.j0, r.i1, r.j1, h, style === 'brick' ? 'brick' : style);
    b.landmarks.push({ name, x: rcx(b, r), z: rcz(b, r) });
    // Site just outside the door (south face).
    sites.push({ x: rcx(b, r), z: b.cz(r.j0) - 1.5, kind: 'building', r: 2 });
  }
  // Fuel dump (explosive barrel cluster) + sandbag nests.
  for (let n = 0; n < 5; n += 1) barrelGroup(b, ci - 8 + n * 2, cj - 2 + (n % 2), true);
  b.landmarks.push({ name: 'Fuel Dump', x: b.cx(ci - 4), z: b.cz(cj - 1) });
  for (let n = 0; n < 5; n += 1) {
    const i = rng.int(inner.i0 + 3, inner.i1 - 5);
    const j = rng.int(inner.j0 + 3, inner.j1 - 4);
    coverCluster(b, i, j, rng.chance(0.5), 'military');
  }
  vehicle(b, ci + 4, cj - 6, true, 'truck');
  b.pillar('antenna', ci + 7, cj + 2, 12, 0.35, Surface.Metal);
  b.prop('dish', b.cx(ci + 9), b.cz(cj + 1), { sy: 3 });
  sites.push({ x: b.cx(ci), z: b.cz(cj), kind: 'landmark', r: 6 });
  holds.push({ x: b.cx(ci), z: b.cz(cj + 2) });

  // Outside: snowdrifts, rocks, pines, sandbag outposts.
  for (let n = 0; n < 70; n += 1) {
    const c = b.randomOpenCell((i, j) => (i < inner.i0 - 2 || i > inner.i1 + 2 || j < inner.j0 - 2 || j > inner.j1 + 2) && !b.reserved[b.k(i, j)]);
    if (!c) break;
    const r = rng.next();
    if (r < 0.35) b.solidProp('drift', c.i, c.j, c.i + 1, c.j, 0.9, Surface.Snow, { rot: 0 });
    else if (r < 0.6) rockCluster(b, c.i, c.j);
    else if (r < 0.85) b.pillar('tree', c.i, c.j, 7, 0.3, Surface.Wood, { sy: rng.range(6, 9), variant: 7 });
    else if (r < 0.95) crateStack(b, c.i, c.j);
    else b.sandbags(c.i, c.j, 3, rng.chance(0.5));
  }
  scatterDecor(b, 'drift', 40);

  const extracts: Point[] = [
    { x: b.cx(BORDER + 4), z: b.cz(b.h - BORDER - 4) },
    { x: b.cx(b.w - BORDER - 5), z: b.cz(b.h - BORDER - 4) },
  ];
  sites.push({ x: b.cx(gates.south), z: b.cz(inner.j0 - 4), kind: 'checkpoint', r: 4 });
  sites.push({ x: b.cx(inner.i0 - 5), z: b.cz(gates.west), kind: 'checkpoint', r: 4 });
  sites.push({ x: b.cx(inner.i1 + 5), z: b.cz(gates.east), kind: 'checkpoint', r: 4 });
  b.reinforcements.push(...edgeEntries(b, BORDER, 10, spawn, 30));
  return { spawn, sites, holds, extracts };
}
