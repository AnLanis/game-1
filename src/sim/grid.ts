/**
 * 2.5D heightfield: the single source of truth for level geometry.
 *
 * One compact structure drives collision, hitscan, line-of-sight, navigation,
 * cover analysis, the minimap and world meshing. Raycasts are an exact DDA walk
 * (Amanatides & Woo) over cells in XZ with an analytic height test per cell, so
 * cost is O(cells crossed) regardless of how detailed the rendered world is —
 * cheaper than a BVH and trivially serialisable for netcode.
 */

export const enum Surface {
  Ground = 0,
  Stone = 1,
  Wood = 2,
  Metal = 3,
  Sand = 4,
  Snow = 5,
  Foliage = 6,
  Fabric = 7,
  Rock = 8,
  Concrete = 9,
  Regolith = 10,
  Glass = 11,
}

export const CellFlag = {
  Breakable: 1,
  Explosive: 2,
  Building: 4,
  NoNav: 8,
  Cover: 16,
  Pillar: 32,
  Border: 64,
} as const;

export const enum Shape {
  Box = 0,
  Cylinder = 1,
}

export interface RayHit {
  hit: boolean;
  t: number;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  cell: number;
  surface: number;
}

export const newRayHit = (): RayHit => ({ hit: false, t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, cell: -1, surface: 0 });

const BIG = 1e9;

export class Grid {
  readonly height: Float32Array;
  readonly surface: Uint8Array;
  readonly flags: Uint8Array;
  readonly shape: Uint8Array;
  /** Cylinder radius for Shape.Cylinder cells. */
  readonly radius: Float32Array;
  /** Breakable hit points. */
  readonly hp: Float32Array;
  /** Index into the level's breakable list, or -1. */
  readonly breakId: Int32Array;
  /** Floor surface (what you walk on) per cell. */
  readonly floor: Uint8Array;
  /** Bumped whenever geometry changes (nav/cover caches key on it). */
  version = 0;

  constructor(
    readonly w: number,
    readonly h: number,
    /** World X of the min corner of cell (0, *). */
    readonly ox: number,
    /** World Z of the min corner of cell (*, 0). */
    readonly oz: number,
  ) {
    const n = w * h;
    this.height = new Float32Array(n);
    this.surface = new Uint8Array(n);
    this.flags = new Uint8Array(n);
    this.shape = new Uint8Array(n);
    this.radius = new Float32Array(n);
    this.hp = new Float32Array(n);
    this.breakId = new Int32Array(n).fill(-1);
    this.floor = new Uint8Array(n);
  }

  static centered(w: number, h: number): Grid {
    return new Grid(w, h, -w / 2, -h / 2);
  }

  idx(i: number, j: number): number {
    return j * this.w + i;
  }

  inBounds(i: number, j: number): boolean {
    return i >= 0 && j >= 0 && i < this.w && j < this.h;
  }

  cellX(x: number): number {
    return Math.floor(x - this.ox);
  }

  cellZ(z: number): number {
    return Math.floor(z - this.oz);
  }

  centerX(i: number): number {
    return this.ox + i + 0.5;
  }

  centerZ(j: number): number {
    return this.oz + j + 0.5;
  }

  heightAtCell(i: number, j: number): number {
    return this.inBounds(i, j) ? this.height[j * this.w + i] : BIG;
  }

  heightAt(x: number, z: number): number {
    return this.heightAtCell(this.cellX(x), this.cellZ(z));
  }

  set(i: number, j: number, height: number, surface: number, flags = 0): void {
    if (!this.inBounds(i, j)) return;
    const k = j * this.w + i;
    this.height[k] = height;
    this.surface[k] = surface;
    this.flags[k] = flags;
    this.shape[k] = Shape.Box;
    this.radius[k] = 0.5;
  }

  fillRect(i0: number, j0: number, i1: number, j1: number, height: number, surface: number, flags = 0): void {
    for (let j = Math.max(0, j0); j <= Math.min(this.h - 1, j1); j += 1) {
      for (let i = Math.max(0, i0); i <= Math.min(this.w - 1, i1); i += 1) this.set(i, j, height, surface, flags);
    }
  }

  /** Walkable floor (AI navigation): low enough to walk over without jumping. */
  walkable(i: number, j: number): boolean {
    if (!this.inBounds(i, j)) return false;
    const k = j * this.w + i;
    return this.height[k] <= 0.35 && (this.flags[k] & CellFlag.NoNav) === 0;
  }

  /**
   * Damage a breakable cell. Returns true when it is destroyed this call.
   * Destruction flattens the cell and bumps `version`.
   */
  damageCell(k: number, amount: number): boolean {
    if ((this.flags[k] & CellFlag.Breakable) === 0 || this.height[k] <= 0) return false;
    this.hp[k] -= amount;
    if (this.hp[k] > 0) return false;
    this.height[k] = 0;
    this.flags[k] &= ~(CellFlag.Breakable | CellFlag.Cover | CellFlag.Pillar);
    this.shape[k] = Shape.Box;
    this.version += 1;
    return true;
  }

  /**
   * Exact ray vs heightfield. Direction must be normalised. Cells the ray
   * starts inside are ignored (so shots from a crouch behind a crate never
   * self-block). Returns the first hit within maxDist.
   */
  raycast(
    px: number,
    py: number,
    pz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
    out: RayHit,
  ): boolean {
    out.hit = false;
    out.t = maxDist;
    let i = Math.floor(px - this.ox);
    let j = Math.floor(pz - this.oz);
    const stepI = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepJ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tDeltaX = stepI !== 0 ? Math.abs(1 / dx) : BIG;
    const tDeltaZ = stepJ !== 0 ? Math.abs(1 / dz) : BIG;
    let tMaxX = stepI !== 0 ? (this.ox + i + (stepI > 0 ? 1 : 0) - px) / dx : BIG;
    let tMaxZ = stepJ !== 0 ? (this.oz + j + (stepJ > 0 ? 1 : 0) - pz) / dz : BIG;
    let tEntry = 0;
    let axis = -1;
    const w = this.w;

    for (let guard = 0; guard < 4096; guard += 1) {
      const tExit = Math.min(tMaxX, tMaxZ, maxDist);
      const inside = i >= 0 && j >= 0 && i < w && j < this.h;
      const k = inside ? j * w + i : -1;
      const hgt = inside ? this.height[k] : BIG;

      if (hgt > 0 && axis !== -1) {
        if (inside && this.shape[k] === Shape.Cylinder) {
          if (this.hitCylinder(k, i, j, px, py, pz, dx, dy, dz, tEntry, tExit, hgt, out)) return true;
        } else {
          const yEntry = py + dy * tEntry;
          if (yEntry <= hgt) {
            return this.fill(out, tEntry, px, py, pz, dx, dy, dz, axis === 0 ? -stepI : 0, 0, axis === 1 ? -stepJ : 0, k, inside ? this.surface[k] : 1);
          }
          const yExit = py + dy * tExit;
          if (yExit <= hgt && dy < 0) {
            const tTop = (hgt - py) / dy;
            return this.fill(out, tTop, px, py, pz, dx, dy, dz, 0, 1, 0, k, inside ? this.surface[k] : 1);
          }
        }
      } else if (dy < 0 && (hgt <= 0 || axis === -1)) {
        const tGround = -py / dy;
        if (tGround >= tEntry && tGround <= tExit) {
          return this.fill(out, tGround, px, py, pz, dx, dy, dz, 0, 1, 0, k, inside ? this.floor[k] : 0);
        }
      }

      if (tExit >= maxDist) return false;
      if (tMaxX < tMaxZ) {
        i += stepI;
        tEntry = tMaxX;
        tMaxX += tDeltaX;
        axis = 0;
      } else {
        j += stepJ;
        tEntry = tMaxZ;
        tMaxZ += tDeltaZ;
        axis = 1;
      }
    }
    return false;
  }

  /** True when nothing solid lies between two points. */
  lineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number, scratch: RayHit): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return true;
    return !this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len - 0.05, scratch);
  }

  private hitCylinder(
    k: number,
    i: number,
    j: number,
    px: number,
    py: number,
    pz: number,
    dx: number,
    dy: number,
    dz: number,
    t0: number,
    t1: number,
    hgt: number,
    out: RayHit,
  ): boolean {
    const cx = this.ox + i + 0.5;
    const cz = this.oz + j + 0.5;
    const r = this.radius[k];
    const fx = px - cx;
    const fz = pz - cz;
    const a = dx * dx + dz * dz;
    if (a > 1e-9) {
      const b = 2 * (fx * dx + fz * dz);
      const c = fx * fx + fz * fz - r * r;
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        const tA = (-b - sq) / (2 * a);
        const tB = (-b + sq) / (2 * a);
        const enter = Math.max(tA, t0);
        const exit = Math.min(tB, t1);
        if (enter <= exit) {
          const yEnter = py + dy * enter;
          if (yEnter <= hgt) {
            const hx = px + dx * enter - cx;
            const hz = pz + dz * enter - cz;
            const l = Math.hypot(hx, hz) || 1;
            return this.fill(out, enter, px, py, pz, dx, dy, dz, hx / l, 0, hz / l, k, this.surface[k]);
          }
          const yExit = py + dy * exit;
          if (yExit <= hgt && dy < 0) {
            return this.fill(out, (hgt - py) / dy, px, py, pz, dx, dy, dz, 0, 1, 0, k, this.surface[k]);
          }
        }
      }
    }
    // Ground around the pillar.
    if (dy < 0) {
      const tGround = -py / dy;
      if (tGround >= t0 && tGround <= t1) return this.fill(out, tGround, px, py, pz, dx, dy, dz, 0, 1, 0, k, this.floor[k]);
    }
    return false;
  }

  private fill(
    out: RayHit,
    t: number,
    px: number,
    py: number,
    pz: number,
    dx: number,
    dy: number,
    dz: number,
    nx: number,
    ny: number,
    nz: number,
    cell: number,
    surface: number,
  ): true {
    out.hit = true;
    out.t = t;
    out.x = px + dx * t;
    out.y = py + dy * t;
    out.z = pz + dz * t;
    out.nx = nx;
    out.ny = ny;
    out.nz = nz;
    out.cell = cell;
    out.surface = surface;
    return true;
  }
}
