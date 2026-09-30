import type { BiomeDef } from '../content/types';
import { Rng } from '../engine/rng';
import { CellFlag, Grid, Shape, Surface } from '../sim/grid';
import type {
  BreakableInstance,
  BuildingInstance,
  LampInstance,
  LevelData,
  PaintRect,
  PickupSpawn,
  Point,
  PropInstance,
  PropKind,
} from '../sim/level';

/** What renders a solid cell: generic block, a building facade, or a prop mesh. */
export const enum Owner {
  None = 0,
  Block = 1,
  Building = 2,
  Prop = 3,
  Border = 4,
}

export type SiteKind = 'plaza' | 'courtyard' | 'building' | 'alley' | 'edge' | 'landmark' | 'open' | 'checkpoint' | 'interior';

export interface Site {
  x: number;
  z: number;
  kind: SiteKind;
  /** Rough radius of open space around the site. */
  r: number;
}

export interface LayoutResult {
  spawn: { x: number; z: number; yaw: number };
  sites: Site[];
  /** Preferred hold-zone centres (open, defensible). */
  holds: Point[];
  /** Preferred extraction centres (far from spawn). */
  extracts: Point[];
}

export const surfaceForBiome = (b: BiomeDef): Surface => {
  switch (b.surface) {
    case 'sand':
      return Surface.Sand;
    case 'dirt':
      return Surface.Sand;
    case 'grass':
      return Surface.Foliage;
    case 'stone':
      return Surface.Stone;
    case 'snow':
      return Surface.Snow;
    case 'metal':
      return Surface.Concrete;
    case 'regolith':
      return Surface.Regolith;
  }
};

/**
 * Mutable scratchpad the layout generators write into. Keeps grid cells,
 * render descriptors and gameplay markup consistent with each other.
 */
export class LevelBuilder {
  readonly grid: Grid;
  readonly owner: Uint8Array;
  /** Cells that must stay open (streets, spawn pads, lanes). */
  readonly reserved: Uint8Array;
  readonly props: PropInstance[] = [];
  readonly buildings: BuildingInstance[] = [];
  readonly breakables: BreakableInstance[] = [];
  readonly lamps: LampInstance[] = [];
  readonly paint: PaintRect[] = [];
  readonly pickups: PickupSpawn[] = [];
  readonly landmarks: { name: string; x: number; z: number }[] = [];
  readonly reinforcements: Point[] = [];
  readonly floorSurface: Surface;

  constructor(
    readonly biome: BiomeDef,
    readonly rng: Rng,
    w: number,
    h: number,
  ) {
    this.grid = Grid.centered(w, h);
    this.owner = new Uint8Array(w * h);
    this.reserved = new Uint8Array(w * h);
    this.floorSurface = surfaceForBiome(biome);
    this.grid.floor.fill(this.floorSurface);
  }

  get w(): number {
    return this.grid.w;
  }

  get h(): number {
    return this.grid.h;
  }

  /** World coords of a cell centre. */
  cx(i: number): number {
    return this.grid.centerX(i);
  }

  cz(j: number): number {
    return this.grid.centerZ(j);
  }

  ci(x: number): number {
    return this.grid.cellX(x);
  }

  cj(z: number): number {
    return this.grid.cellZ(z);
  }

  k(i: number, j: number): number {
    return j * this.grid.w + i;
  }

  inside(i: number, j: number, margin = 0): boolean {
    return i >= margin && j >= margin && i < this.w - margin && j < this.h - margin;
  }

  pick<T>(list: readonly T[]): T {
    return this.rng.pick(list);
  }

  wallColor(): string {
    return this.rng.pick(this.biome.palette.walls);
  }

  trimColor(): string {
    return this.rng.pick(this.biome.palette.trims);
  }

  accent(): string {
    return this.rng.pick(this.biome.palette.accents);
  }

  fabric(): string {
    return this.rng.pick(this.biome.palette.fabric);
  }

  // ---------------------------------------------------------------- queries

  isOpen(i: number, j: number): boolean {
    return this.grid.inBounds(i, j) && this.grid.height[this.k(i, j)] <= 0;
  }

  /** Rect is fully open and (optionally) unreserved. */
  isFree(i0: number, j0: number, i1: number, j1: number, allowReserved = false, margin = 0): boolean {
    for (let j = j0 - margin; j <= j1 + margin; j += 1) {
      for (let i = i0 - margin; i <= i1 + margin; i += 1) {
        if (!this.grid.inBounds(i, j)) return false;
        const k = this.k(i, j);
        if (this.grid.height[k] > 0) return false;
        if (!allowReserved && this.reserved[k] && i >= i0 && i <= i1 && j >= j0 && j <= j1) return false;
      }
    }
    return true;
  }

  reserve(i0: number, j0: number, i1: number, j1: number): void {
    for (let j = Math.max(0, j0); j <= Math.min(this.h - 1, j1); j += 1) {
      for (let i = Math.max(0, i0); i <= Math.min(this.w - 1, i1); i += 1) this.reserved[this.k(i, j)] = 1;
    }
  }

  paintRect(x0: number, z0: number, x1: number, z1: number, kind: PaintRect['kind'], surface?: Surface): void {
    this.paint.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), kind });
    if (surface !== undefined) {
      for (let j = this.cj(Math.min(z0, z1)); j <= this.cj(Math.max(z0, z1) - 0.01); j += 1) {
        for (let i = this.ci(Math.min(x0, x1)); i <= this.ci(Math.max(x0, x1) - 0.01); i += 1) {
          if (this.grid.inBounds(i, j)) this.grid.floor[this.k(i, j)] = surface;
        }
      }
    }
  }

  // ---------------------------------------------------------------- writers

  solid(i: number, j: number, height: number, surface: Surface, owner: Owner, flags = 0): void {
    if (!this.grid.inBounds(i, j)) return;
    this.grid.set(i, j, height, surface, flags);
    this.owner[this.k(i, j)] = owner;
  }

  solidRect(i0: number, j0: number, i1: number, j1: number, height: number, surface: Surface, owner: Owner, flags = 0): void {
    for (let j = j0; j <= j1; j += 1) for (let i = i0; i <= i1; i += 1) this.solid(i, j, height, surface, owner, flags);
  }

  clear(i: number, j: number): void {
    if (!this.grid.inBounds(i, j)) return;
    this.grid.set(i, j, 0, 0, 0);
    this.owner[this.k(i, j)] = Owner.None;
  }

  border(thickness: number, height: number, surface: Surface): void {
    for (let j = 0; j < this.h; j += 1) {
      for (let i = 0; i < this.w; i += 1) {
        if (i < thickness || j < thickness || i >= this.w - thickness || j >= this.h - thickness) {
          this.solid(i, j, height, surface, Owner.Border, CellFlag.Border | CellFlag.NoNav);
        }
      }
    }
  }

  building(
    i0: number,
    j0: number,
    i1: number,
    j1: number,
    height: number,
    style: BuildingInstance['style'],
    color = this.wallColor(),
    trim = this.trimColor(),
  ): BuildingInstance {
    const surface = style === 'warehouse' || style === 'container' ? Surface.Metal : style === 'habitat' ? Surface.Metal : style === 'barn' || style === 'shed' ? Surface.Wood : Surface.Concrete;
    this.solidRect(i0, j0, i1, j1, height, surface, Owner.Building, CellFlag.Building);
    const b: BuildingInstance = { i0, j0, i1, j1, height, style, color, trim, variant: this.rng.nextU32() };
    this.buildings.push(b);
    return b;
  }

  /** Visual-only prop (no collision). */
  prop(kind: PropKind, x: number, z: number, opts: Partial<Omit<PropInstance, 'kind' | 'x' | 'z'>> = {}): PropInstance {
    const p: PropInstance = {
      kind,
      x,
      z,
      y: opts.y ?? 0,
      rot: opts.rot ?? 0,
      sx: opts.sx ?? 1,
      sy: opts.sy ?? 1,
      sz: opts.sz ?? 1,
      variant: opts.variant ?? this.rng.nextU32(),
      color: opts.color,
    };
    this.props.push(p);
    return p;
  }

  /**
   * Prop with a solid footprint on the grid. Footprint is an axis-aligned cell
   * rect; the visual can be rotated by quarter turns to match.
   */
  solidProp(
    kind: PropKind,
    i0: number,
    j0: number,
    i1: number,
    j1: number,
    height: number,
    surface: Surface,
    opts: Partial<Omit<PropInstance, 'kind' | 'x' | 'z'>> = {},
    flags = CellFlag.Cover,
  ): PropInstance {
    this.solidRect(i0, j0, i1, j1, height, surface, Owner.Prop, flags);
    const x = (this.grid.ox + i0 + this.grid.ox + i1 + 1) / 2;
    const z = (this.grid.oz + j0 + this.grid.oz + j1 + 1) / 2;
    return this.prop(kind, x, z, { sx: i1 - i0 + 1, sy: height, sz: j1 - j0 + 1, ...opts });
  }

  /** Round obstacle occupying one cell (trees, poles, barrels, rocks). */
  pillar(kind: PropKind, i: number, j: number, height: number, radius: number, surface: Surface, opts: Partial<Omit<PropInstance, 'kind' | 'x' | 'z'>> = {}, flags = 0): PropInstance {
    this.solid(i, j, height, surface, Owner.Prop, flags | CellFlag.Pillar);
    const k = this.k(i, j);
    this.grid.shape[k] = Shape.Cylinder;
    this.grid.radius[k] = radius;
    return this.prop(kind, this.cx(i), this.cz(j), { sx: radius * 2, sy: height, sz: radius * 2, ...opts });
  }

  crate(i: number, j: number, height = 1.0): void {
    const k = this.k(i, j);
    this.solid(i, j, height, Surface.Wood, Owner.Prop, CellFlag.Breakable | CellFlag.Cover);
    this.grid.hp[k] = 70;
    this.grid.breakId[k] = this.breakables.length;
    this.breakables.push({ cell: k, kind: 'crate', x: this.cx(i), z: this.cz(j), height, color: this.biome.palette.wood });
  }

  barrel(i: number, j: number, explosive: boolean): void {
    const k = this.k(i, j);
    this.solid(i, j, 1.1, Surface.Metal, Owner.Prop, CellFlag.Breakable | CellFlag.Cover | (explosive ? CellFlag.Explosive : 0));
    this.grid.shape[k] = Shape.Cylinder;
    this.grid.radius[k] = 0.36;
    this.grid.hp[k] = explosive ? 45 : 140;
    this.grid.breakId[k] = this.breakables.length;
    this.breakables.push({ cell: k, kind: explosive ? 'explosive' : 'barrel', x: this.cx(i), z: this.cz(j), height: 1.1, color: explosive ? '#b8321e' : this.accent() });
  }

  /** Line of sandbags from (i,j) along axis. */
  sandbags(i: number, j: number, length: number, horizontal: boolean, height = 1.0): boolean {
    const i1 = horizontal ? i + length - 1 : i;
    const j1 = horizontal ? j : j + length - 1;
    if (!this.isFree(i, j, i1, j1)) return false;
    this.solidProp('sandbags', i, j, i1, j1, height, Surface.Fabric, { rot: horizontal ? 0 : Math.PI / 2 });
    return true;
  }

  lamp(x: number, z: number, height = 4.2, color = this.biome.palette.lamp, intensity = 1): void {
    this.lamps.push({ x, y: height, z, color, intensity });
    this.prop('lamp', x, z, { sy: height, color });
  }

  // ------------------------------------------------------------ connectivity

  /** BFS distances (in cells) over open cells from a world point. */
  distanceField(x: number, z: number): Int32Array {
    const g = this.grid;
    const dist = new Int32Array(g.w * g.h).fill(-1);
    const si = g.cellX(x);
    const sj = g.cellZ(z);
    if (!g.walkable(si, sj)) return dist;
    const queue = new Int32Array(g.w * g.h);
    let head = 0;
    let tail = 0;
    const start = this.k(si, sj);
    dist[start] = 0;
    queue[tail++] = start;
    while (head < tail) {
      const k = queue[head++];
      const i = k % g.w;
      const j = (k - i) / g.w;
      const d = dist[k] + 1;
      for (const [di, dj] of DIRS4) {
        const ni = i + di;
        const nj = j + dj;
        if (!g.walkable(ni, nj)) continue;
        const nk = nj * g.w + ni;
        if (dist[nk] >= 0) continue;
        dist[nk] = d;
        queue[tail++] = nk;
      }
    }
    return dist;
  }

  /**
   * Guarantee every walkable cell is reachable from the spawn. Small pockets
   * are filled; large ones get the cover props sealing them removed.
   */
  ensureConnected(x: number, z: number): void {
    for (let pass = 0; pass < 4; pass += 1) {
      const dist = this.distanceField(x, z);
      const g = this.grid;
      const seen = new Uint8Array(g.w * g.h);
      let changed = false;
      for (let k0 = 0; k0 < dist.length; k0 += 1) {
        if (dist[k0] >= 0 || seen[k0]) continue;
        const i0 = k0 % g.w;
        const j0 = (k0 - i0) / g.w;
        if (!g.walkable(i0, j0)) continue;
        // Flood this pocket.
        const pocket: number[] = [];
        const stack = [k0];
        seen[k0] = 1;
        while (stack.length) {
          const k = stack.pop()!;
          pocket.push(k);
          const i = k % g.w;
          const j = (k - i) / g.w;
          for (const [di, dj] of DIRS4) {
            const ni = i + di;
            const nj = j + dj;
            if (!g.walkable(ni, nj)) continue;
            const nk = nj * g.w + ni;
            if (seen[nk]) continue;
            seen[nk] = 1;
            stack.push(nk);
          }
        }
        if (pocket.length < 36 || pass === 3) {
          for (const k of pocket) {
            const i = k % g.w;
            const j = (k - i) / g.w;
            this.solid(i, j, 1.2, Surface.Stone, Owner.Block, CellFlag.NoNav);
          }
        } else {
          // Remove props adjacent to the pocket to open it up.
          const pocketSet = new Set(pocket);
          for (const k of pocket) {
            const i = k % g.w;
            const j = (k - i) / g.w;
            for (const [di, dj] of DIRS4) {
              const nk = (j + dj) * g.w + (i + di);
              if (pocketSet.has(nk) || !g.inBounds(i + di, j + dj)) continue;
              if (this.owner[nk] === Owner.Prop) {
                this.removePropAt(i + di, j + dj);
                changed = true;
              }
            }
          }
          if (!changed) {
            // Fallback: carve toward the reachable area.
            this.carveToward(pocket[0], dist);
            changed = true;
          }
        }
      }
      if (!changed) break;
    }
  }

  private removePropAt(i: number, j: number): void {
    const g = this.grid;
    const x = this.cx(i);
    const z = this.cz(j);
    // Find the prop whose footprint covers the cell and clear the entire footprint.
    for (let n = this.props.length - 1; n >= 0; n -= 1) {
      const p = this.props[n];
      const hx = p.sx / 2;
      const hz = p.sz / 2;
      if (Math.abs(p.x - x) <= hx && Math.abs(p.z - z) <= hz) {
        for (let jj = this.cj(p.z - hz + 0.01); jj <= this.cj(p.z + hz - 0.01); jj += 1) {
          for (let ii = this.ci(p.x - hx + 0.01); ii <= this.ci(p.x + hx - 0.01); ii += 1) {
            if (g.inBounds(ii, jj) && this.owner[this.k(ii, jj)] === Owner.Prop) this.clear(ii, jj);
          }
        }
        this.props.splice(n, 1);
      }
    }
    if (this.owner[this.k(i, j)] === Owner.Prop) this.clear(i, j);
    // Breakables referencing cleared cells are dropped at finalize.
  }

  private carveToward(k: number, dist: Int32Array): void {
    const g = this.grid;
    const i0 = k % g.w;
    const j0 = (k - i0) / g.w;
    let best = -1;
    let bd = Infinity;
    for (let kk = 0; kk < dist.length; kk += 1) {
      if (dist[kk] < 0) continue;
      const i = kk % g.w;
      const j = (kk - i) / g.w;
      const d = Math.abs(i - i0) + Math.abs(j - j0);
      if (d < bd) {
        bd = d;
        best = kk;
      }
    }
    if (best < 0) return;
    let i = i0;
    let j = j0;
    const ti = best % g.w;
    const tj = (best - ti) / g.w;
    while (i !== ti || j !== tj) {
      if (i !== ti) i += Math.sign(ti - i);
      else j += Math.sign(tj - j);
      const kk = this.k(i, j);
      if ((g.flags[kk] & CellFlag.Border) !== 0) continue;
      if (g.height[kk] > 0) {
        // Keep building visuals consistent: lower the cell to a doorway-sized gap.
        this.clear(i, j);
      }
    }
  }

  /** Walkable open cells (not reserved) sampled uniformly. */
  randomOpenCell(filter?: (i: number, j: number) => boolean, tries = 400): { i: number; j: number } | null {
    for (let n = 0; n < tries; n += 1) {
      const i = this.rng.int(2, this.w - 3);
      const j = this.rng.int(2, this.h - 3);
      if (!this.grid.walkable(i, j)) continue;
      if (filter && !filter(i, j)) continue;
      return { i, j };
    }
    return null;
  }

  finalize(seed: number, spawn: { x: number; z: number; yaw: number }): LevelData {
    const g = this.grid;
    // Drop breakables whose cells were cleared, and reindex.
    const kept = this.breakables.filter((b) => (g.flags[b.cell] & CellFlag.Breakable) !== 0);
    g.breakId.fill(-1);
    kept.forEach((b, n) => (g.breakId[b.cell] = n));
    this.breakables.length = 0;
    this.breakables.push(...kept);
    g.version += 1;
    return {
      seed,
      biome: this.biome.id,
      grid: g,
      playerSpawn: spawn,
      squads: [],
      reinforcements: this.reinforcements,
      civilians: [],
      markers: [],
      props: this.props,
      buildings: this.buildings,
      breakables: this.breakables,
      lamps: this.lamps,
      pickups: this.pickups,
      paint: this.paint,
      landmarks: this.landmarks,
      cellOwner: this.owner,
    };
  }
}

export const DIRS4: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
