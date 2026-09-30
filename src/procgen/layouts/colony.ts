import { CellFlag, Surface } from '../../sim/grid';
import type { Point } from '../../sim/level';
import { Owner, type LayoutResult, type LevelBuilder, type Site } from '../builder';
import { barrier, coverCluster, crateStack, edgeEntries, rockCluster, scatterDecor, vehicle } from '../common';

/**
 * Mars mining colony: habitat domes linked by pressurised tubes, solar-panel
 * rows (jumpable in low gravity), comm arrays, craters with rims, rovers and
 * a landing pad. The Red Dust faction's home turf.
 */
export function layoutColony(b: LevelBuilder): LayoutResult {
  const rng = b.rng;
  const BORDER = 2;
  b.border(BORDER, 10, Surface.Rock);
  const spawn = { x: b.cx(Math.floor(b.w / 2)), z: b.cz(BORDER + 2), yaw: Math.PI };
  b.reserve(Math.floor(b.w / 2) - 4, BORDER, Math.floor(b.w / 2) + 4, BORDER + 6);
  const sites: Site[] = [];
  const holds: Point[] = [];
  const domes: { i: number; j: number; r: number }[] = [];

  // Reactor dome near centre, 3–4 habitat domes around it.
  const ci = Math.floor(b.w / 2) + rng.int(-4, 4);
  const cj = Math.floor(b.h / 2) + rng.int(-2, 6);
  const placeDome = (i: number, j: number, r: number, name: string): void => {
    for (let jj = j - r; jj <= j + r; jj += 1) {
      for (let ii = i - r; ii <= i + r; ii += 1) {
        if (Math.hypot(ii - i, jj - j) <= r - 0.3) b.solid(ii, jj, 6 + r * 0.3, Surface.Metal, Owner.Building, CellFlag.Building);
      }
    }
    b.prop('dome', b.cx(i), b.cz(j), { sx: r * 2, sy: 3.2 + r * 0.55, sz: r * 2 });
    domes.push({ i, j, r });
    b.landmarks.push({ name, x: b.cx(i), z: b.cz(j) });
  };
  // The reactor plaza is open with the dome off to one side.
  placeDome(ci, cj + 9, 5, 'Reactor Dome');
  holds.push({ x: b.cx(ci), z: b.cz(cj) });
  sites.push({ x: b.cx(ci), z: b.cz(cj), kind: 'plaza', r: 6 });
  b.paintRect(b.cx(ci) - 8, b.cz(cj) - 7, b.cx(ci) + 8, b.cz(cj) + 4, 'pad', Surface.Concrete);
  for (let a = 0; a < 5; a += 1) {
    const ang = (a / 5) * Math.PI * 2 + 0.3;
    barrier(b, Math.round(ci + Math.cos(ang) * 6), Math.round(cj + Math.sin(ang) * 5), a % 2 === 0);
  }
  const habitats: [number, number][] = [
    [-24, -14],
    [22, -16],
    [-22, 16],
    [24, 14],
  ];
  habitats.forEach(([di, dj], n) => {
    const r = rng.int(5, 7);
    const i = ci + di + rng.int(-3, 3);
    const j = cj + dj + rng.int(-3, 3);
    if (i - r < BORDER + 4 || i + r > b.w - BORDER - 5 || j - r < BORDER + 10 || j + r > b.h - BORDER - 4) return;
    placeDome(i, j, r, `Hab ${String.fromCharCode(65 + n)}`);
    sites.push({ x: b.cx(i), z: b.cz(j - r - 2), kind: 'building', r: 3 });
  });
  // Tubes: raised walkways between domes rendered as tubes; low solid (jumpable) with gaps.
  for (let n = 1; n < domes.length; n += 1) {
    const a = domes[0];
    const d = domes[n];
    const steps = Math.max(Math.abs(d.i - a.i), Math.abs(d.j - a.j));
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const i = Math.round(a.i + (d.i - a.i) * t);
      const j = Math.round(a.j + (d.j - a.j) * t);
      if (Math.hypot(i - a.i, j - a.j) <= a.r || Math.hypot(i - d.i, j - d.j) <= d.r) continue;
      if (s % 9 < 3) continue; // airlock gaps
      if (b.isFree(i, j, i, j)) b.solid(i, j, 2.4, Surface.Metal, Owner.Prop, CellFlag.Cover);
    }
    b.prop('pipe', b.cx(a.i), b.cz(a.j), { sx: b.cx(d.i) - b.cx(a.i), sy: 2.4, sz: b.cz(d.j) - b.cz(a.j), variant: 1 });
  }
  // Solar arrays: long rows (1.0 m) with gaps.
  for (let n = 0; n < 3; n += 1) {
    const i0 = rng.int(BORDER + 6, b.w - BORDER - 26);
    const j0 = rng.int(BORDER + 8, b.h - BORDER - 18);
    for (let row = 0; row < 4; row += 1) {
      for (let seg = 0; seg < 3; seg += 1) {
        const si = i0 + seg * 7;
        const sj = j0 + row * 4;
        if (b.isFree(si, sj, si + 5, sj)) b.solidProp('solar', si, sj, si + 5, sj, 1.0, Surface.Metal, { rot: 0 });
      }
    }
    sites.push({ x: b.cx(i0 + 10), z: b.cz(j0 + 6), kind: 'open', r: 5 });
  }
  // Comm arrays (sabotage targets hug these).
  for (let n = 0; n < 4; n += 1) {
    const c = b.randomOpenCell((i, j) => Math.hypot(i - ci, j - cj) > 16 && !b.reserved[b.k(i, j)] && b.isFree(i - 1, j - 1, i + 1, j + 1));
    if (!c) continue;
    b.pillar('antenna', c.i, c.j, 14, 0.4, Surface.Metal, { sy: 14 });
    b.prop('dish', b.cx(c.i) + 1.4, b.cz(c.j), { sy: 3, rot: rng.range(0, 6.28) });
    sites.push({ x: b.cx(c.i) + 1.5, z: b.cz(c.j) + 1.5, kind: 'landmark', r: 3 });
    b.lamp(b.cx(c.i), b.cz(c.j), 10, b.biome.palette.lamp, 0.8);
  }
  // Craters with rims.
  for (let n = 0; n < 4; n += 1) {
    const c = b.randomOpenCell((i, j) => i > 10 && j > 14 && i < b.w - 10 && j < b.h - 10);
    if (!c) continue;
    const r = rng.int(4, 6);
    for (let a = 0; a < 20; a += 1) {
      if (a % 5 === 0) continue;
      const ang = (a / 20) * Math.PI * 2;
      const i = Math.round(c.i + Math.cos(ang) * r);
      const j = Math.round(c.j + Math.sin(ang) * r);
      if (b.isFree(i, j, i, j)) b.solid(i, j, 1.0, Surface.Rock, Owner.Prop, CellFlag.Cover);
    }
    b.prop('crater', b.cx(c.i), b.cz(c.j), { sx: r * 2 + 1, sz: r * 2 + 1 });
    sites.push({ x: b.cx(c.i), z: b.cz(c.j), kind: 'open', r: r - 1 });
  }
  for (let n = 0; n < 40; n += 1) {
    const c = b.randomOpenCell((i, j) => !b.reserved[b.k(i, j)]);
    if (!c) break;
    if (n % 4 === 0) vehicle(b, c.i, c.j, rng.chance(0.5), 'rover');
    else if (n % 4 === 1) crateStack(b, c.i, c.j);
    else if (n % 4 === 2) rockCluster(b, c.i, c.j);
    else coverCluster(b, c.i, c.j, rng.chance(0.5), 'colony');
  }
  scatterDecor(b, 'rock', 50);

  // Landing pad (extraction) at the north.
  const padI = rng.int(BORDER + 12, b.w - BORDER - 12);
  const padJ = b.h - BORDER - 8;
  b.paintRect(b.cx(padI) - 6, b.cz(padJ) - 5, b.cx(padI) + 6, b.cz(padJ) + 5, 'pad', Surface.Concrete);
  b.reserve(padI - 5, padJ - 4, padI + 5, padJ + 4);
  const extracts: Point[] = [{ x: b.cx(padI), z: b.cz(padJ) }];
  b.landmarks.push({ name: 'Landing Pad', x: b.cx(padI), z: b.cz(padJ) });

  b.reinforcements.push(...edgeEntries(b, BORDER, 10, spawn, 30));
  return { spawn, sites, holds, extracts };
}
