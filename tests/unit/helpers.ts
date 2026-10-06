import { CellFlag, type Grid } from '../../src/sim/grid';
import { hashString } from '../../src/engine/rng';
import type { MissionConfig } from '../../src/sim/mission';
import { PlayerBot } from '../../src/sim/bot';
import { SimWorld } from '../../src/sim/world';

/** FNV-style hash over every geometry array of a grid. */
export function hashGrid(grid: Grid): number {
  let h = hashString(`${grid.w}x${grid.h}`);
  const mix = (v: number): void => {
    h = Math.imul(h ^ (v | 0), 0x01000193) >>> 0;
  };
  for (let k = 0; k < grid.height.length; k += 1) {
    mix(Math.round(grid.height[k] * 1000));
    mix(grid.flags[k]);
    mix(grid.surface[k]);
    mix(grid.shape[k]);
  }
  return h >>> 0;
}

export function nonBorderCount(grid: Grid): number {
  let n = 0;
  for (let k = 0; k < grid.flags.length; k += 1) if ((grid.flags[k] & CellFlag.Border) === 0) n += 1;
  return n;
}

export interface RunResult {
  world: SimWorld;
  ticks: number;
  hashes: number[];
  minHp: number;
}

/** Drive a fresh world with the PlayerBot until it ends or `maxTicks` elapse. */
export function runBot(
  cfg: MissionConfig,
  opts: { maxTicks: number; invulnerable?: boolean; skill?: number; hashEvery?: number; onTick?: (w: SimWorld) => void; botSeedTicks?: number } = { maxTicks: 600 },
): RunResult {
  const world = new SimWorld(cfg);
  world.invulnerable = opts.invulnerable ?? false;
  const bot = new PlayerBot(world, opts.skill ?? 1);
  const hashes: number[] = [];
  let minHp = world.player.hp;
  const drain: unknown[] = [];
  for (let t = 0; t < opts.maxTicks && world.status === 'running'; t += 1) {
    world.step(bot.next());
    if (opts.hashEvery && world.tick % opts.hashEvery === 0) hashes.push(world.hash());
    if (world.player.hp < minHp) minHp = world.player.hp;
    opts.onTick?.(world);
    // Emulate the presentation layer draining events so the buffer never grows unbounded.
    if (world.tick % 30 === 0) world.drainEvents(drain as never[]);
  }
  return { world, ticks: world.tick, hashes, minHp };
}
