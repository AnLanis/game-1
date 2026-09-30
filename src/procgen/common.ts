import { Surface } from '../sim/grid';
import type { Point } from '../sim/level';
import { Owner, type LevelBuilder, type Site } from './builder';

export interface Rect {
  i0: number;
  j0: number;
  i1: number;
  j1: number;
}

export const rw = (r: Rect): number => r.i1 - r.i0 + 1;
export const rh = (r: Rect): number => r.j1 - r.j0 + 1;
export const rcx = (b: LevelBuilder, r: Rect): number => (b.cx(r.i0) + b.cx(r.i1)) / 2;
export const rcz = (b: LevelBuilder, r: Rect): number => (b.cz(r.j0) + b.cz(r.j1)) / 2;

/** Binary space partition into blocks separated by streets. */
export function bspBlocks(
  b: LevelBuilder,
  region: Rect,
  minBlock: number,
  maxBlock: number,
  streetW: [number, number],
): { blocks: Rect[]; streets: Rect[] } {
  const blocks: Rect[] = [];
  const streets: Rect[] = [];
  const split = (r: Rect, depth: number): void => {
    const w = rw(r);
    const h = rh(r);
    const limit = b.rng.int(minBlock, maxBlock);
    if ((w <= limit && h <= limit) || depth > 6) {
      blocks.push(r);
      return;
    }
    const sw = b.rng.int(streetW[0], streetW[1]) + (depth === 0 ? 1 : 0);
    if (w >= h) {
      const cut = r.i0 + Math.max(minBlock - 2, Math.floor(w * b.rng.range(0.36, 0.64)) - Math.floor(sw / 2));
      if (cut - r.i0 < 5 || r.i1 - (cut + sw) < 4) {
        blocks.push(r);
        return;
      }
      streets.push({ i0: cut, i1: cut + sw - 1, j0: r.j0, j1: r.j1 });
      split({ ...r, i1: cut - 1 }, depth + 1);
      split({ ...r, i0: cut + sw }, depth + 1);
    } else {
      const cut = r.j0 + Math.max(minBlock - 2, Math.floor(h * b.rng.range(0.36, 0.64)) - Math.floor(sw / 2));
      if (cut - r.j0 < 5 || r.j1 - (cut + sw) < 4) {
        blocks.push(r);
        return;
      }
      streets.push({ j0: cut, j1: cut + sw - 1, i0: r.i0, i1: r.i1 });
      split({ ...r, j1: cut - 1 }, depth + 1);
      split({ ...r, j0: cut + sw }, depth + 1);
    }
  };
  split(region, 0);
  return { blocks, streets };
}

/** Scatter a cover cluster at a cell. Returns true if something was placed. */
export function coverCluster(b: LevelBuilder, i: number, j: number, horizontal: boolean, style: 'urban' | 'rural' | 'military' | 'industrial' | 'colony'): boolean {
  const rng = b.rng;
  const roll = rng.next();
  if (style === 'urban') {
    if (roll < 0.34) return crateStack(b, i, j);
    if (roll < 0.5) return barrelGroup(b, i, j, rng.chance(0.3));
    if (roll < 0.72) return b.sandbags(i, j, rng.int(2, 3), horizontal);
    if (roll < 0.88) return vehicle(b, i, j, horizontal, 'car');
    return stall(b, i, j, horizontal);
  }
  if (style === 'rural') {
    if (roll < 0.35) return hayBale(b, i, j, horizontal);
    if (roll < 0.55) return crateStack(b, i, j);
    if (roll < 0.7) return vehicle(b, i, j, horizontal, 'truck');
    if (roll < 0.85) return lowWall(b, i, j, rng.int(3, 5), horizontal, Surface.Stone, 1.0);
    return barrelGroup(b, i, j, rng.chance(0.25));
  }
  if (style === 'military') {
    if (roll < 0.4) return b.sandbags(i, j, rng.int(3, 4), horizontal);
    if (roll < 0.6) return crateStack(b, i, j);
    if (roll < 0.75) return barrelGroup(b, i, j, rng.chance(0.45));
    if (roll < 0.9) return barrier(b, i, j, horizontal);
    return vehicle(b, i, j, horizontal, 'truck');
  }
  if (style === 'industrial') {
    if (roll < 0.3) return crateStack(b, i, j);
    if (roll < 0.5) return barrelGroup(b, i, j, rng.chance(0.4));
    if (roll < 0.7) return barrier(b, i, j, horizontal);
    if (roll < 0.85) return vehicle(b, i, j, horizontal, 'forklift');
    return b.sandbags(i, j, 2, horizontal);
  }
  // colony
  if (roll < 0.35) return crateStack(b, i, j);
  if (roll < 0.55) return barrier(b, i, j, horizontal);
  if (roll < 0.75) return rockCluster(b, i, j);
  if (roll < 0.9) return vehicle(b, i, j, horizontal, 'rover');
  return barrelGroup(b, i, j, rng.chance(0.3));
}

export function crateStack(b: LevelBuilder, i: number, j: number): boolean {
  const shape = b.rng.int(0, 3);
  const cells: [number, number][] = shape === 0 ? [[0, 0]] : shape === 1 ? [[0, 0], [1, 0]] : shape === 2 ? [[0, 0], [1, 0], [0, 1]] : [[0, 0], [0, 1]];
  for (const [di, dj] of cells) if (!b.isFree(i + di, j + dj, i + di, j + dj)) return false;
  for (const [di, dj] of cells) b.crate(i + di, j + dj, b.rng.chance(0.25) ? 1.5 : 1.0);
  return true;
}

export function barrelGroup(b: LevelBuilder, i: number, j: number, explosive: boolean): boolean {
  const n = b.rng.int(1, 3);
  const cells: [number, number][] = [[0, 0], [1, 0], [0, 1]].slice(0, n) as [number, number][];
  for (const [di, dj] of cells) if (!b.isFree(i + di, j + dj, i + di, j + dj)) return false;
  for (const [di, dj] of cells) b.barrel(i + di, j + dj, explosive && b.rng.chance(0.7));
  return true;
}

export function vehicle(b: LevelBuilder, i: number, j: number, horizontal: boolean, kind: 'car' | 'truck' | 'forklift' | 'rover'): boolean {
  const len = kind === 'truck' ? 6 : kind === 'forklift' ? 3 : 4;
  const wid = kind === 'forklift' ? 2 : kind === 'truck' ? 3 : 2;
  const i1 = horizontal ? i + len - 1 : i + wid - 1;
  const j1 = horizontal ? j + wid - 1 : j + len - 1;
  if (!b.isFree(i, j, i1, j1)) return false;
  const h = kind === 'truck' ? 2.6 : kind === 'rover' ? 1.7 : kind === 'forklift' ? 2.0 : 1.35;
  const surf = Surface.Metal;
  b.solidProp(kind, i, j, i1, j1, h, surf, { rot: horizontal ? Math.PI / 2 : 0, color: b.accent() });
  return true;
}

export function stall(b: LevelBuilder, i: number, j: number, horizontal: boolean): boolean {
  const i1 = horizontal ? i + 2 : i;
  const j1 = horizontal ? j : j + 2;
  if (!b.isFree(i, j, i1, j1)) return false;
  b.solidProp('stall', i, j, i1, j1, 1.0, Surface.Wood, { rot: horizontal ? 0 : Math.PI / 2, color: b.fabric() });
  return true;
}

export function hayBale(b: LevelBuilder, i: number, j: number, horizontal: boolean): boolean {
  const i1 = horizontal ? i + 1 : i;
  const j1 = horizontal ? j : j + 1;
  if (!b.isFree(i, j, i1, j1)) return false;
  b.solidProp('haybale', i, j, i1, j1, 1.15, Surface.Foliage, { rot: horizontal ? 0 : Math.PI / 2 });
  return true;
}

export function lowWall(b: LevelBuilder, i: number, j: number, len: number, horizontal: boolean, surface: Surface, height: number): boolean {
  const i1 = horizontal ? i + len - 1 : i;
  const j1 = horizontal ? j : j + len - 1;
  if (!b.isFree(i, j, i1, j1)) return false;
  b.solidProp('wall', i, j, i1, j1, height, surface, { rot: horizontal ? 0 : Math.PI / 2, color: b.wallColor() });
  return true;
}

export function barrier(b: LevelBuilder, i: number, j: number, horizontal: boolean): boolean {
  const len = b.rng.int(2, 3);
  const i1 = horizontal ? i + len - 1 : i;
  const j1 = horizontal ? j : j + len - 1;
  if (!b.isFree(i, j, i1, j1)) return false;
  b.solidProp('barrier', i, j, i1, j1, 1.1, Surface.Concrete, { rot: horizontal ? 0 : Math.PI / 2 });
  return true;
}

export function rockCluster(b: LevelBuilder, i: number, j: number): boolean {
  if (!b.isFree(i, j, i + 1, j + 1)) return false;
  const big = b.rng.chance(0.4);
  if (big) b.solidProp('boulder', i, j, i + 1, j + 1, b.rng.range(1.3, 2.4), Surface.Rock, { rot: b.rng.range(0, 6.28) });
  else b.solidProp('rock', i, j, i, j, b.rng.range(0.9, 1.3), Surface.Rock, { rot: b.rng.range(0, 6.28) });
  return true;
}

/** Walk a street rect placing cover on alternating edges, lamps, keeping a lane open. */
export function decorateStreet(b: LevelBuilder, s: { i0: number; j0: number; i1: number; j1: number }, style: Parameters<typeof coverCluster>[4], lampEvery = 12): void {
  const horizontal = rw(s) >= rh(s);
  const len = horizontal ? rw(s) : rh(s);
  const width = horizontal ? rh(s) : rw(s);
  let side = b.rng.chance(0.5) ? 0 : 1;
  for (let t = b.rng.int(3, 6); t < len - 3; t += b.rng.int(6, 10)) {
    side = 1 - side;
    const edge = side === 0 ? 0 : width - (width >= 5 ? 2 : 1);
    const i = horizontal ? s.i0 + t : s.i0 + edge;
    const j = horizontal ? s.j0 + edge : s.j0 + t;
    coverCluster(b, i, j, horizontal, style);
  }
  if (lampEvery > 0) {
    for (let t = 2; t < len - 1; t += lampEvery) {
      const i = horizontal ? s.i0 + t : side === 0 ? s.i0 : s.i1;
      const j = horizontal ? (side === 0 ? s.j0 : s.j1) : s.j0 + t;
      if (b.isOpen(i, j)) b.lamp(b.cx(i) + (horizontal ? 0 : side === 0 ? -0.4 : 0.4), b.cz(j) + (horizontal ? (side === 0 ? -0.4 : 0.4) : 0));
    }
  }
}

/** Points evenly spread over open cells near the map edge (reinforcement entries). */
export function edgeEntries(b: LevelBuilder, margin: number, spacing: number, avoid: Point, avoidR: number): Point[] {
  const out: Point[] = [];
  const g = b.grid;
  const tryAdd = (i: number, j: number): void => {
    if (!g.walkable(i, j)) return;
    const x = b.cx(i);
    const z = b.cz(j);
    if (Math.hypot(x - avoid.x, z - avoid.z) < avoidR) return;
    for (const p of out) if (Math.hypot(p.x - x, p.z - z) < spacing) return;
    out.push({ x, z });
  };
  for (let t = margin; t < b.w - margin; t += 2) {
    for (let d = margin; d < margin + 6; d += 1) {
      tryAdd(t, d);
      tryAdd(t, b.h - 1 - d);
    }
  }
  for (let t = margin; t < b.h - margin; t += 2) {
    for (let d = margin; d < margin + 6; d += 1) {
      tryAdd(d, t);
      tryAdd(b.w - 1 - d, t);
    }
  }
  return out;
}

export function addSite(sites: Site[], b: LevelBuilder, x: number, z: number, kind: Site['kind'], r: number): void {
  const i = b.ci(x);
  const j = b.cj(z);
  if (!b.grid.walkable(i, j)) {
    const k = nearestOpen(b, i, j);
    if (k < 0) return;
    const ii = k % b.w;
    x = b.cx(ii);
    z = b.cz((k - ii) / b.w);
  }
  sites.push({ x, z, kind, r });
}

export function nearestOpen(b: LevelBuilder, i: number, j: number, maxR = 8): number {
  const g = b.grid;
  if (g.walkable(i, j)) return b.k(i, j);
  for (let r = 1; r <= maxR; r += 1) {
    for (let dj = -r; dj <= r; dj += 1) {
      for (let di = -r; di <= r; di += 1) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        if (g.walkable(i + di, j + dj)) return b.k(i + di, j + dj);
      }
    }
  }
  return -1;
}

/** Scatter visual clutter (no collision) on open cells. */
export function scatterDecor(b: LevelBuilder, kind: 'bush' | 'rock' | 'drift' | 'crater' | 'rug', count: number): void {
  for (let n = 0; n < count; n += 1) {
    const c = b.randomOpenCell((i, j) => !b.reserved[b.k(i, j)]);
    if (!c) break;
    b.prop(kind, b.cx(c.i) + b.rng.range(-0.3, 0.3), b.cz(c.j) + b.rng.range(-0.3, 0.3), {
      rot: b.rng.range(0, Math.PI * 2),
      sx: b.rng.range(0.6, 1.4),
      sy: b.rng.range(0.4, 1),
      sz: b.rng.range(0.6, 1.4),
    });
  }
}

export { Owner };
