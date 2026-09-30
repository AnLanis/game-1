import { CellFlag, Surface } from '../../sim/grid';
import type { Point } from '../../sim/level';
import { Owner, type LayoutResult, type LevelBuilder, type Site } from '../builder';
import { addSite, barrelGroup, bspBlocks, crateStack, decorateStreet, edgeEntries, rcx, rcz, rh, rw, stall, type Rect } from '../common';

/**
 * Dense town: BSP street grid inside a ring road, a fountain plaza near the
 * centre, courtyards with gated entrances, alleys, and market yards.
 */
export function layoutTown(b: LevelBuilder): LayoutResult {
  const rng = b.rng;
  const BORDER = 2;
  b.border(BORDER, 12, Surface.Concrete);
  const RING = 3;
  const region: Rect = { i0: BORDER + RING, j0: BORDER + RING, i1: b.w - BORDER - RING - 1, j1: b.h - BORDER - RING - 1 };
  // Ring road just inside the border.
  const ring: Rect[] = [
    { i0: BORDER, j0: BORDER, i1: b.w - BORDER - 1, j1: BORDER + RING - 1 },
    { i0: BORDER, j0: b.h - BORDER - RING, i1: b.w - BORDER - 1, j1: b.h - BORDER - 1 },
    { i0: BORDER, j0: BORDER, i1: BORDER + RING - 1, j1: b.h - BORDER - 1 },
    { i0: b.w - BORDER - RING, j0: BORDER, i1: b.w - BORDER - 1, j1: b.h - BORDER - 1 },
  ];
  const { blocks, streets } = bspBlocks(b, region, 12, 20, [4, 5]);
  const allStreets = [...ring, ...streets];
  for (const s of allStreets) {
    b.paintRect(b.grid.ox + s.i0, b.grid.oz + s.j0, b.grid.ox + s.i1 + 1, b.grid.oz + s.j1 + 1, 'street', Surface.Stone);
    // Keep a central driving lane clear.
    const horizontal = rw(s) >= rh(s);
    if (horizontal) {
      const mid = Math.floor((s.j0 + s.j1) / 2);
      b.reserve(s.i0, mid, s.i1, mid + (rh(s) >= 5 ? 1 : 0));
    } else {
      const mid = Math.floor((s.i0 + s.i1) / 2);
      b.reserve(mid, s.j0, mid + (rw(s) >= 5 ? 1 : 0), s.j1);
    }
  }

  const sites: Site[] = [];
  const holds: Point[] = [];
  const cx = 0;
  const cz = 0;
  // Plaza: the big-enough block closest to the centre.
  let plaza: Rect | null = null;
  let best = Infinity;
  for (const r of blocks) {
    if (rw(r) < 11 || rh(r) < 11) continue;
    const d = Math.hypot(rcx(b, r) - cx, rcz(b, r) - cz);
    if (d < best) {
      best = d;
      plaza = r;
    }
  }

  // Player spawn: south ring road near the middle, facing north (+Z → yaw π).
  const spawnI = Math.floor(b.w / 2) + rng.int(-6, 6);
  const spawnJ = BORDER + 1;
  b.reserve(spawnI - 3, spawnJ - 1, spawnI + 3, spawnJ + 4);
  const spawn = { x: b.cx(spawnI), z: b.cz(spawnJ), yaw: Math.PI };

  for (const r of blocks) {
    if (r === plaza) {
      buildPlaza(b, r, sites, holds);
      continue;
    }
    const w = rw(r);
    const h = rh(r);
    const roll = rng.next();
    if (w < 6 || h < 6) {
      if (w >= 3 && h >= 3) b.building(r.i0, r.j0, r.i1, r.j1, rng.pick([4.2, 6.8]), 'plaster');
      continue;
    }
    if (roll < 0.24 && w >= 12 && h >= 12) buildCourtyard(b, r, sites);
    else if (roll < 0.36) buildMarketYard(b, r, sites);
    else buildLots(b, r, sites);
  }

  for (const s of allStreets) decorateStreet(b, s, 'urban', 13);

  // Street intersections as open sites.
  for (const s of streets) addSite(sites, b, rcx(b, s), rcz(b, s), 'open', 3);
  for (const s of ring) {
    addSite(sites, b, b.cx(s.i0 + 2), b.cz(s.j0 + 1), 'edge', 2);
    addSite(sites, b, b.cx(s.i1 - 2), b.cz(s.j1 - 1), 'edge', 2);
  }

  // Extraction candidates: far (north) ring road.
  const extracts: Point[] = [];
  for (const t of [0.2, 0.5, 0.8]) {
    const i = Math.floor(b.w * t);
    const j = b.h - BORDER - 2;
    if (b.grid.walkable(i, j)) extracts.push({ x: b.cx(i), z: b.cz(j) });
  }
  b.reinforcements.push(...edgeEntries(b, BORDER, 9, spawn, 26));
  b.landmarks.push({ name: 'Sun Market Plaza', x: plaza ? rcx(b, plaza) : 0, z: plaza ? rcz(b, plaza) : 0 });
  return { spawn, sites, holds, extracts };
}

function buildPlaza(b: LevelBuilder, r: Rect, sites: Site[], holds: Point[]): void {
  const rng = b.rng;
  const x0 = b.grid.ox + r.i0;
  const z0 = b.grid.oz + r.j0;
  b.paintRect(x0, z0, x0 + rw(r), z0 + rh(r), 'plaza', Surface.Stone);
  const ci = Math.floor((r.i0 + r.i1) / 2);
  const cj = Math.floor((r.j0 + r.j1) / 2);
  // Round fountain basin (low cover ring) with a tall centre spout.
  for (let j = cj - 2; j <= cj + 2; j += 1) {
    for (let i = ci - 2; i <= ci + 2; i += 1) {
      const d = Math.hypot(i - ci, j - cj);
      if (d <= 2.4) b.solid(i, j, d < 0.6 ? 2.6 : 0.85, Surface.Stone, Owner.Prop, CellFlag.Cover);
    }
  }
  b.prop('fountain', b.cx(ci), b.cz(cj), { sx: 5, sy: 2.6, sz: 5 });
  b.landmarks.push({ name: 'Fountain', x: b.cx(ci), z: b.cz(cj) });
  // Stalls ring.
  const ringR = Math.min(rw(r), rh(r)) / 2 - 2.5;
  const n = rng.int(5, 8);
  for (let s = 0; s < n; s += 1) {
    const a = (s / n) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const i = Math.round(ci + Math.cos(a) * ringR);
    const j = Math.round(cj + Math.sin(a) * ringR);
    const horizontal = Math.abs(Math.sin(a)) > 0.7;
    if (!stall(b, i, j, horizontal)) crateStack(b, i, j);
  }
  // Palms at corners (pillars).
  for (const [di, dj] of [
    [1, 1],
    [rw(r) - 2, 1],
    [1, rh(r) - 2],
    [rw(r) - 2, rh(r) - 2],
  ]) {
    const i = r.i0 + di;
    const j = r.j0 + dj;
    if (b.isFree(i, j, i, j)) b.pillar('palm', i, j, 6, 0.24, Surface.Wood, { sy: rng.range(5, 7.5) });
  }
  for (let s = 0; s < 4; s += 1) {
    const a = (s / 4) * Math.PI * 2 + Math.PI / 4;
    b.lamp(b.cx(ci) + Math.cos(a) * (ringR - 1.5), b.cz(cj) + Math.sin(a) * (ringR - 1.5), 4.4);
  }
  b.prop('rug', b.cx(ci) + 3, b.cz(cj) - 3, { rot: rng.range(0, 3), sx: 2.4, sz: 1.6, color: b.fabric() });
  sites.push({ x: b.cx(ci) + ringR * 0.6, z: b.cz(cj), kind: 'plaza', r: ringR });
  sites.push({ x: b.cx(ci) - ringR * 0.6, z: b.cz(cj), kind: 'plaza', r: ringR });
  holds.push({ x: b.cx(ci), z: b.cz(cj) + 3.5 });
}

function buildCourtyard(b: LevelBuilder, r: Rect, sites: Site[]): void {
  const rng = b.rng;
  const t = rng.int(3, 4);
  const hgt = rng.pick([4.2, 6.8, 6.8, 9.4]);
  const style = rng.chance(0.5) ? 'plaster' : 'brick';
  // Four wings.
  b.building(r.i0, r.j0, r.i1, r.j0 + t - 1, hgt, style);
  b.building(r.i0, r.j1 - t + 1, r.i1, r.j1, hgt, style);
  b.building(r.i0, r.j0 + t, r.i0 + t - 1, r.j1 - t, hgt, style);
  b.building(r.i1 - t + 1, r.j0 + t, r.i1, r.j1 - t, hgt, style);
  // Gates through two wings.
  const gates = rng.shuffle([0, 1, 2, 3]).slice(0, rng.int(2, 3));
  for (const g of gates) {
    if (g === 0 || g === 1) {
      const gi = rng.int(r.i0 + t + 1, r.i1 - t - 2);
      const j0 = g === 0 ? r.j0 : r.j1 - t + 1;
      for (let j = j0; j < j0 + t; j += 1) for (let i = gi; i <= gi + 1; i += 1) b.clear(i, j);
    } else {
      const gj = rng.int(r.j0 + t + 1, r.j1 - t - 2);
      const i0 = g === 2 ? r.i0 : r.i1 - t + 1;
      for (let i = i0; i < i0 + t; i += 1) for (let j = gj; j <= gj + 1; j += 1) b.clear(i, j);
    }
  }
  const inner: Rect = { i0: r.i0 + t, j0: r.j0 + t, i1: r.i1 - t, j1: r.j1 - t };
  b.paintRect(b.grid.ox + inner.i0, b.grid.oz + inner.j0, b.grid.ox + inner.i1 + 1, b.grid.oz + inner.j1 + 1, 'dirt', Surface.Sand);
  const ic = Math.floor((inner.i0 + inner.i1) / 2);
  const jc = Math.floor((inner.j0 + inner.j1) / 2);
  if (rng.chance(0.5) && b.isFree(ic, jc, ic, jc)) b.pillar('tree', ic, jc, 5, 0.3, Surface.Wood);
  for (let n = 0; n < 3; n += 1) {
    const i = rng.int(inner.i0 + 1, inner.i1 - 1);
    const j = rng.int(inner.j0 + 1, inner.j1 - 1);
    if (rng.chance(0.5)) crateStack(b, i, j);
    else barrelGroup(b, i, j, rng.chance(0.4));
  }
  sites.push({ x: b.cx(ic), z: b.cz(jc), kind: 'courtyard', r: Math.min(rw(inner), rh(inner)) / 2 });
}

function buildMarketYard(b: LevelBuilder, r: Rect, sites: Site[]): void {
  const rng = b.rng;
  b.paintRect(b.grid.ox + r.i0, b.grid.oz + r.j0, b.grid.ox + r.i1 + 1, b.grid.oz + r.j1 + 1, 'dirt', Surface.Sand);
  for (let j = r.j0 + 1; j < r.j1 - 1; j += 4) {
    for (let i = r.i0 + 1; i < r.i1 - 2; i += 5) {
      if (rng.chance(0.75)) stall(b, i + rng.int(0, 1), j, true);
      else crateStack(b, i, j);
    }
  }
  b.prop('tent', b.cx(r.i0 + 1), b.cz(r.j1 - 1), { rot: 0, color: b.fabric() });
  sites.push({ x: rcx(b, r), z: rcz(b, r), kind: 'open', r: Math.min(rw(r), rh(r)) / 2 });
}

function buildLots(b: LevelBuilder, r: Rect, sites: Site[]): void {
  const rng = b.rng;
  const horizontal = rw(r) >= rh(r);
  const len = horizontal ? rw(r) : rh(r);
  const lots = Math.max(1, Math.min(3, Math.floor(len / rng.int(7, 10))));
  const alley = 2;
  const lotLen = Math.floor((len - alley * (lots - 1)) / lots);
  let start = horizontal ? r.i0 : r.j0;
  for (let n = 0; n < lots; n += 1) {
    const end = n === lots - 1 ? (horizontal ? r.i1 : r.j1) : start + lotLen - 1;
    const lot: Rect = horizontal ? { i0: start, i1: end, j0: r.j0, j1: r.j1 } : { i0: r.i0, i1: r.i1, j0: start, j1: end };
    if (rng.chance(0.12) && rw(lot) >= 5 && rh(lot) >= 5) {
      // Empty walled yard with clutter.
      b.paintRect(b.grid.ox + lot.i0, b.grid.oz + lot.j0, b.grid.ox + lot.i1 + 1, b.grid.oz + lot.j1 + 1, 'dirt', Surface.Sand);
      for (let c = 0; c < 3; c += 1) crateStack(b, rng.int(lot.i0 + 1, lot.i1 - 1), rng.int(lot.j0 + 1, lot.j1 - 1));
      sites.push({ x: rcx(b, lot), z: rcz(b, lot), kind: 'open', r: 3 });
    } else {
      const inset = rng.chance(0.4) ? 1 : 0;
      const hgt = rng.pick([4.2, 4.2, 6.8, 6.8, 9.4, 12]);
      const style = rng.chance(0.55) ? 'plaster' : 'brick';
      b.building(lot.i0 + inset, lot.j0 + inset, lot.i1 - inset, lot.j1 - inset, hgt, style);
      sites.push({ x: rcx(b, lot) + (horizontal ? 0 : rw(lot) / 2 + 1.5), z: rcz(b, lot) + (horizontal ? rh(lot) / 2 + 1.5 : 0), kind: 'building', r: 2 });
    }
    if (n < lots - 1) {
      const a0 = end + 1;
      const alleyRect: Rect = horizontal ? { i0: a0, i1: a0 + alley - 1, j0: r.j0, j1: r.j1 } : { i0: r.i0, i1: r.i1, j0: a0, j1: a0 + alley - 1 };
      b.paintRect(b.grid.ox + alleyRect.i0, b.grid.oz + alleyRect.j0, b.grid.ox + alleyRect.i1 + 1, b.grid.oz + alleyRect.j1 + 1, 'dirt', Surface.Sand);
      if (rng.chance(0.4)) {
        const mi = Math.floor((alleyRect.i0 + alleyRect.i1) / 2);
        const mj = Math.floor((alleyRect.j0 + alleyRect.j1) / 2);
        crateStack(b, mi, mj);
      }
      sites.push({ x: rcx(b, alleyRect), z: rcz(b, alleyRect), kind: 'alley', r: 1 });
      start = a0 + alley;
    }
  }
}
