import { Surface } from '../../sim/grid';
import type { Point } from '../../sim/level';
import { Owner, type LayoutResult, type LevelBuilder, type Site } from '../builder';
import { barrelGroup, barrier, crateStack, edgeEntries, rockCluster, vehicle } from '../common';

/**
 * Winding canyon pass: everything starts as cliff; a noisy spine is carved
 * from south to north with checkpoint clearings along it, boulders for cover,
 * and a summit lookout at the far end.
 */
export function layoutCanyon(b: LevelBuilder): LayoutResult {
  const rng = b.rng;
  const W = b.w;
  const H = b.h;
  const CLIFF = 15;
  b.solidRect(0, 0, W - 1, H - 1, CLIFF, Surface.Rock, Owner.Border);
  for (let j = 0; j < H; j += 1) for (let i = 0; i < W; i += 1) {
    const k = b.k(i, j);
    b.grid.flags[k] = 64 | 8; // Border | NoNav until carved
  }

  const phase = rng.range(0, Math.PI * 2);
  const amp = W * rng.range(0.16, 0.24);
  const freq = rng.range(1.6, 2.4);
  const spine: Point[] = [];
  const centerAt = (j: number): number => W / 2 + Math.sin((j / H) * Math.PI * freq + phase) * amp + Math.sin(j * 0.21 + phase * 3) * 2;
  const widthAt = (j: number): number => 11 + Math.sin(j * 0.09 + phase) * 2.5 + rng.range(-0.5, 0.5);

  // Checkpoint clearings at thirds (plus the summit).
  const checkpoints = [0.3, 0.55, 0.8].map((t) => Math.floor(H * t));
  const summit = H - 12;
  for (let j = 3; j < H - 3; j += 1) {
    let halfW = widthAt(j) / 2;
    for (const c of checkpoints) if (Math.abs(j - c) < 8) halfW = Math.max(halfW, 11 - Math.abs(j - c) * 0.5);
    if (j > summit - 6) halfW = Math.max(halfW, 12);
    const c = centerAt(j);
    spine.push({ x: b.cx(Math.round(c)), z: b.cz(j) });
    for (let i = Math.floor(c - halfW); i <= Math.ceil(c + halfW); i += 1) {
      if (i < 3 || i > W - 4) continue;
      // Ragged edges.
      const edge = Math.abs(i - c) > halfW - 1 && rng.chance(0.35);
      if (!edge) b.clear(i, j);
    }
  }
  b.paintRect(b.grid.ox + 3, b.grid.oz + 3, b.grid.ox + W - 3, b.grid.oz + H - 3, 'dirt', Surface.Sand);
  // Road along the spine.
  for (let j = 3; j < H - 3; j += 1) {
    const c = centerAt(j);
    b.paintRect(b.cx(Math.round(c)) - 2.2, b.cz(j) - 0.5, b.cx(Math.round(c)) + 2.2, b.cz(j) + 0.5, 'street');
    b.reserve(Math.round(c) - 1, j, Math.round(c), j);
  }

  const spawnJ = 6;
  const spawn = { x: b.cx(Math.round(centerAt(spawnJ))), z: b.cz(spawnJ), yaw: Math.PI };
  b.reserve(Math.round(centerAt(spawnJ)) - 4, 3, Math.round(centerAt(spawnJ)) + 4, spawnJ + 5);

  const sites: Site[] = [];
  const holds: Point[] = [];
  // Boulders scattered through the pass.
  for (let n = 0; n < Math.floor(H * 0.55); n += 1) {
    const j = rng.int(12, H - 8);
    const c = centerAt(j);
    const i = Math.round(c + rng.range(-5, 5));
    rockCluster(b, i, j);
  }
  // Checkpoints: barriers across the road with a gap, a guard hut, a truck.
  checkpoints.forEach((cj, n) => {
    const c = Math.round(centerAt(cj));
    for (let i = c - 9; i <= c + 9; i += 4) {
      if (Math.abs(i - c) < 2) continue;
      barrier(b, i, cj, true);
    }
    const hutI = c + (n % 2 === 0 ? 6 : -9);
    if (b.isFree(hutI, cj + 3, hutI + 3, cj + 6)) b.building(hutI, cj + 3, hutI + 3, cj + 6, 3.2, 'bunker');
    b.sandbags(c - 7, cj - 4, 3, true);
    b.sandbags(c + 5, cj - 4, 3, true);
    vehicle(b, c + (n % 2 === 0 ? -7 : 4), cj + 4, false, 'truck');
    crateStack(b, c + 3, cj + 2);
    barrelGroup(b, c - 4, cj + 3, true);
    b.lamp(b.cx(c - 3), b.cz(cj - 1), 4.2);
    b.prop('flag', b.cx(c + 2), b.cz(cj + 5), { sy: 5, color: b.biome.palette.accents[1] });
    sites.push({ x: b.cx(c), z: b.cz(cj + 1), kind: 'checkpoint', r: 6 });
    sites.push({ x: b.cx(c), z: b.cz(cj - 6), kind: 'open', r: 4 });
    b.landmarks.push({ name: `Checkpoint ${n + 1}`, x: b.cx(c), z: b.cz(cj) });
  });
  // Summit lookout: open platform with sandbag ring.
  const sc = Math.round(centerAt(summit));
  for (let a = 0; a < 6; a += 1) {
    const ang = (a / 6) * Math.PI * 2;
    b.sandbags(Math.round(sc + Math.cos(ang) * 6), Math.round(summit + Math.sin(ang) * 5), 2, a % 2 === 0);
  }
  b.pillar('tower', sc + 8, summit + 3, 10, 0.5, Surface.Metal);
  b.landmarks.push({ name: 'Lookout', x: b.cx(sc), z: b.cz(summit) });
  sites.push({ x: b.cx(sc), z: b.cz(summit), kind: 'landmark', r: 7 });
  holds.push({ x: b.cx(sc), z: b.cz(summit) });
  holds.push({ x: b.cx(Math.round(centerAt(checkpoints[1]))), z: b.cz(checkpoints[1]) });
  for (let j = 16; j < H - 16; j += 14) sites.push({ x: b.cx(Math.round(centerAt(j))), z: b.cz(j), kind: 'open', r: 3 });

  const extracts: Point[] = [{ x: b.cx(sc), z: b.cz(H - 6) }];
  b.reinforcements.push(...edgeEntries(b, 3, 9, spawn, 34));
  // Also along the spine, far from spawn.
  for (let j = 30; j < H - 5; j += 18) b.reinforcements.push({ x: b.cx(Math.round(centerAt(j)) + 3), z: b.cz(j) });
  return { spawn, sites, holds, extracts };
}
