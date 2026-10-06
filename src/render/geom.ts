import { BufferAttribute, BufferGeometry } from 'three';
import { hash1, type RGB } from './util';

/** Growable Float32 buffer. */
class Fbuf {
  data: Float32Array;
  len = 0;
  constructor(cap: number) {
    this.data = new Float32Array(cap);
  }
  ensure(extra: number): void {
    if (this.len + extra <= this.data.length) return;
    let cap = this.data.length * 2;
    while (cap < this.len + extra) cap *= 2;
    const n = new Float32Array(cap);
    n.set(this.data.subarray(0, this.len));
    this.data = n;
  }
}

class Ubuf {
  data: Uint32Array;
  len = 0;
  constructor(cap: number) {
    this.data = new Uint32Array(cap);
  }
  ensure(extra: number): void {
    if (this.len + extra <= this.data.length) return;
    let cap = this.data.length * 2;
    while (cap < this.len + extra) cap *= 2;
    const n = new Uint32Array(cap);
    n.set(this.data.subarray(0, this.len));
    this.data = n;
  }
}

export interface BoxOpts {
  /** Colour of the top face (defaults to `color`). */
  top?: RGB;
  /** Bottom darkening factor 0..1 applied over the first `aoH` metres of side faces (fake ambient occlusion). */
  ao?: number;
  aoH?: number;
  /** Texture tile size in metres. */
  scale?: number;
  /** Side mask: bit0 +x, bit1 -x, bit2 +z, bit3 -z, bit4 top, bit5 bottom. Default 0x1f (no bottom). */
  sides?: number;
  /** Top face scale (frustum), local x/z. */
  tx?: number;
  tz?: number;
  /** Per-face brightness jitter amplitude. */
  jit?: number;
  seed?: number;
}

export interface CylOpts {
  scale?: number;
  ao?: number;
  aoH?: number;
  /** Colour at the far end (gradient along the axis). */
  colorB?: RGB;
  capA?: boolean;
  capB?: boolean;
  /** Start angle (radians) of the first ring vertex. */
  phase?: number;
  /** Sweep in radians (default 2π). */
  sweep?: number;
}

const COR: [number, number, number][] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
];
const cidx = (x: number, y: number, z: number): number => x + y * 2 + z * 4;
// Faces as corner indices, counter-clockwise seen from outside; p0→p1 is the bottom edge, left→right.
const FACES: number[][] = [
  [cidx(1, 0, 1), cidx(1, 0, 0), cidx(1, 1, 0), cidx(1, 1, 1)], // +X
  [cidx(0, 0, 0), cidx(0, 0, 1), cidx(0, 1, 1), cidx(0, 1, 0)], // -X
  [cidx(0, 0, 1), cidx(1, 0, 1), cidx(1, 1, 1), cidx(0, 1, 1)], // +Z
  [cidx(1, 0, 0), cidx(0, 0, 0), cidx(0, 1, 0), cidx(1, 1, 0)], // -Z
  [cidx(0, 1, 1), cidx(1, 1, 1), cidx(1, 1, 0), cidx(0, 1, 0)], // top
  [cidx(0, 0, 0), cidx(1, 0, 0), cidx(1, 0, 1), cidx(0, 0, 1)], // bottom
];

// Unit icosahedron.
const T = (1 + Math.sqrt(5)) / 2;
const ICO_V: number[][] = [
  [-1, T, 0],
  [1, T, 0],
  [-1, -T, 0],
  [1, -T, 0],
  [0, -1, T],
  [0, 1, T],
  [0, -1, -T],
  [0, 1, -T],
  [T, 0, -1],
  [T, 0, 1],
  [-T, 0, -1],
  [-T, 0, 1],
].map((v) => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
});
const ICO_F: number[][] = [
  [0, 11, 5],
  [0, 5, 1],
  [0, 1, 7],
  [0, 7, 10],
  [0, 10, 11],
  [1, 5, 9],
  [5, 11, 4],
  [11, 10, 2],
  [10, 7, 6],
  [7, 1, 8],
  [3, 9, 4],
  [3, 4, 2],
  [3, 2, 6],
  [3, 6, 8],
  [3, 8, 9],
  [4, 9, 5],
  [2, 4, 11],
  [6, 2, 10],
  [8, 6, 7],
  [9, 8, 1],
];

interface IcoMesh {
  v: number[][];
  f: number[][];
}
const icoCache: IcoMesh[] = [];
function ico(detail: number): IcoMesh {
  if (icoCache[detail]) return icoCache[detail];
  let v = ICO_V.map((p) => p.slice());
  let f = ICO_F.map((p) => p.slice());
  for (let d = 0; d < detail; d += 1) {
    const mid = new Map<number, number>();
    const getMid = (a: number, b: number): number => {
      const key = a < b ? a * 10007 + b : b * 10007 + a;
      const hit = mid.get(key);
      if (hit !== undefined) return hit;
      const p = [(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2];
      const l = Math.hypot(p[0], p[1], p[2]);
      v.push([p[0] / l, p[1] / l, p[2] / l]);
      mid.set(key, v.length - 1);
      return v.length - 1;
    };
    const nf: number[][] = [];
    for (const [a, b, c] of f) {
      const ab = getMid(a, b);
      const bc = getMid(b, c);
      const ca = getMid(c, a);
      nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    f = nf;
    v = v.slice();
  }
  icoCache[detail] = { v, f };
  return icoCache[detail];
}

/**
 * Procedural mesh emitter. Everything static in the world is authored through
 * this: indexed triangles carrying position, normal, world-space UV, vertex
 * colour and a texture-array layer. Supports a Y-rotation + translation +
 * uniform-scale transform stack so props are authored in local space.
 */
export class GeoBuilder {
  private readonly pos = new Fbuf(3 * 4096);
  private readonly nrm = new Fbuf(3 * 4096);
  private readonly uv = new Fbuf(2 * 4096);
  private readonly col = new Fbuf(3 * 4096);
  private readonly lay = new Fbuf(4096);
  private readonly idx = new Ubuf(6 * 4096);
  vertexCount = 0;

  // Transform stack (Y rotation, translation, uniform scale).
  private tx = 0;
  private ty = 0;
  private tz = 0;
  private cs = 1;
  private sn = 0;
  private ts = 1;
  private ident = true;
  private readonly stack: number[] = [];
  private tRot = 0;

  get triangleCount(): number {
    return this.idx.len / 3;
  }

  get empty(): boolean {
    return this.vertexCount === 0;
  }

  // ------------------------------------------------------------- transform

  push(x: number, y: number, z: number, rot = 0, scale = 1): this {
    this.stack.push(this.tx, this.ty, this.tz, this.tRot, this.ts);
    // compose: p' = T_parent(R_parent(S_parent p)) applied to local translation
    const wx = this.tx + (x * this.cs + z * this.sn) * this.ts;
    const wz = this.tz + (-x * this.sn + z * this.cs) * this.ts;
    const wy = this.ty + y * this.ts;
    this.tx = wx;
    this.ty = wy;
    this.tz = wz;
    this.tRot += rot;
    this.ts *= scale;
    this.cs = Math.cos(this.tRot);
    this.sn = Math.sin(this.tRot);
    this.ident = this.tx === 0 && this.ty === 0 && this.tz === 0 && this.tRot === 0 && this.ts === 1;
    return this;
  }

  pop(): this {
    this.ts = this.stack.pop()!;
    this.tRot = this.stack.pop()!;
    this.tz = this.stack.pop()!;
    this.ty = this.stack.pop()!;
    this.tx = this.stack.pop()!;
    this.cs = Math.cos(this.tRot);
    this.sn = Math.sin(this.tRot);
    this.ident = this.tx === 0 && this.ty === 0 && this.tz === 0 && this.tRot === 0 && this.ts === 1;
    return this;
  }

  // ------------------------------------------------------------- primitives

  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, c: RGB, layer: number): number {
    this.pos.ensure(3);
    this.nrm.ensure(3);
    this.uv.ensure(2);
    this.col.ensure(3);
    this.lay.ensure(1);
    let px = x;
    let py = y;
    let pz = z;
    let qx = nx;
    let qz = nz;
    if (!this.ident) {
      px = this.tx + (x * this.cs + z * this.sn) * this.ts;
      pz = this.tz + (-x * this.sn + z * this.cs) * this.ts;
      py = this.ty + y * this.ts;
      qx = nx * this.cs + nz * this.sn;
      qz = -nx * this.sn + nz * this.cs;
    }
    let o = this.pos.len;
    this.pos.data[o] = px;
    this.pos.data[o + 1] = py;
    this.pos.data[o + 2] = pz;
    this.pos.len += 3;
    o = this.nrm.len;
    this.nrm.data[o] = qx;
    this.nrm.data[o + 1] = ny;
    this.nrm.data[o + 2] = qz;
    this.nrm.len += 3;
    o = this.uv.len;
    this.uv.data[o] = u;
    this.uv.data[o + 1] = v;
    this.uv.len += 2;
    o = this.col.len;
    this.col.data[o] = c[0];
    this.col.data[o + 1] = c[1];
    this.col.data[o + 2] = c[2];
    this.col.len += 3;
    this.lay.data[this.lay.len] = layer;
    this.lay.len += 1;
    return this.vertexCount++;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.ensure(3);
    const o = this.idx.len;
    this.idx.data[o] = a;
    this.idx.data[o + 1] = b;
    this.idx.data[o + 2] = c;
    this.idx.len += 3;
  }

  /**
   * Quad p0..p3 (counter-clockwise from outside; p0→p1 is the "bottom" edge).
   * c0 colours p0,p1; c1 colours p2,p3 (vertical gradient).
   */
  quad(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    x2: number, y2: number, z2: number,
    x3: number, y3: number, z3: number,
    layer: number, c0: RGB, c1: RGB = c0, scale = 2, uo = 0, vo = 0,
  ): void {
    this.quadC(x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3, layer, c0, c0, c1, c1, scale, uo, vo);
  }

  /** Quad with an individual colour per vertex (ground ambient occlusion). */
  quadC(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    x2: number, y2: number, z2: number,
    x3: number, y3: number, z3: number,
    layer: number, ca: RGB, cb: RGB, cc: RGB, cd: RGB, scale = 2, uo = 0, vo = 0,
  ): void {
    const ex = x1 - x0;
    const ey = y1 - y0;
    const ez = z1 - z0;
    const fx = x3 - x0;
    const fy = y3 - y0;
    const fz = z3 - z0;
    let nx = ey * fz - ez * fy;
    let ny = ez * fx - ex * fz;
    let nz = ex * fy - ey * fx;
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-9) return;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const el = Math.hypot(ex, ey, ez) || 1;
    const ux = ex / el;
    const uy = ey / el;
    const uz = ez / el;
    // w = n × u
    const wx = ny * uz - nz * uy;
    const wy = nz * ux - nx * uz;
    const wz = nx * uy - ny * ux;
    const is = 1 / scale;
    const a = this.vert(x0, y0, z0, nx, ny, nz, (x0 * ux + y0 * uy + z0 * uz) * is + uo, (x0 * wx + y0 * wy + z0 * wz) * is + vo, ca, layer);
    const b = this.vert(x1, y1, z1, nx, ny, nz, (x1 * ux + y1 * uy + z1 * uz) * is + uo, (x1 * wx + y1 * wy + z1 * wz) * is + vo, cb, layer);
    const c = this.vert(x2, y2, z2, nx, ny, nz, (x2 * ux + y2 * uy + z2 * uz) * is + uo, (x2 * wx + y2 * wy + z2 * wz) * is + vo, cc, layer);
    const d = this.vert(x3, y3, z3, nx, ny, nz, (x3 * ux + y3 * uy + z3 * uz) * is + uo, (x3 * wx + y3 * wy + z3 * wz) * is + vo, cd, layer);
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  /** Same as quad() but visible from both sides (two coincident faces with opposite normals). */
  quad2(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    x2: number, y2: number, z2: number,
    x3: number, y3: number, z3: number,
    layer: number, c0: RGB, c1: RGB = c0, scale = 2,
  ): void {
    this.quad(x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3, layer, c0, c1, scale);
    this.quad(x1, y1, z1, x0, y0, z0, x3, y3, z3, x2, y2, z2, layer, c0, c1, scale);
  }

  /** Single triangle, counter-clockwise from outside. */
  triFace(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, layer: number, c: RGB, scale = 2): void {
    const ex = x1 - x0;
    const ey = y1 - y0;
    const ez = z1 - z0;
    const fx = x2 - x0;
    const fy = y2 - y0;
    const fz = z2 - z0;
    let nx = ey * fz - ez * fy;
    let ny = ez * fx - ex * fz;
    let nz = ex * fy - ey * fx;
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-9) return;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const el = Math.hypot(ex, ey, ez) || 1;
    const ux = ex / el;
    const uy = ey / el;
    const uz = ez / el;
    const wx = ny * uz - nz * uy;
    const wy = nz * ux - nx * uz;
    const wz = nx * uy - ny * ux;
    const is = 1 / scale;
    const a = this.vert(x0, y0, z0, nx, ny, nz, (x0 * ux + y0 * uy + z0 * uz) * is, (x0 * wx + y0 * wy + z0 * wz) * is, c, layer);
    const b = this.vert(x1, y1, z1, nx, ny, nz, (x1 * ux + y1 * uy + z1 * uz) * is, (x1 * wx + y1 * wy + z1 * wz) * is, c, layer);
    const d = this.vert(x2, y2, z2, nx, ny, nz, (x2 * ux + y2 * uy + z2 * uz) * is, (x2 * wx + y2 * wy + z2 * wz) * is, c, layer);
    this.tri(a, b, d);
  }

  /** Horizontal quad (top faces) on plane y, ccw from above: x0..x1, z0..z1. */
  floorQuad(x0: number, z0: number, x1: number, z1: number, y: number, layer: number, c: RGB, scale = 2): void {
    this.quad(x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0, layer, c, c, scale);
  }

  // ------------------------------------------------------------------ boxes

  /**
   * Axis-aligned-in-local-space box, rotated about Y by `rot`. (cx, y0, cz) is the
   * centre of the bottom face. sx/sz are full widths, sy the height.
   */
  box(cx: number, y0: number, cz: number, sx: number, sy: number, sz: number, rot: number, layer: number, color: RGB, o: BoxOpts = {}): void {
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    const hx = sx / 2;
    const hz = sz / 2;
    const tx = o.tx ?? 1;
    const tz = o.tz ?? 1;
    const P = new Float64Array(24);
    for (let n = 0; n < 8; n += 1) {
      const [xi, yi, zi] = COR[n];
      const k = yi ? tx : 1;
      const kz = yi ? tz : 1;
      const lx = (xi ? hx : -hx) * k;
      const lz = (zi ? hz : -hz) * kz;
      P[n * 3] = cx + lx * cs + lz * sn;
      P[n * 3 + 1] = y0 + (yi ? sy : 0);
      P[n * 3 + 2] = cz - lx * sn + lz * cs;
    }
    this.boxFaces(P, layer, color, sy, o);
  }

  /** General oriented box: centre of bottom face + three orthonormal axes (x, y, z) and full sizes. */
  obox(
    cx: number, cy: number, cz: number,
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    dx: number, dy: number, dz: number,
    sx: number, sy: number, sz: number,
    layer: number, color: RGB, o: BoxOpts = {},
  ): void {
    const P = new Float64Array(24);
    for (let n = 0; n < 8; n += 1) {
      const [xi, yi, zi] = COR[n];
      const lx = (xi ? 0.5 : -0.5) * sx * (yi ? (o.tx ?? 1) : 1);
      const lz = (zi ? 0.5 : -0.5) * sz * (yi ? (o.tz ?? 1) : 1);
      const ly = yi ? sy : 0;
      P[n * 3] = cx + ax * lx + bx * ly + dx * lz;
      P[n * 3 + 1] = cy + ay * lx + by * ly + dy * lz;
      P[n * 3 + 2] = cz + az * lx + bz * ly + dz * lz;
    }
    this.boxFaces(P, layer, color, sy, o);
  }

  /** Beam between two points with a square-ish cross-section (w × h). */
  beam(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, w: number, h: number, layer: number, color: RGB, o: BoxOpts = {}): void {
    let dx = x1 - x0;
    let dy = y1 - y0;
    let dz = z1 - z0;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return;
    dx /= len;
    dy /= len;
    dz /= len;
    // local z axis = beam direction; pick a stable up-ish vector for the cross-section
    let ux = 0;
    let uy = 1;
    let uz = 0;
    if (Math.abs(dy) > 0.95) {
      ux = 1;
      uy = 0;
    }
    // x axis = up × d ; y axis = d × x
    let xx = uy * dz - uz * dy;
    let xy = uz * dx - ux * dz;
    let xz = ux * dy - uy * dx;
    const xl = Math.hypot(xx, xy, xz) || 1;
    xx /= xl;
    xy /= xl;
    xz /= xl;
    const yx = dy * xz - dz * xy;
    const yy = dz * xx - dx * xz;
    const yz = dx * xy - dy * xx;
    // box is built with its "bottom" at -h/2 in local y and centred on x and z
    const cx = (x0 + x1) / 2 - yx * (h / 2);
    const cy = (y0 + y1) / 2 - yy * (h / 2);
    const cz = (z0 + z1) / 2 - yz * (h / 2);
    this.obox(cx, cy, cz, xx, xy, xz, yx, yy, yz, dx, dy, dz, w, h, len, layer, color, { ...o, sides: o.sides ?? 0x3f });
  }

  private boxFaces(P: Float64Array, layer: number, color: RGB, sy: number, o: BoxOpts): void {
    const sides = o.sides ?? 0x1f;
    const scale = o.scale ?? 2;
    const ao = o.ao ?? 0;
    const aoH = o.aoH ?? 1.4;
    const jit = o.jit ?? 0;
    const seed = o.seed ?? 0;
    for (let f = 0; f < 6; f += 1) {
      if (!(sides & (1 << f))) continue;
      const F = FACES[f];
      let c: RGB = f === 4 && o.top ? o.top : color;
      if (jit > 0) {
        const k = 1 + (hash1(seed * 7 + f * 13 + Math.floor(P[0] * 3.1 + P[2] * 5.7)) - 0.5) * 2 * jit;
        c = [c[0] * k, c[1] * k, c[2] * k];
      }
      const p0 = F[0] * 3;
      const p1 = F[1] * 3;
      const p2 = F[2] * 3;
      const p3 = F[3] * 3;
      if (f < 4 && ao > 0 && sy > aoH * 1.2) {
        const t = aoH / sy;
        const dark: RGB = [c[0] * (1 - ao), c[1] * (1 - ao), c[2] * (1 - ao)];
        const m0x = P[p0] + (P[p3] - P[p0]) * t;
        const m0y = P[p0 + 1] + (P[p3 + 1] - P[p0 + 1]) * t;
        const m0z = P[p0 + 2] + (P[p3 + 2] - P[p0 + 2]) * t;
        const m1x = P[p1] + (P[p2] - P[p1]) * t;
        const m1y = P[p1 + 1] + (P[p2 + 1] - P[p1 + 1]) * t;
        const m1z = P[p1 + 2] + (P[p2 + 2] - P[p1 + 2]) * t;
        this.quad(P[p0], P[p0 + 1], P[p0 + 2], P[p1], P[p1 + 1], P[p1 + 2], m1x, m1y, m1z, m0x, m0y, m0z, layer, dark, c, scale);
        this.quad(m0x, m0y, m0z, m1x, m1y, m1z, P[p2], P[p2 + 1], P[p2 + 2], P[p3], P[p3 + 1], P[p3 + 2], layer, c, c, scale);
      } else if (f < 4 && ao > 0) {
        const dark: RGB = [c[0] * (1 - ao), c[1] * (1 - ao), c[2] * (1 - ao)];
        this.quad(P[p0], P[p0 + 1], P[p0 + 2], P[p1], P[p1 + 1], P[p1 + 2], P[p2], P[p2 + 1], P[p2 + 2], P[p3], P[p3 + 1], P[p3 + 2], layer, dark, c, scale);
      } else {
        this.quad(P[p0], P[p0 + 1], P[p0 + 2], P[p1], P[p1 + 1], P[p1 + 2], P[p2], P[p2 + 1], P[p2 + 2], P[p3], P[p3 + 1], P[p3 + 2], layer, c, c, scale);
      }
    }
  }

  // -------------------------------------------------------------- cylinders

  /** Cylinder / cone / frustum along an arbitrary axis from A (radius r0) to B (radius r1). */
  cylAxis(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r0: number, r1: number, seg: number, layer: number, color: RGB, o: CylOpts = {}): void {
    let dx = bx - ax;
    let dy = by - ay;
    let dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return;
    dx /= len;
    dy /= len;
    dz /= len;
    let rx = 0;
    let ry = 1;
    let rz = 0;
    if (Math.abs(dy) > 0.98) {
      rx = 1;
      ry = 0;
    }
    let ux = ry * dz - rz * dy;
    let uy = rz * dx - rx * dz;
    let uz = rx * dy - ry * dx;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    const wx = dy * uz - dz * uy;
    const wy = dz * ux - dx * uz;
    const wz = dx * uy - dy * ux;
    const scale = o.scale ?? 2;
    const sweep = o.sweep ?? Math.PI * 2;
    const phase = o.phase ?? 0;
    const full = sweep >= Math.PI * 2 - 1e-6;
    const colB = o.colorB ?? color;
    const slope = (r0 - r1) / len;
    const vertical = Math.abs(dy) > 0.98;
    const rm = (r0 + r1) * 0.5;
    const ao = o.ao ?? 0;
    const aoH = Math.min(o.aoH ?? 0.8, len * 0.5);
    const ringCount = ao > 0 ? 3 : 2;
    const ringT = ao > 0 ? [0, aoH / len, 1] : [0, 1];
    const ringCol: RGB[] =
      ao > 0
        ? [[color[0] * (1 - ao), color[1] * (1 - ao), color[2] * (1 - ao)], color, colB]
        : [color, colB];
    const cols = seg + 1;
    const first = this.vertexCount;
    for (let r = 0; r < ringCount; r += 1) {
      const t = ringT[r];
      const rad = r0 + (r1 - r0) * t;
      const bx0 = ax + dx * len * t;
      const by0 = ay + dy * len * t;
      const bz0 = az + dz * len * t;
      for (let k = 0; k < cols; k += 1) {
        const phi = phase + (k / seg) * sweep;
        const cph = Math.cos(phi);
        const sph = Math.sin(phi);
        const nrx = ux * cph + wx * sph;
        const nry = uy * cph + wy * sph;
        const nrz = uz * cph + wz * sph;
        let nx = nrx + dx * slope;
        let ny = nry + dy * slope;
        let nz = nrz + dz * slope;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl;
        ny /= nl;
        nz /= nl;
        const px = bx0 + nrx * rad;
        const py = by0 + nry * rad;
        const pz = bz0 + nrz * rad;
        const u = (phi * rm) / scale;
        const v = vertical ? py / scale : (t * len) / scale;
        this.vert(px, py, pz, nx, ny, nz, u, v, ringCol[r], layer);
      }
    }
    for (let r = 0; r < ringCount - 1; r += 1) {
      for (let k = 0; k < seg; k += 1) {
        const a = first + r * cols + k;
        const b = first + r * cols + k + 1;
        const c = first + (r + 1) * cols + k;
        const d = first + (r + 1) * cols + k + 1;
        const nx = this.nrm.data[a * 3] + this.nrm.data[b * 3];
        const ny = this.nrm.data[a * 3 + 1] + this.nrm.data[b * 3 + 1];
        const nz = this.nrm.data[a * 3 + 2] + this.nrm.data[b * 3 + 2];
        this.triOrientedWorld(a, b, c, nx, ny, nz);
        this.triOrientedWorld(b, d, c, nx, ny, nz);
      }
    }
    // caps
    const capA = o.capA ?? true;
    const capB = o.capB ?? true;
    if (capA && r0 > 1e-4) this.cap(ax, ay, az, -dx, -dy, -dz, ux, uy, uz, wx, wy, wz, r0, seg, layer, color, phase, sweep, full);
    if (capB && r1 > 1e-4) this.cap(bx, by, bz, dx, dy, dz, ux, uy, uz, wx, wy, wz, r1, seg, layer, colB, phase, sweep, full);
  }

  private triOrientedWorld(a: number, b: number, c: number, nx: number, ny: number, nz: number): void {
    const p = this.pos.data;
    const ax = p[b * 3] - p[a * 3];
    const ay = p[b * 3 + 1] - p[a * 3 + 1];
    const az = p[b * 3 + 2] - p[a * 3 + 2];
    const bx = p[c * 3] - p[a * 3];
    const by = p[c * 3 + 1] - p[a * 3 + 1];
    const bz = p[c * 3 + 2] - p[a * 3 + 2];
    const gx = ay * bz - az * by;
    const gy = az * bx - ax * bz;
    const gz = ax * by - ay * bx;
    if (gx * nx + gy * ny + gz * nz >= 0) this.tri(a, b, c);
    else this.tri(a, c, b);
  }

  private cap(cx: number, cy: number, cz: number, nx: number, ny: number, nz: number, ux: number, uy: number, uz: number, wx: number, wy: number, wz: number, r: number, seg: number, layer: number, color: RGB, phase: number, sweep: number, full: boolean): void {
    void full;
    const centre = this.vert(cx, cy, cz, nx, ny, nz, 0.5, 0.5, color, layer);
    const first = this.vertexCount;
    for (let k = 0; k <= seg; k += 1) {
      const phi = phase + (k / seg) * sweep;
      const cph = Math.cos(phi);
      const sph = Math.sin(phi);
      this.vert(cx + (ux * cph + wx * sph) * r, cy + (uy * cph + wy * sph) * r, cz + (uz * cph + wz * sph) * r, nx, ny, nz, 0.5 + cph * 0.5, 0.5 + sph * 0.5, color, layer);
    }
    const wnx = this.nrm.data[centre * 3];
    const wny = this.nrm.data[centre * 3 + 1];
    const wnz = this.nrm.data[centre * 3 + 2];
    for (let k = 0; k < seg; k += 1) this.triOrientedWorld(centre, first + k, first + k + 1, wnx, wny, wnz);
  }

  /** Vertical cylinder / frustum with base centre (cx, y0, cz). */
  cyl(cx: number, y0: number, cz: number, r0: number, r1: number, h: number, seg: number, layer: number, color: RGB, o: CylOpts = {}): void {
    this.cylAxis(cx, y0, cz, cx, y0 + h, cz, r0, r1, seg, layer, color, o);
  }

  cone(cx: number, y0: number, cz: number, r: number, h: number, seg: number, layer: number, color: RGB, o: CylOpts = {}): void {
    this.cylAxis(cx, y0, cz, cx, y0 + h, cz, r, 0, seg, layer, color, { capB: false, ...o });
  }

  /** Faceted noisy ellipsoid: foliage clumps, rocks, snow mounds. */
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, detail: number, seed: number, jitter: number, layer: number, cTop: RGB, cBot: RGB, rot = 0, scale = 3): void {
    const m = ico(detail);
    const n = m.v.length;
    const P = new Float64Array(n * 3);
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    for (let i = 0; i < n; i += 1) {
      const v = m.v[i];
      const k = 1 + (hash1(seed * 131 + i * 17) - 0.5) * 2 * jitter;
      const lx = v[0] * rx * k;
      const ly = v[1] * ry * k;
      const lz = v[2] * rz * k;
      P[i * 3] = cx + lx * cs + lz * sn;
      P[i * 3 + 1] = cy + ly;
      P[i * 3 + 2] = cz - lx * sn + lz * cs;
    }
    const is = 1 / scale;
    for (let f = 0; f < m.f.length; f += 1) {
      const [a, b, c] = m.f[f];
      const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
      const bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2];
      const qx = P[c * 3], qy = P[c * 3 + 1], qz = P[c * 3 + 2];
      let nx = (by - ay) * (qz - az) - (bz - az) * (qy - ay);
      let ny = (bz - az) * (qx - ax) - (bx - ax) * (qz - az);
      let nz = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax);
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      const t = Math.min(1, Math.max(0, 0.5 + ny * 0.55 + (hash1(seed * 977 + f) - 0.5) * 0.25));
      const col: RGB = [cBot[0] + (cTop[0] - cBot[0]) * t, cBot[1] + (cTop[1] - cBot[1]) * t, cBot[2] + (cTop[2] - cBot[2]) * t];
      const i0 = this.vert(ax, ay, az, nx, ny, nz, ax * is, az * is, col, layer);
      const i1 = this.vert(bx, by, bz, nx, ny, nz, bx * is, bz * is, col, layer);
      const i2 = this.vert(qx, qy, qz, nx, ny, nz, qx * is, qz * is, col, layer);
      this.tri(i0, i1, i2);
    }
  }

  /** Hemispherical dome: base ring radius r at y0, height h. */
  dome(cx: number, y0: number, cz: number, r: number, h: number, segU: number, segV: number, layer: number, color: RGB, cTop: RGB = color, o: { scale?: number; ao?: number } = {}): void {
    const first = this.vertexCount;
    const scale = o.scale ?? 3;
    for (let j = 0; j <= segV; j += 1) {
      const th = (j / segV) * (Math.PI / 2);
      const rr = Math.cos(th) * r;
      const yy = Math.sin(th) * h;
      const t = j / segV;
      const c: RGB = [color[0] + (cTop[0] - color[0]) * t, color[1] + (cTop[1] - color[1]) * t, color[2] + (cTop[2] - color[2]) * t];
      const k = j === 0 && (o.ao ?? 0) > 0 ? 1 - (o.ao ?? 0) : 1;
      for (let i = 0; i <= segU; i += 1) {
        const phi = (i / segU) * Math.PI * 2;
        const cph = Math.cos(phi);
        const sph = Math.sin(phi);
        // ellipsoid normal
        let nx = cph * Math.cos(th) * h;
        let ny = Math.sin(th) * r;
        let nz = sph * Math.cos(th) * h;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl;
        ny /= nl;
        nz /= nl;
        this.vert(cx + cph * rr, y0 + yy, cz + sph * rr, nx, ny, nz, (phi * r) / scale, (th * r) / scale, [c[0] * k, c[1] * k, c[2] * k], layer);
      }
    }
    const cols = segU + 1;
    for (let j = 0; j < segV; j += 1) {
      for (let i = 0; i < segU; i += 1) {
        const a = first + j * cols + i;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        const nx = this.nrm.data[a * 3];
        const ny = this.nrm.data[a * 3 + 1];
        const nz = this.nrm.data[a * 3 + 2];
        this.triOrientedWorld(a, b, c, nx, ny, nz);
        this.triOrientedWorld(b, d, c, nx, ny, nz);
      }
    }
  }

  /** Gable roof over a rectangle. ridgeAlongX: ridge runs along X. Two slopes + two end triangles. */
  gable(x0: number, z0: number, x1: number, z1: number, yEave: number, yRidge: number, ridgeAlongX: boolean, over: number, layer: number, cA: RGB, cB: RGB, cEnd: RGB, endLayer = layer): void {
    const ex0 = x0 - over;
    const ex1 = x1 + over;
    const ez0 = z0 - over;
    const ez1 = z1 + over;
    if (ridgeAlongX) {
      const zm = (z0 + z1) / 2;
      // south slope (normal +z, up)
      this.quad(ex0, yEave, ez1, ex1, yEave, ez1, ex1, yRidge, zm, ex0, yRidge, zm, layer, cA, cA, 2);
      this.quad(ex1, yEave, ez0, ex0, yEave, ez0, ex0, yRidge, zm, ex1, yRidge, zm, layer, cB, cB, 2);
      this.triFace(x1, yEave, z1, x1, yEave, z0, x1, yRidge, zm, endLayer, cEnd);
      this.triFace(x0, yEave, z0, x0, yEave, z1, x0, yRidge, zm, endLayer, cEnd);
    } else {
      const xm = (x0 + x1) / 2;
      this.quad(ex1, yEave, ez1, ex1, yEave, ez0, xm, yRidge, ez0, xm, yRidge, ez1, layer, cA, cA, 2);
      this.quad(ex0, yEave, ez0, ex0, yEave, ez1, xm, yRidge, ez1, xm, yRidge, ez0, layer, cB, cB, 2);
      this.triFace(x0, yEave, z1, x1, yEave, z1, xm, yRidge, z1, endLayer, cEnd);
      this.triFace(x1, yEave, z0, x0, yEave, z0, xm, yRidge, z0, endLayer, cEnd);
    }
  }

  // ------------------------------------------------------------------ output

  toGeometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos.data.slice(0, this.pos.len), 3));
    g.setAttribute('normal', new BufferAttribute(this.nrm.data.slice(0, this.nrm.len), 3));
    g.setAttribute('uv', new BufferAttribute(this.uv.data.slice(0, this.uv.len), 2));
    g.setAttribute('color', new BufferAttribute(this.col.data.slice(0, this.col.len), 3));
    g.setAttribute('aLayer', new BufferAttribute(this.lay.data.slice(0, this.lay.len), 1));
    g.setIndex(new BufferAttribute(this.idx.data.slice(0, this.idx.len), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  /** Positions/indices snapshot for unit tests. */
  stats(): { vertices: number; triangles: number } {
    return { vertices: this.vertexCount, triangles: this.triangleCount };
  }

  /** Axis-aligned bounds of everything emitted so far (for tests / culling). */
  bounds(): { min: [number, number, number]; max: [number, number, number] } {
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    const p = this.pos.data;
    for (let i = 0; i < this.pos.len; i += 3) {
      for (let a = 0; a < 3; a += 1) {
        if (p[i + a] < min[a]) min[a] = p[i + a];
        if (p[i + a] > max[a]) max[a] = p[i + a];
      }
    }
    return { min, max };
  }
}
