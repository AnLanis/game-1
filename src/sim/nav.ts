import { CellFlag, type Grid } from './grid';
import type { Point } from './level';

/**
 * Grid navigation: octile A* with corner-cut prevention and string-pulling,
 * a Dijkstra flow field for crowds (every rusher samples one shared field),
 * and precomputed cover points. All buffers are preallocated and reused with
 * a generation counter, so a path query allocates only its result.
 */

const SQRT2 = Math.SQRT2;
const NEIGHBORS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

class MinHeap {
  private keys: Int32Array;
  private prio: Float32Array;
  size = 0;

  constructor(capacity: number) {
    this.keys = new Int32Array(capacity);
    this.prio = new Float32Array(capacity);
  }

  clear(): void {
    this.size = 0;
  }

  push(key: number, p: number): void {
    if (this.size >= this.keys.length) {
      const k = new Int32Array(this.keys.length * 2);
      k.set(this.keys);
      const pr = new Float32Array(this.prio.length * 2);
      pr.set(this.prio);
      this.keys = k;
      this.prio = pr;
    }
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent] <= p) break;
      this.keys[i] = this.keys[parent];
      this.prio[i] = this.prio[parent];
      i = parent;
    }
    this.keys[i] = key;
    this.prio[i] = p;
  }

  pop(): number {
    const top = this.keys[0];
    const lastK = this.keys[--this.size];
    const lastP = this.prio[this.size];
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= this.size) break;
      if (child + 1 < this.size && this.prio[child + 1] < this.prio[child]) child += 1;
      if (this.prio[child] >= lastP) break;
      this.keys[i] = this.keys[child];
      this.prio[i] = this.prio[child];
      i = child;
    }
    this.keys[i] = lastK;
    this.prio[i] = lastP;
    return top;
  }
}

export interface CoverPoint {
  cell: number;
  x: number;
  z: number;
  /** Unit directions (x,z) toward adjacent cover. */
  dirs: [number, number][];
  /** Max adjacent cover height. */
  height: number;
  reservedBy: number;
}

export class NavGrid {
  private readonly g: Float32Array;
  private readonly came: Int32Array;
  private readonly gen: Uint32Array;
  private generation = 1;
  private readonly heap: MinHeap;
  /** Flow field: distance (m) from the target cell, Infinity if unreachable. */
  readonly flow: Float32Array;
  flowTarget = -1;
  private readonly flowHeap: MinHeap;
  covers: CoverPoint[] = [];
  private coverVersion = -1;
  /** Cells that are walkable AND connected to the player spawn. */
  readonly reachable: Uint8Array;

  constructor(readonly grid: Grid) {
    const n = grid.w * grid.h;
    this.g = new Float32Array(n);
    this.came = new Int32Array(n);
    this.gen = new Uint32Array(n);
    this.heap = new MinHeap(1024);
    this.flowHeap = new MinHeap(1024);
    this.flow = new Float32Array(n).fill(Infinity);
    this.reachable = new Uint8Array(n);
  }

  /** Flood fill from a seed cell; marks `reachable`. Returns count. */
  computeReachable(sx: number, sz: number): number {
    const grid = this.grid;
    this.reachable.fill(0);
    const start = this.nearestWalkable(grid.cellX(sx), grid.cellZ(sz));
    if (start < 0) return 0;
    const stack = [start];
    this.reachable[start] = 1;
    let count = 0;
    while (stack.length) {
      const k = stack.pop()!;
      count += 1;
      const i = k % grid.w;
      const j = (k - i) / grid.w;
      for (const [di, dj] of NEIGHBORS) {
        if (di !== 0 && dj !== 0) continue;
        const ni = i + di;
        const nj = j + dj;
        if (!grid.walkable(ni, nj)) continue;
        const nk = nj * grid.w + ni;
        if (this.reachable[nk]) continue;
        this.reachable[nk] = 1;
        stack.push(nk);
      }
    }
    return count;
  }

  /** Nearest walkable cell (spiral search). -1 if none within radius. */
  nearestWalkable(i: number, j: number, maxR = 12): number {
    const grid = this.grid;
    if (grid.walkable(i, j)) return j * grid.w + i;
    for (let r = 1; r <= maxR; r += 1) {
      for (let dj = -r; dj <= r; dj += 1) {
        for (let di = -r; di <= r; di += 1) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          if (grid.walkable(i + di, j + dj)) return (j + dj) * grid.w + (i + di);
        }
      }
    }
    return -1;
  }

  private canStep(i: number, j: number, di: number, dj: number): boolean {
    const grid = this.grid;
    if (!grid.walkable(i + di, j + dj)) return false;
    if (di !== 0 && dj !== 0) return grid.walkable(i + di, j) && grid.walkable(i, j + dj);
    return true;
  }

  /**
   * A* from world point to world point. Returns smoothed waypoints (excluding
   * start) or null when unreachable. `maxExpand` caps work per query.
   */
  findPath(sx: number, sz: number, tx: number, tz: number, maxExpand = 6000): Point[] | null {
    const grid = this.grid;
    const w = grid.w;
    const start = this.nearestWalkable(grid.cellX(sx), grid.cellZ(sz), 3);
    const goal = this.nearestWalkable(grid.cellX(tx), grid.cellZ(tz), 6);
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [{ x: tx, z: tz }];
    this.generation += 1;
    if (this.generation > 0xfffffff0) {
      this.gen.fill(0);
      this.generation = 1;
    }
    const gen = this.generation;
    const gi = goal % w;
    const gj = (goal - gi) / w;
    const heap = this.heap;
    heap.clear();
    this.g[start] = 0;
    this.came[start] = -1;
    this.gen[start] = gen;
    heap.push(start, 0);
    let expanded = 0;
    let found = false;
    while (heap.size > 0) {
      const k = heap.pop();
      if (k === goal) {
        found = true;
        break;
      }
      if (++expanded > maxExpand) break;
      const i = k % w;
      const j = (k - i) / w;
      const gk = this.g[k];
      for (const [di, dj, cost] of NEIGHBORS) {
        if (!this.canStep(i, j, di, dj)) continue;
        const nk = (j + dj) * w + (i + di);
        // Slight penalty for hugging walls keeps paths natural and away from corners.
        const ng = gk + cost + (this.nearWall(i + di, j + dj) ? 0.35 : 0);
        if (this.gen[nk] === gen && ng >= this.g[nk]) continue;
        this.gen[nk] = gen;
        this.g[nk] = ng;
        this.came[nk] = k;
        const dx = Math.abs(i + di - gi);
        const dz = Math.abs(j + dj - gj);
        const h = dx + dz + (SQRT2 - 2) * Math.min(dx, dz);
        heap.push(nk, ng + h * 1.001);
      }
    }
    if (!found) return null;
    const cells: number[] = [];
    for (let k = goal; k !== -1; k = this.came[k]) cells.push(k);
    cells.reverse();
    return this.smooth(cells, tx, tz);
  }

  private nearWall(i: number, j: number): boolean {
    const grid = this.grid;
    return !grid.walkable(i + 1, j) || !grid.walkable(i - 1, j) || !grid.walkable(i, j + 1) || !grid.walkable(i, j - 1);
  }

  /** String-pulling: keep only waypoints needed to maintain walkable straight lines. */
  private smooth(cells: number[], tx: number, tz: number): Point[] {
    const grid = this.grid;
    const w = grid.w;
    const out: Point[] = [];
    let anchor = 0;
    let i = 1;
    while (i < cells.length) {
      if (i + 1 < cells.length && this.walkLine(cells[anchor], cells[i + 1])) {
        i += 1;
        continue;
      }
      const ci = cells[i] % w;
      out.push({ x: grid.centerX(ci), z: grid.centerZ((cells[i] - ci) / w) });
      anchor = i;
      i += 1;
    }
    if (out.length) out[out.length - 1] = { x: tx, z: tz };
    else out.push({ x: tx, z: tz });
    // If the requested target sits in an unwalkable cell, stop at the cell center instead.
    const last = out[out.length - 1];
    if (!grid.walkable(grid.cellX(last.x), grid.cellZ(last.z))) {
      const gk = cells[cells.length - 1];
      const gi = gk % w;
      out[out.length - 1] = { x: grid.centerX(gi), z: grid.centerZ((gk - gi) / w) };
    }
    return out;
  }

  /** Conservative walkable line test between cell centres (supercover with body width). */
  walkLine(a: number, b: number): boolean {
    const grid = this.grid;
    const w = grid.w;
    const ai = a % w;
    const aj = (a - ai) / w;
    const bi = b % w;
    const bj = (b - bi) / w;
    const dx = bi - ai;
    const dz = bj - aj;
    const steps = Math.max(Math.abs(dx), Math.abs(dz)) * 3;
    if (steps === 0) return true;
    for (let s = 1; s <= steps; s += 1) {
      const t = s / steps;
      const x = ai + 0.5 + dx * t;
      const z = aj + 0.5 + dz * t;
      // Check the body footprint (~0.35 m) around the sample.
      for (const [ox, oz] of FOOT) {
        if (!grid.walkable(Math.floor(x + ox), Math.floor(z + oz))) return false;
      }
    }
    return true;
  }

  /** Straight-line walkable test between world points. */
  clearWalk(ax: number, az: number, bx: number, bz: number): boolean {
    const grid = this.grid;
    const a = grid.cellZ(az) * grid.w + grid.cellX(ax);
    const b = grid.cellZ(bz) * grid.w + grid.cellX(bx);
    if (!grid.walkable(grid.cellX(ax), grid.cellZ(az)) || !grid.walkable(grid.cellX(bx), grid.cellZ(bz))) return false;
    return this.walkLine(a, b);
  }

  /**
   * Dijkstra flow field toward (tx,tz), capped at maxDist metres. Cheap enough
   * to rebuild whenever the target changes cell (≈1–3 ms on 100×100).
   */
  buildFlow(tx: number, tz: number, maxDist = 90): void {
    const grid = this.grid;
    const w = grid.w;
    const target = this.nearestWalkable(grid.cellX(tx), grid.cellZ(tz), 4);
    if (target < 0 || target === this.flowTarget) return;
    this.flowTarget = target;
    const flow = this.flow;
    flow.fill(Infinity);
    const heap = this.flowHeap;
    heap.clear();
    flow[target] = 0;
    heap.push(target, 0);
    while (heap.size > 0) {
      const k = heap.pop();
      const d = flow[k];
      if (d > maxDist) continue;
      const i = k % w;
      const j = (k - i) / w;
      for (const [di, dj, cost] of NEIGHBORS) {
        if (!this.canStep(i, j, di, dj)) continue;
        const nk = (j + dj) * w + (i + di);
        const nd = d + cost + (this.nearWall(i + di, j + dj) ? 0.3 : 0);
        if (nd < flow[nk]) {
          flow[nk] = nd;
          heap.push(nk, nd);
        }
      }
    }
  }

  /** Direction (unit x,z) down the flow field from a world point, or null. */
  flowDir(x: number, z: number, out: Point): Point | null {
    const grid = this.grid;
    const i = grid.cellX(x);
    const j = grid.cellZ(z);
    if (!grid.inBounds(i, j)) return null;
    const w = grid.w;
    let best = this.flow[j * w + i];
    let bi = 0;
    let bj = 0;
    for (const [di, dj] of NEIGHBORS) {
      if (!this.canStep(i, j, di, dj)) continue;
      const v = this.flow[(j + dj) * w + (i + di)];
      if (v < best) {
        best = v;
        bi = di;
        bj = dj;
      }
    }
    if (bi === 0 && bj === 0) return null;
    const tx = grid.centerX(i + bi) - x;
    const tz = grid.centerZ(j + bj) - z;
    const l = Math.hypot(tx, tz) || 1;
    out.x = tx / l;
    out.z = tz / l;
    return out;
  }

  flowDistance(x: number, z: number): number {
    const grid = this.grid;
    const i = grid.cellX(x);
    const j = grid.cellZ(z);
    return grid.inBounds(i, j) ? this.flow[j * grid.w + i] : Infinity;
  }

  /** (Re)build cover points when the grid changes (crates destroyed, etc). */
  refreshCovers(): void {
    const grid = this.grid;
    if (this.coverVersion === grid.version) return;
    this.coverVersion = grid.version;
    const reserved = new Map<number, number>();
    for (const c of this.covers) if (c.reservedBy >= 0) reserved.set(c.cell, c.reservedBy);
    const covers: CoverPoint[] = [];
    for (let j = 1; j < grid.h - 1; j += 1) {
      for (let i = 1; i < grid.w - 1; i += 1) {
        const k = j * grid.w + i;
        if (!grid.walkable(i, j)) continue;
        if (this.reachable[k] === 0) continue;
        let dirs: [number, number][] | null = null;
        let height = 0;
        for (const [di, dj] of NEIGHBORS) {
          if (di !== 0 && dj !== 0) continue;
          const nk = (j + dj) * grid.w + (i + di);
          const h = grid.height[nk];
          if (h >= 0.9 && (grid.flags[nk] & CellFlag.Border) === 0) {
            (dirs ??= []).push([di, dj]);
            height = Math.max(height, h);
          }
        }
        if (dirs) {
          covers.push({ cell: k, x: grid.centerX(i), z: grid.centerZ(j), dirs, height, reservedBy: reserved.get(k) ?? -1 });
        }
      }
    }
    this.covers = covers;
  }

  releaseCover(actorId: number): void {
    for (const c of this.covers) if (c.reservedBy === actorId) c.reservedBy = -1;
  }
}

const FOOT: [number, number][] = [
  [0, 0],
  [0.33, 0.33],
  [-0.33, 0.33],
  [0.33, -0.33],
  [-0.33, -0.33],
];
