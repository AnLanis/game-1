import type { BiomeDef, BiomePalette } from '../../content/types';
import { Surface, type Grid } from '../../sim/grid';
import type { BuildingInstance, LevelData } from '../../sim/level';
import { GeoBuilder } from '../geom';
import { LAYER } from '../textures';
import { lin, mix3, Rand, scale3, type RGB } from '../util';

/** Mirror of procgen Owner enum (const enum lives in procgen; duplicated here to avoid cross-module const enum use). */
export const OWNER = { None: 0, Block: 1, Building: 2, Prop: 3, Border: 4 } as const;

export interface LinPalette {
  ground: RGB;
  groundAlt: RGB;
  street: RGB;
  walls: RGB[];
  trims: RGB[];
  accents: RGB[];
  fabric: RGB[];
  foliage: RGB;
  rock: RGB;
  metal: RGB;
  wood: RGB;
  lamp: RGB;
  fog: RGB;
  skyHorizon: RGB;
  skyTop: RGB;
}

export interface BuildCtx {
  level: LevelData;
  grid: Grid;
  biome: BiomeDef;
  pal: BiomePalette;
  lp: LinPalette;
  /** 0 day, 0.5 dusk, 1 night. */
  night: number;
  snow: boolean;
  ground: GeoBuilder;
  matte: GeoBuilder;
  metal: GeoBuilder;
  emis: GeoBuilder;
  water: GeoBuilder;
  rng: Rand;
  /** Building index per cell (-1 none). Owner.Building cells without an instance are domes. */
  cellBuilding: Int16Array;
  /** Cells whose solid geometry is already drawn by a prop model. */
  claimed: Uint8Array;
  /** Map bounds in world units. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  buildings: BuildingInstance[];
}

export function makeLinPalette(p: BiomePalette): LinPalette {
  return {
    ground: lin(p.ground),
    groundAlt: lin(p.groundAlt),
    street: lin(p.street),
    walls: p.walls.map(lin),
    trims: p.trims.map(lin),
    accents: p.accents.map(lin),
    fabric: p.fabric.map(lin),
    foliage: lin(p.foliage),
    rock: lin(p.rock),
    metal: lin(p.metal),
    wood: lin(p.wood),
    lamp: lin(p.lamp),
    fog: lin(p.fog),
    skyHorizon: lin(p.skyHorizon),
    skyTop: lin(p.skyTop),
  };
}

/** Ground texture layer that matches the biome's base surface. */
export function baseGroundLayer(b: BiomeDef): number {
  switch (b.surface) {
    case 'sand':
      return LAYER.sand;
    case 'dirt':
      return LAYER.dirt;
    case 'grass':
      return LAYER.grass;
    case 'stone':
      return LAYER.sand;
    case 'snow':
      return LAYER.snow;
    case 'metal':
      return LAYER.pad;
    case 'regolith':
      return LAYER.regolith;
  }
}

/** Layer + tint for a wall surface enum (used for generic Block cells). */
export function surfaceLayer(s: number): number {
  switch (s) {
    case Surface.Wood:
      return LAYER.wood;
    case Surface.Metal:
      return LAYER.metal;
    case Surface.Rock:
      return LAYER.rock;
    case Surface.Sand:
      return LAYER.sand;
    case Surface.Snow:
      return LAYER.snow;
    case Surface.Regolith:
      return LAYER.regolith;
    case Surface.Foliage:
      return LAYER.leaf;
    case Surface.Fabric:
      return LAYER.fabric;
    default:
      return LAYER.concrete;
  }
}

export const shade = (c: RGB, k: number): RGB => scale3(c, k);
export { mix3 };
