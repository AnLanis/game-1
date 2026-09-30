import { CellFlag, Surface } from '../../sim/grid';
import type { Point } from '../../sim/level';
import { Owner, type LayoutResult, type LevelBuilder, type Site } from '../builder';
import { addSite, barrelGroup, coverCluster, crateStack, edgeEntries, hayBale, lowWall, rcx, rcz, rh, rw, scatterDecor, vehicle, type Rect } from '../common';

/**
 * Farmland: a 3×3 patchwork of orchards, crop fields and farmsteads divided
 * by hedgerows with gaps, crossed by dirt tracks. Long sightlines reward
 * marksmen; hedges and bales give crouch-height cover.
 */
export function layoutFields(b: LevelBuilder): LayoutResult {
  const rng = b.rng;
  const BORDER = 2;
  // Tree-line border (rendered as dense foliage).
  b.border(BORDER, 9, Surface.Foliage);
  const sites: Site[] = [];
  const holds: Point[] = [];

  // Dirt tracks: one N–S, one E–W, slightly off-centre.
  const trackI = Math.floor(b.w * rng.range(0.42, 0.58));
  const trackJ = Math.floor(b.h * rng.range(0.4, 0.6));
  const tracks: Rect[] = [
    { i0: trackI - 1, i1: trackI + 2, j0: BORDER, j1: b.h - BORDER - 1 },
    { i0: BORDER, i1: b.w - BORDER - 1, j0: trackJ - 1, j1: trackJ + 2 },
  ];
  for (const t of tracks) {
    b.paintRect(b.grid.ox + t.i0, b.grid.oz + t.j0, b.grid.ox + t.i1 + 1, b.grid.oz + t.j1 + 1, 'dirt', Surface.Sand);
    b.reserve(t.i0 + 1, t.j0, t.i1 - 1, t.j1);
    if (rw(t) < rh(t)) b.reserve(t.i0 + 1, t.j0, t.i0 + 2, t.j1);
  }

  // Quadrants split by the tracks → zones.
  const xs = [BORDER, trackI - 2, trackI + 3, b.w - BORDER - 1];
  const zs = [BORDER, trackJ - 2, trackJ + 3, b.h - BORDER - 1];
  const zones: Rect[] = [
    { i0: xs[0], j0: zs[0], i1: xs[1], j1: zs[1] },
    { i0: xs[2], j0: zs[0], i1: xs[3], j1: zs[1] },
    { i0: xs[0], j0: zs[2], i1: xs[1], j1: zs[3] },
    { i0: xs[2], j0: zs[2], i1: xs[3], j1: zs[3] },
  ];
  // Spawn: south track.
  const spawn = { x: b.cx(trackI), z: b.cz(BORDER + 2), yaw: Math.PI };
  b.reserve(trackI - 4, BORDER, trackI + 4, BORDER + 6);

  const kinds = rng.shuffle(['orchard', 'farmstead', 'crops', rng.chance(0.5) ? 'orchard' : 'hay']);
  // Ensure the farmstead is in the north half for mission flow.
  const fIdx = kinds.indexOf('farmstead');
  const northIdx = rng.chance(0.5) ? 2 : 3;
  [kinds[fIdx], kinds[northIdx]] = [kinds[northIdx], kinds[fIdx]];

  zones.forEach((z, n) => {
    hedgeRing(b, z);
    const kind = kinds[n];
    if (kind === 'orchard') orchard(b, z, sites);
    else if (kind === 'farmstead') farmstead(b, z, sites, holds);
    else if (kind === 'crops') crops(b, z, sites);
    else hayfield(b, z, sites);
  });

  // Cover along tracks.
  for (const t of tracks) {
    const horizontal = rw(t) > rh(t);
    const len = horizontal ? rw(t) : rh(t);
    for (let s = 6; s < len - 4; s += rng.int(8, 13)) {
      const i = horizontal ? t.i0 + s : rng.chance(0.5) ? t.i0 : t.i1;
      const j = horizontal ? (rng.chance(0.5) ? t.j0 : t.j1) : t.j0 + s;
      coverCluster(b, i, j, horizontal, 'rural');
    }
  }
  addSite(sites, b, b.cx(trackI), b.cz(trackJ), 'open', 4);
  holds.push({ x: b.cx(trackI), z: b.cz(trackJ) });
  scatterDecor(b, 'bush', 60);
  scatterDecor(b, 'rock', 20);

  const extracts: Point[] = [
    { x: b.cx(trackI), z: b.cz(b.h - BORDER - 3) },
    { x: b.cx(BORDER + 3), z: b.cz(b.h - BORDER - 3) },
    { x: b.cx(b.w - BORDER - 4), z: b.cz(b.h - BORDER - 3) },
  ];
  b.reinforcements.push(...edgeEntries(b, BORDER, 10, spawn, 30));
  return { spawn, sites, holds, extracts };
}

/** Hedgerow around a zone with 2–3 gaps per side (1.4 m: crouch-cover, stand-peek). */
function hedgeRing(b: LevelBuilder, z: Rect): void {
  const rng = b.rng;
  const sides: [number, number, number, number][] = [
    [z.i0 + 1, z.j0 + 1, z.i1 - 1, z.j0 + 1],
    [z.i0 + 1, z.j1 - 1, z.i1 - 1, z.j1 - 1],
    [z.i0 + 1, z.j0 + 1, z.i0 + 1, z.j1 - 1],
    [z.i1 - 1, z.j0 + 1, z.i1 - 1, z.j1 - 1],
  ];
  for (const [i0, j0, i1, j1] of sides) {
    const horizontal = j0 === j1;
    const len = horizontal ? i1 - i0 + 1 : j1 - j0 + 1;
    let t = 0;
    while (t < len) {
      const run = rng.int(5, 11);
      const gap = rng.int(3, 4);
      const a = t;
      const e = Math.min(len - 1, t + run - 1);
      const si = horizontal ? i0 + a : i0;
      const sj = horizontal ? j0 : j0 + a;
      const ei = horizontal ? i0 + e : i0;
      const ej = horizontal ? j0 : j0 + e;
      if (b.isFree(si, sj, ei, ej)) b.solidProp('hedge', si, sj, ei, ej, 1.4, Surface.Foliage, { rot: horizontal ? 0 : Math.PI / 2 }, CellFlag.Cover);
      t += run + gap;
    }
  }
}

function orchard(b: LevelBuilder, z: Rect, sites: Site[]): void {
  const rng = b.rng;
  b.paintRect(b.grid.ox + z.i0 + 2, b.grid.oz + z.j0 + 2, b.grid.ox + z.i1 - 1, b.grid.oz + z.j1 - 1, 'field');
  const rowGap = rng.int(4, 5);
  const treeGap = rng.int(3, 4);
  for (let j = z.j0 + 3; j < z.j1 - 2; j += rowGap) {
    for (let i = z.i0 + 3 + (j % 2); i < z.i1 - 2; i += treeGap) {
      if (rng.chance(0.12) || !b.isFree(i, j, i, j)) continue;
      b.pillar('tree', i, j, 4.5, 0.22, Surface.Wood, { sy: rng.range(3.8, 5), variant: rng.nextU32() });
    }
  }
  sites.push({ x: rcx(b, z), z: rcz(b, z), kind: 'open', r: 6 });
}

function farmstead(b: LevelBuilder, z: Rect, sites: Site[], holds: Point[]): void {
  const ci = Math.floor((z.i0 + z.i1) / 2);
  const cj = Math.floor((z.j0 + z.j1) / 2);
  b.paintRect(b.grid.ox + z.i0 + 3, b.grid.oz + z.j0 + 3, b.grid.ox + z.i1 - 2, b.grid.oz + z.j1 - 2, 'dirt', Surface.Sand);
  // House + barn + shed around a yard.
  const house: Rect = { i0: ci - 9, j0: cj + 2, i1: ci - 2, j1: cj + 8 };
  const barn: Rect = { i0: ci + 2, j0: cj - 1, i1: ci + 11, j1: cj + 11 };
  const shed: Rect = { i0: ci - 9, j0: cj - 8, i1: ci - 4, j1: cj - 4 };
  const fits = (r: Rect): boolean => r.i0 > z.i0 + 2 && r.i1 < z.i1 - 2 && r.j0 > z.j0 + 2 && r.j1 < z.j1 - 2;
  if (fits(house)) {
    b.building(house.i0, house.j0, house.i1, house.j1, 6.4, 'plaster');
    sites.push({ x: rcx(b, house), z: b.cz(house.j0) - 1.5, kind: 'building', r: 2 });
  }
  if (fits(barn)) {
    b.building(barn.i0, barn.j0, barn.i1, barn.j1, 7.5, 'barn', '#8a3a28', '#e8dcc8');
    // Barn doors open into the interior: carve a walkable bay.
    for (let j = barn.j0; j <= barn.j0 + 4; j += 1) for (let i = barn.i0 + 3; i <= barn.i1 - 3; i += 1) b.clear(i, j);
    for (let j = barn.j0 + 1; j <= barn.j0 + 4; j += 1) {
      b.solid(barn.i0 + 2, j, 7.5, Surface.Wood, Owner.Block);
      b.solid(barn.i1 - 2, j, 7.5, Surface.Wood, Owner.Block);
    }
    b.landmarks.push({ name: 'Red Barn', x: rcx(b, barn), z: rcz(b, barn) });
    sites.push({ x: rcx(b, barn), z: b.cz(barn.j0 + 2), kind: 'interior', r: 3 });
    hayBale(b, barn.i0 + 4, barn.j0 + 3, true);
  }
  if (fits(shed)) b.building(shed.i0, shed.j0, shed.i1, shed.j1, 3.4, 'shed');
  // Stone yard walls.
  lowWall(b, ci - 3, cj - 3, 5, true, Surface.Stone, 1.0);
  lowWall(b, ci - 12, cj - 2, 4, false, Surface.Stone, 1.0);
  vehicle(b, ci - 1, cj - 8, true, 'truck');
  barrelGroup(b, ci + 1, cj - 4, true);
  crateStack(b, ci - 2, cj + 1);
  b.pillar('tower', ci + 13, cj - 6, 9, 0.5, Surface.Metal);
  b.lamp(b.cx(ci), b.cz(cj), 4);
  sites.push({ x: b.cx(ci), z: b.cz(cj), kind: 'landmark', r: 6 });
  holds.push({ x: b.cx(ci), z: b.cz(cj) });
}

function crops(b: LevelBuilder, z: Rect, sites: Site[]): void {
  const rng = b.rng;
  b.paintRect(b.grid.ox + z.i0 + 2, b.grid.oz + z.j0 + 2, b.grid.ox + z.i1 - 1, b.grid.oz + z.j1 - 1, 'crop');
  // Irrigation walls and a pump house give sparse cover in the open.
  for (let n = 0; n < 5; n += 1) {
    const i = rng.int(z.i0 + 3, z.i1 - 6);
    const j = rng.int(z.j0 + 3, z.j1 - 4);
    if (rng.chance(0.5)) lowWall(b, i, j, rng.int(3, 5), rng.chance(0.5), Surface.Stone, 1.0);
    else hayBale(b, i, j, rng.chance(0.5));
  }
  const pi = rng.int(z.i0 + 4, z.i1 - 8);
  const pj = rng.int(z.j0 + 4, z.j1 - 8);
  if (b.isFree(pi, pj, pi + 3, pj + 3)) b.building(pi, pj, pi + 3, pj + 3, 3.2, 'shed');
  sites.push({ x: rcx(b, z), z: rcz(b, z), kind: 'open', r: 8 });
}

function hayfield(b: LevelBuilder, z: Rect, sites: Site[]): void {
  const rng = b.rng;
  b.paintRect(b.grid.ox + z.i0 + 2, b.grid.oz + z.j0 + 2, b.grid.ox + z.i1 - 1, b.grid.oz + z.j1 - 1, 'field');
  for (let n = 0; n < 16; n += 1) {
    hayBale(b, rng.int(z.i0 + 3, z.i1 - 4), rng.int(z.j0 + 3, z.j1 - 4), rng.chance(0.5));
  }
  vehicle(b, rng.int(z.i0 + 4, z.i1 - 8), rng.int(z.j0 + 4, z.j1 - 8), rng.chance(0.5), 'truck');
  sites.push({ x: rcx(b, z), z: rcz(b, z), kind: 'open', r: 7 });
  void rh;
}
