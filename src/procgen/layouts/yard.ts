import { CellFlag, Surface } from '../../sim/grid';
import type { Point } from '../../sim/level';
import { Owner, type LayoutResult, type LevelBuilder, type Site } from '../builder';
import { addSite, coverCluster, crateStack, edgeEntries, rcx, rcz, rh, rw, type Rect } from '../common';

const CONTAINER_H = 2.6;

/**
 * Night port: a quay on the west edge, container canyons in a block grid,
 * warehouses to the east and gantry cranes. Stacks of 1–3 containers create
 * vertical variety; single containers and pallets are the low cover.
 */
export function layoutYard(b: LevelBuilder): LayoutResult {
  const rng = b.rng;
  const BORDER = 2;
  b.border(BORDER, 8, Surface.Metal);
  const sites: Site[] = [];
  const holds: Point[] = [];
  // Water along the west edge (quay); treat as impassable, rendered as water.
  const QUAY = 7;
  for (let j = 0; j < b.h; j += 1) {
    for (let i = 0; i < QUAY; i += 1) {
      b.solid(i, j, i === QUAY - 1 ? 0.9 : 0.9, Surface.Metal, i === QUAY - 1 ? Owner.Prop : Owner.Border, CellFlag.Border | CellFlag.NoNav);
    }
  }
  b.paintRect(b.grid.ox, b.grid.oz, b.grid.ox + QUAY - 1, b.grid.oz + b.h, 'water');
  for (let j = 4; j < b.h - 4; j += 6) b.prop('bollard', b.cx(QUAY - 1), b.cz(j));
  b.paintRect(b.grid.ox + QUAY, b.grid.oz + BORDER, b.grid.ox + QUAY + 3, b.grid.oz + b.h - BORDER, 'pad', Surface.Concrete);

  // Warehouses along the east.
  const whW = rng.int(12, 15);
  const whX0 = b.w - BORDER - whW - 1;
  let j = BORDER + 4;
  while (j < b.h - BORDER - 12) {
    const len = rng.int(16, 22);
    const j1 = Math.min(b.h - BORDER - 5, j + len - 1);
    const wh = b.building(whX0, j, b.w - BORDER - 2, j1, 9, 'warehouse', rng.pick(b.biome.palette.walls));
    // Open loading bay on the west side.
    const bayJ = Math.floor((j + j1) / 2) - 2;
    for (let jj = bayJ; jj < bayJ + 4; jj += 1) for (let ii = whX0; ii < whX0 + 5; ii += 1) b.clear(ii, jj);
    sites.push({ x: b.cx(whX0 + 2), z: b.cz(bayJ + 2), kind: 'interior', r: 2 });
    b.lamp(b.cx(whX0 - 1), b.cz(bayJ - 1), 6, b.biome.palette.lamp, 1.2);
    void wh;
    j = j1 + rng.int(5, 7);
  }

  // Container field between quay road and warehouses.
  const field: Rect = { i0: QUAY + 5, j0: BORDER + 6, i1: whX0 - 6, j1: b.h - BORDER - 6 };
  const spawn = { x: b.cx(Math.floor((field.i0 + field.i1) / 2)), z: b.cz(BORDER + 2), yaw: Math.PI };
  b.reserve(b.ci(spawn.x) - 4, BORDER, b.ci(spawn.x) + 4, BORDER + 5);
  const laneW = 4;
  const blockW = 7; // 2 containers side by side (2.5 m each) + margin
  const blockL = rng.int(12, 16);
  const colors = ['#b8412a', '#2a6ab0', '#d8a82a', '#3a8a5a', '#6a6e74', '#e0762a', '#8a2a2a'];
  for (let bj = field.j0; bj + blockL <= field.j1; bj += blockL + laneW) {
    for (let bi = field.i0; bi + blockW <= field.i1; bi += blockW + laneW) {
      const r = rng.next();
      if (r < 0.14) {
        // Open pad: cover clutter, crane legs.
        for (let n = 0; n < 4; n += 1) coverCluster(b, rng.int(bi, bi + blockW - 2), rng.int(bj, bj + blockL - 2), rng.chance(0.5), 'industrial');
        sites.push({ x: b.cx(bi + 3), z: b.cz(bj + blockL / 2), kind: 'open', r: 4 });
        continue;
      }
      // Two rows of containers (each 3 wide × 6 long in cells) along Z.
      for (let row = 0; row < 2; row += 1) {
        const ci0 = bi + row * 3 + (row ? 1 : 0);
        for (let cj = bj; cj + 6 <= bj + blockL; cj += 6 + rng.int(0, 1)) {
          if (rng.chance(0.1)) continue;
          const stack = rng.weighted([1, 2, 3], (s) => (s === 1 ? 3 : s === 2 ? 3 : 1.5));
          const h = CONTAINER_H * stack;
          b.solidRect(ci0, cj, ci0 + 2, cj + 5, h, Surface.Metal, Owner.Prop, CellFlag.Cover);
          for (let s = 0; s < stack; s += 1) {
            b.prop('container', b.cx(ci0) + 1, b.cz(cj) + 2.5, { y: s * CONTAINER_H, sx: 2.5, sy: CONTAINER_H, sz: 6, rot: 0, color: rng.pick(colors), variant: rng.nextU32() });
          }
        }
      }
    }
  }
  // Lanes get pallets and forklifts.
  for (let n = 0; n < 26; n += 1) {
    const c = b.randomOpenCell((i, jj) => i > QUAY + 3 && i < whX0 - 2 && !b.reserved[b.k(i, jj)]);
    if (c) coverCluster(b, c.i, c.j, rng.chance(0.5), 'industrial');
  }

  // Gantry cranes straddling the quay road (legs are pillars).
  const cranes: number[] = [];
  for (let cj = BORDER + 12; cj < b.h - BORDER - 12; cj += rng.int(22, 30)) cranes.push(cj);
  for (const cj of cranes) {
    for (const di of [0, 6]) {
      for (const dj of [0, 8]) {
        const i = QUAY + 1 + di;
        const jj = cj + dj;
        if (b.isFree(i, jj, i, jj, true)) b.pillar('pipe', i, jj, 12, 0.35, Surface.Metal, { sy: 12 });
      }
    }
    b.prop('crane', b.cx(QUAY + 4), b.cz(cj + 4), { sx: 8, sy: 22, sz: 10 });
    b.landmarks.push({ name: `Crane ${cranes.indexOf(cj) + 1}`, x: b.cx(QUAY + 4), z: b.cz(cj + 4) });
    holds.push({ x: b.cx(QUAY + 4), z: b.cz(cj + 4) });
    sites.push({ x: b.cx(QUAY + 4), z: b.cz(cj + 4), kind: 'landmark', r: 5 });
    crateStack(b, QUAY + 3, cj + 3);
  }
  // Pump stations near the quay (sabotage targets will be placed near these sites).
  for (let n = 0; n < 4; n += 1) {
    const jj = Math.floor(BORDER + 8 + ((b.h - 2 * BORDER - 16) * (n + 0.5)) / 4);
    addSite(sites, b, b.cx(QUAY + 2), b.cz(jj), 'edge', 2);
  }
  // Tall sodium lamps along lanes.
  for (let jj = BORDER + 6; jj < b.h - BORDER - 4; jj += 14) {
    for (let i = field.i0 - 2; i < field.i1; i += 22) {
      if (b.isOpen(b.ci(b.cx(i)), jj)) b.lamp(b.cx(i), b.cz(jj), 8, b.biome.palette.lamp, 1.6);
    }
  }

  const extracts: Point[] = [
    { x: b.cx(QUAY + 2), z: b.cz(b.h - BORDER - 4) },
    { x: b.cx(whX0 - 3), z: b.cz(b.h - BORDER - 4) },
  ];
  addSite(sites, b, rcx(b, field), rcz(b, field), 'open', 4);
  b.reinforcements.push(...edgeEntries(b, BORDER, 10, spawn, 30));
  void rw;
  void rh;
  return { spawn, sites, holds, extracts };
}
