import {
  CanvasTexture,
  ClampToEdgeWrapping,
  DataArrayTexture,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';
import type { BiomeDef } from '../content/types';
import { hash1, hash2, tfbm, tnoise } from './util';

/** Texture-array layer ids used by every static mesh (per-vertex `aLayer`). */
export const LAYER = {
  plaster: 0,
  brick: 1,
  concrete: 2,
  sand: 3,
  grass: 4,
  dirt: 5,
  snow: 6,
  regolith: 7,
  metal: 8,
  wood: 9,
  fabric: 10,
  rock: 11,
  street: 12,
  plaza: 13,
  crop: 14,
  pad: 15,
  roof: 16,
  container: 17,
  sign: 18,
  solar: 19,
  leaf: 20,
  flat: 21,
} as const;
export const LAYER_COUNT = 22;
export type LayerName = keyof typeof LAYER;

const N = 256;

export interface WorldTextures {
  array: DataArrayTexture;
  waterNormal: DataTexture;
  /** 1×1 white, needed so materials compile with USE_MAP (uv varyings). */
  dummy: DataTexture;
  dispose(): void;
}

type RGBb = [number, number, number];

const hex3 = (hex: string): RGBb => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mixb = (a: RGBb, b: RGBb, t: number): RGBb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const cl = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

function makeCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = N;
  canvas.height = N;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');
  return { canvas, ctx };
}

/** Per-pixel painter: fn(u, v, x, y, out) writes rgb 0..255 into out. */
function paintPixels(ctx: CanvasRenderingContext2D, fn: (u: number, v: number, x: number, y: number, out: RGBb) => void): void {
  const img = ctx.createImageData(N, N);
  const d = img.data;
  const out: RGBb = [0, 0, 0];
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      fn(x / N, y / N, x, y, out);
      const o = (y * N + x) * 4;
      d[o] = cl(out[0]);
      d[o + 1] = cl(out[1]);
      d[o + 2] = cl(out[2]);
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Additive dot painter with wraparound (pebbles, blades, sparkles). */
function speckle(ctx: CanvasRenderingContext2D, count: number, seed: number, draw: (x: number, y: number, r: number) => string, rmin: number, rmax: number): void {
  for (let i = 0; i < count; i += 1) {
    const x = hash1(seed + i * 3) * N;
    const y = hash1(seed + i * 3 + 1) * N;
    const r = rmin + hash1(seed + i * 3 + 2) * (rmax - rmin);
    ctx.fillStyle = draw(x, y, r);
    for (const ox of [0, -N, N]) {
      for (const oy of [0, -N, N]) {
        if (x + ox + r < -1 || x + ox - r > N + 1 || y + oy + r < -1 || y + oy - r > N + 1) continue;
        ctx.beginPath();
        ctx.ellipse(x + ox, y + oy, r, r * 0.8, hash1(seed + i) * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

/** Jittered-grid Voronoi (tileable): returns nearest and second nearest distance plus cell id. */
function voronoi(u: number, v: number, cells: number, seed: number): { d1: number; d2: number; id: number } {
  const x = u * cells;
  const y = v * cells;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let d1 = 9;
  let d2 = 9;
  let id = 0;
  for (let j = -1; j <= 1; j += 1) {
    for (let i = -1; i <= 1; i += 1) {
      const cx = ix + i;
      const cy = iy + j;
      const wx = ((cx % cells) + cells) % cells;
      const wy = ((cy % cells) + cells) % cells;
      const px = cx + 0.15 + hash2(wx, wy, seed) * 0.7;
      const py = cy + 0.15 + hash2(wx, wy, seed + 7) * 0.7;
      const d = Math.hypot(px - x, py - y);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = wy * cells + wx;
      } else if (d < d2) d2 = d;
    }
  }
  return { d1, d2, id };
}

type Painter = (ctx: CanvasRenderingContext2D, b: BiomeDef) => void;

const PAINTERS: Record<keyof typeof LAYER, Painter> = {
  plaster: (ctx) => {
    paintPixels(ctx, (u, v, x, y, o) => {
      const blot = (tfbm(u, v, 3, 11, 4) - 0.5) * 0.2;
      const streak = (tnoise(u * 2, v * 30, 2, 5) - 0.5) * 0.05;
      const grain = (hash2(x, y, 3) - 0.5) * 0.06;
      const k = 0.9 + blot + streak + grain;
      o[0] = 255 * k;
      o[1] = 254 * k;
      o[2] = 250 * k;
    });
    ctx.strokeStyle = 'rgba(70,60,48,0.16)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 6; i += 1) {
      let x = 20 + hash1(i * 7) * 216;
      let y = 20 + hash1(i * 7 + 1) * 216;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let s = 0; s < 6; s += 1) {
        x += (hash1(i * 31 + s) - 0.5) * 22;
        y += hash1(i * 17 + s) * 14;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  },
  brick: (ctx) => {
    const bh = 32;
    const bw = 64;
    paintPixels(ctx, (u, v, x, y, o) => {
      const row = Math.floor(y / bh);
      const off = row % 2 ? bw / 2 : 0;
      const bx = (x + off) % N;
      const col = Math.floor(bx / bw);
      const lx = bx % bw;
      const ly = y % bh;
      const mortar = lx < 3 || ly < 3;
      const id = row * 4 + col;
      if (mortar) {
        const k = 0.9 + (hash2(x, y, 9) - 0.5) * 0.08;
        o[0] = 226 * k;
        o[1] = 218 * k;
        o[2] = 204 * k;
      } else {
        const tone = 0.82 + (hash1(id * 13 + 5) - 0.5) * 0.3 + (tfbm(u, v, 6, 3, 3) - 0.5) * 0.14 + (hash2(x, y, 4) - 0.5) * 0.07;
        const edge = Math.min(lx - 3, bw - lx, ly - 3, bh - ly);
        const e = edge < 3 ? 0.9 + edge * 0.033 : 1;
        o[0] = 250 * tone * e;
        o[1] = 226 * tone * e;
        o[2] = 210 * tone * e;
      }
    });
  },
  concrete: (ctx) => {
    paintPixels(ctx, (u, v, x, y, o) => {
      let k = 0.74 + (tfbm(u, v, 2, 21, 5) - 0.5) * 0.24 + (hash2(x, y, 2) - 0.5) * 0.07;
      k += (tnoise(u * 18, v * 2, 18, 8) - 0.5) * 0.06;
      const seam = x < 2 || y < 2 || (y > 126 && y < 129);
      if (seam) k *= 0.72;
      // tie holes
      const tx = (x % 128) - 64;
      const ty = (y % 128) - 64;
      if (Math.abs(Math.abs(tx) - 38) < 2.2 && Math.abs(Math.abs(ty) - 38) < 2.2) k *= 0.7;
      o[0] = 255 * k;
      o[1] = 255 * k;
      o[2] = 252 * k;
    });
  },
  sand: (ctx, b) => {
    const base = hex3(b.palette.ground);
    const alt = hex3(b.palette.groundAlt);
    paintPixels(ctx, (u, v, x, y, o) => {
      const warp = tfbm(u, v, 3, 4, 3);
      const rip = 0.5 + 0.5 * Math.sin((v * 9 + warp * 2.2) * Math.PI * 2);
      const patch = tfbm(u, v, 2, 12, 4);
      const c = mixb(base, alt, patch * 0.8);
      const k = 0.94 + rip * 0.05 + (hash2(x, y, 6) - 0.5) * 0.09;
      o[0] = c[0] * k;
      o[1] = c[1] * k;
      o[2] = c[2] * k;
    });
    speckle(ctx, 130, 40, () => 'rgba(90,70,45,0.22)', 0.6, 1.6);
    speckle(ctx, 90, 80, () => 'rgba(255,240,210,0.2)', 0.6, 1.3);
  },
  grass: (ctx, b) => {
    const g = mixb(hex3(b.palette.ground), hex3(b.palette.foliage), 0.65);
    const dark = mixb(g, [20, 40, 10], 0.35);
    paintPixels(ctx, (u, v, x, y, o) => {
      const patch = tfbm(u, v, 3, 31, 4);
      const c = mixb(dark, g, 0.25 + patch * 0.9);
      const k = 0.92 + (hash2(x, y, 8) - 0.5) * 0.14;
      o[0] = c[0] * k;
      o[1] = c[1] * k;
      o[2] = c[2] * k;
    });
    for (let i = 0; i < 1400; i += 1) {
      const x = hash1(i * 3) * N;
      const y = hash1(i * 3 + 1) * N;
      const l = 3 + hash1(i * 3 + 2) * 5;
      const t = hash1(i * 5 + 2);
      ctx.strokeStyle = t > 0.5 ? 'rgba(210,230,120,0.22)' : 'rgba(20,50,10,0.24)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (t - 0.5) * 3, y - l);
      ctx.stroke();
    }
  },
  dirt: (ctx, b) => {
    const base = hex3(b.palette.groundAlt);
    const dark = mixb(base, [40, 28, 18], 0.3);
    paintPixels(ctx, (u, v, x, y, o) => {
      const p = tfbm(u, v, 4, 51, 5);
      const c = mixb(dark, base, 0.3 + p * 0.8);
      const k = 0.95 + (hash2(x, y, 12) - 0.5) * 0.12;
      o[0] = c[0] * k;
      o[1] = c[1] * k;
      o[2] = c[2] * k;
    });
    speckle(ctx, 220, 90, (x, y) => (hash2(x | 0, y | 0, 1) > 0.5 ? 'rgba(60,45,30,0.3)' : 'rgba(210,190,150,0.22)'), 0.7, 2.2);
  },
  snow: (ctx) => {
    paintPixels(ctx, (u, v, x, y, o) => {
      const p = tfbm(u, v, 3, 61, 5);
      const k = 0.9 + (p - 0.5) * 0.16 + (hash2(x, y, 14) - 0.5) * 0.03;
      o[0] = 236 * k;
      o[1] = 243 * k;
      o[2] = 255 * k;
      const sh = Math.max(0, 0.42 - p) * 0.55;
      o[0] -= sh * 70;
      o[1] -= sh * 50;
    });
    speckle(ctx, 120, 33, () => 'rgba(255,255,255,0.5)', 0.5, 1.1);
  },
  regolith: (ctx, b) => {
    const base = hex3(b.palette.ground);
    const alt = hex3(b.palette.groundAlt);
    paintPixels(ctx, (u, v, x, y, o) => {
      const p = tfbm(u, v, 4, 71, 5);
      const rip = 0.5 + 0.5 * Math.sin((u * 7 + tfbm(u, v, 3, 5, 3) * 2.5) * Math.PI * 2);
      const c = mixb(alt, base, 0.25 + p * 0.9);
      const k = 0.93 + rip * 0.05 + (hash2(x, y, 16) - 0.5) * 0.11;
      o[0] = c[0] * k;
      o[1] = c[1] * k;
      o[2] = c[2] * k;
    });
    speckle(ctx, 180, 12, (x, y) => (hash2(x | 0, y | 0, 5) > 0.55 ? 'rgba(50,25,15,0.35)' : 'rgba(230,160,120,0.22)'), 0.8, 2.4);
  },
  metal: (ctx) => {
    paintPixels(ctx, (u, v, x, y, o) => {
      const rib = 0.5 + 0.5 * Math.sin(u * 8 * Math.PI * 2);
      let k = 0.66 + rib * 0.3 + (tnoise(u * 40, v * 3, 40, 3) - 0.5) * 0.08 + (hash2(x, y, 18) - 0.5) * 0.04;
      const rust = Math.max(0, tfbm(u, v, 3, 90, 4) - 0.6) * 1.4;
      k *= 1 - rust * 0.25;
      if (y > 126 && y < 129) k *= 0.6;
      o[0] = 232 * k + rust * 30;
      o[1] = 236 * k + rust * 8;
      o[2] = 240 * k - rust * 10;
    });
    ctx.strokeStyle = 'rgba(30,30,34,0.16)';
    for (let i = 0; i < 26; i += 1) {
      const x = hash1(i * 5) * N;
      const y = hash1(i * 5 + 1) * N;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (hash1(i * 5 + 2) - 0.5) * 30, y + (hash1(i * 5 + 3) - 0.5) * 6);
      ctx.stroke();
    }
  },
  wood: (ctx) => {
    const bh = 32;
    paintPixels(ctx, (u, v, x, y, o) => {
      const row = Math.floor(y / bh);
      const ly = y % bh;
      const tone = 0.8 + (hash1(row * 19 + 3) - 0.5) * 0.3;
      const grain = tnoise(u * 3 + row * 1.7, (y / N) * 90, 3, 22 + row);
      const g = 0.86 + (grain - 0.5) * 0.24 + (hash2(x, y, 5) - 0.5) * 0.04;
      let k = tone * g;
      if (ly < 2) k *= 0.5;
      else if (ly < 4) k *= 0.85;
      o[0] = 246 * k;
      o[1] = 218 * k;
      o[2] = 176 * k;
    });
    for (let r = 0; r < 8; r += 1) {
      const kx = 30 + hash1(r * 11) * 190;
      ctx.fillStyle = 'rgba(80,50,25,0.4)';
      ctx.beginPath();
      ctx.ellipse(kx, r * 32 + 16 + (hash1(r * 3) - 0.5) * 8, 4, 2.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  fabric: (ctx) => {
    paintPixels(ctx, (u, v, x, y, o) => {
      const weave = 0.5 + 0.25 * Math.sin(x * 1.4) * Math.sin(y * 1.4) + 0.25 * Math.sin(x * 0.7 + y * 0.35);
      const k = 0.9 + (weave - 0.5) * 0.1 + (tfbm(u, v, 4, 6, 3) - 0.5) * 0.1;
      o[0] = 250 * k;
      o[1] = 250 * k;
      o[2] = 250 * k;
    });
  },
  rock: (ctx, b) => {
    const base = hex3(b.palette.rock);
    paintPixels(ctx, (u, v, x, y, o) => {
      const strata = 0.5 + 0.5 * Math.sin((v * 7 + tfbm(u, v, 2, 44, 4) * 3.2) * Math.PI * 2);
      const m = tfbm(u, v, 4, 45, 5);
      const k = 0.7 + m * 0.5 + strata * 0.08 + (hash2(x, y, 20) - 0.5) * 0.06;
      const vor = voronoi(u, v, 6, 3);
      const crack = vor.d2 - vor.d1 < 0.06 ? 0.7 : 1;
      o[0] = base[0] * k * crack;
      o[1] = base[1] * k * crack;
      o[2] = base[2] * k * crack;
    });
  },
  street: (ctx, b) => {
    const base = hex3(b.palette.street);
    if (b.surface === 'stone') {
      paintPixels(ctx, (u, v, x, y, o) => {
        const vo = voronoi(u, v, 8, 9);
        const t = 0.82 + (hash1(vo.id * 7 + 1) - 0.5) * 0.36 + (hash2(x, y, 22) - 0.5) * 0.06;
        const gap = vo.d2 - vo.d1 < 0.085 ? 0.5 : 1;
        const bevel = Math.min(1, (vo.d2 - vo.d1) * 6 + 0.55);
        o[0] = base[0] * t * gap * bevel;
        o[1] = base[1] * t * gap * bevel;
        o[2] = base[2] * t * gap * bevel;
      });
    } else if (b.surface === 'metal') {
      paintPixels(ctx, (u, v, x, y, o) => {
        const k = 0.9 + (tfbm(u, v, 4, 5, 4) - 0.5) * 0.25 + (hash2(x, y, 30) - 0.5) * 0.12;
        o[0] = base[0] * k;
        o[1] = base[1] * k;
        o[2] = base[2] * k * 1.03;
      });
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      for (let i = 0; i < 5; i += 1) {
        let x = hash1(i * 9) * N;
        let y = hash1(i * 9 + 1) * N;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let s = 0; s < 5; s += 1) {
          x += (hash1(i * 13 + s) - 0.5) * 40;
          y += (hash1(i * 17 + s) - 0.5) * 40;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    } else {
      paintPixels(ctx, (u, v, x, y, o) => {
        const p = tfbm(u, v, 4, 15, 4);
        const k = 0.86 + p * 0.28 + (hash2(x, y, 31) - 0.5) * 0.1;
        o[0] = base[0] * k;
        o[1] = base[1] * k;
        o[2] = base[2] * k;
      });
      speckle(ctx, 320, 55, (x, y) => (hash2(x | 0, y | 0, 3) > 0.5 ? 'rgba(50,40,30,0.32)' : 'rgba(230,220,200,0.26)'), 0.7, 2.0);
    }
  },
  plaza: (ctx, b) => {
    const base = mixb(hex3(b.palette.street), hex3(b.palette.walls[0]), 0.55);
    paintPixels(ctx, (u, v, x, y, o) => {
      const tx = Math.floor(x / 64);
      const ty = Math.floor(y / 64);
      const lx = x % 64;
      const ly = y % 64;
      const t = 0.88 + (hash2(tx, ty, 8) - 0.5) * 0.18 + (((tx + ty) & 1) ? 0.04 : -0.02) + (hash2(x, y, 9) - 0.5) * 0.05;
      const joint = lx < 2 || ly < 2 ? 0.62 : 1;
      const edge = Math.min(lx, ly) < 4 ? 0.94 : 1;
      const m = 1 + (tfbm(u, v, 4, 60, 3) - 0.5) * 0.14;
      o[0] = base[0] * t * joint * edge * m;
      o[1] = base[1] * t * joint * edge * m;
      o[2] = base[2] * t * joint * edge * m;
    });
  },
  crop: (ctx, b) => {
    const soil = hex3(b.palette.groundAlt);
    const plant = mixb(hex3(b.palette.foliage), [180, 210, 90], 0.15);
    paintPixels(ctx, (u, v, x, y, o) => {
      const row = 0.5 + 0.5 * Math.sin(u * 8 * Math.PI * 2);
      const p = Math.pow(row, 1.6);
      const noise = tfbm(u, v, 8, 77, 3);
      const leaf = Math.min(1, Math.max(0, p * 1.15 + (noise - 0.5) * 0.7 - 0.2));
      const c = mixb(mixb(soil, [30, 20, 12], 0.35), plant, leaf);
      const k = 0.92 + (hash2(x, y, 40) - 0.5) * 0.18;
      o[0] = c[0] * k;
      o[1] = c[1] * k;
      o[2] = c[2] * k;
    });
  },
  pad: (ctx, b) => {
    const base = mixb(hex3(b.palette.street), [200, 200, 200], 0.35);
    paintPixels(ctx, (u, v, x, y, o) => {
      const lx = x % 128;
      const ly = y % 128;
      const joint = lx < 3 || ly < 3 ? 0.55 : 1;
      const k = (0.9 + (tfbm(u, v, 3, 88, 5) - 0.5) * 0.24 + (hash2(x, y, 44) - 0.5) * 0.06) * joint;
      o[0] = base[0] * k;
      o[1] = base[1] * k;
      o[2] = base[2] * k;
    });
    speckle(ctx, 18, 71, () => 'rgba(20,20,20,0.16)', 4, 10);
  },
  roof: (ctx) => {
    paintPixels(ctx, (u, v, x, y, o) => {
      const k = 0.62 + (tfbm(u, v, 4, 5, 4) - 0.5) * 0.3 + (hash2(x, y, 50) - 0.5) * 0.14;
      o[0] = 250 * k;
      o[1] = 246 * k;
      o[2] = 240 * k;
    });
  },
  container: (ctx) => {
    paintPixels(ctx, (u, v, x, y, o) => {
      const rib = 0.5 + 0.5 * Math.sin(u * 16 * Math.PI * 2);
      let k = 0.78 + rib * 0.2 + (tnoise(u * 32, v * 4, 32, 9) - 0.5) * 0.06 + (hash2(x, y, 52) - 0.5) * 0.03;
      const rust = Math.max(0, tfbm(u, v, 3, 91, 4) - 0.62) * 1.6;
      k *= 1 - rust * 0.3;
      if (y < 5 || y > 250) k *= 0.7;
      o[0] = 250 * k + rust * 34;
      o[1] = 250 * k + rust * 10;
      o[2] = 250 * k - rust * 12;
    });
  },
  sign: (ctx) => {
    paintPixels(ctx, (u, v, x, y, o) => {
      const k = 0.95 + (tfbm(u, v, 4, 3, 3) - 0.5) * 0.08;
      o[0] = 255 * k;
      o[1] = 255 * k;
      o[2] = 255 * k;
    });
    ctx.strokeStyle = 'rgba(20,16,12,0.85)';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    for (let row = 0; row < 2; row += 1) {
      const y0 = 70 + row * 84;
      let x = 26;
      let n = 0;
      while (x < 226) {
        const w = 12 + hash1(row * 50 + n) * 26;
        const kind = Math.floor(hash1(row * 70 + n * 3) * 4);
        ctx.beginPath();
        if (kind === 0) {
          ctx.moveTo(x, y0);
          ctx.lineTo(x, y0 + 46);
        } else if (kind === 1) {
          ctx.moveTo(x, y0 + 46);
          ctx.lineTo(x + w * 0.5, y0);
          ctx.lineTo(x + w, y0 + 46);
        } else if (kind === 2) {
          ctx.moveTo(x, y0);
          ctx.lineTo(x + w, y0);
          ctx.lineTo(x + w, y0 + 46);
          ctx.lineTo(x, y0 + 46);
        } else {
          ctx.arc(x + w / 2, y0 + 23, 22, 0, Math.PI * 2);
        }
        ctx.stroke();
        x += w + 14;
        n += 1;
      }
    }
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, N - 12, N - 12);
  },
  solar: (ctx) => {
    paintPixels(ctx, (u, v, x, y, o) => {
      const sheen = 0.5 + 0.5 * Math.sin((u + v) * 5);
      let k = 1;
      if (x % 32 < 2 || y % 32 < 2) k = 1.9;
      if (x % 128 < 4 || y % 128 < 4) k = 3.2;
      o[0] = (20 + sheen * 12) * k;
      o[1] = (40 + sheen * 18) * k;
      o[2] = (88 + sheen * 30) * k;
    });
  },
  leaf: (ctx) => {
    paintPixels(ctx, (u, v, x, y, o) => {
      const k = 0.78 + (tfbm(u, v, 5, 23, 4) - 0.5) * 0.5 + (hash2(x, y, 24) - 0.5) * 0.12;
      o[0] = 255 * k;
      o[1] = 255 * k;
      o[2] = 255 * k;
    });
    speckle(ctx, 200, 5, (x, y) => (hash2(x | 0, y | 0, 9) > 0.5 ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.2)'), 1, 3);
  },
  flat: (ctx) => {
    paintPixels(ctx, (u, v, x, y, o) => {
      const k = 0.97 + (hash2(x, y, 60) - 0.5) * 0.04 + (tfbm(u, v, 2, 6, 3) - 0.5) * 0.04;
      o[0] = 255 * k;
      o[1] = 255 * k;
      o[2] = 255 * k;
    });
  },
};

const cache = new Map<string, WorldTextures>();

/** Build (or fetch) the biome's texture array. Generated once per biome. */
export function getWorldTextures(biome: BiomeDef, anisotropy: number): WorldTextures {
  const hit = cache.get(biome.id);
  if (hit) {
    hit.array.anisotropy = anisotropy;
    return hit;
  }
  const data = new Uint8Array(N * N * 4 * LAYER_COUNT);
  const { canvas, ctx } = makeCanvas();
  const names = Object.keys(LAYER) as LayerName[];
  for (const name of names) {
    ctx.clearRect(0, 0, N, N);
    PAINTERS[name](ctx, biome);
    const img = ctx.getImageData(0, 0, N, N);
    data.set(img.data, LAYER[name] * N * N * 4);
  }
  canvas.width = 1;
  const array = new DataArrayTexture(data, N, N, LAYER_COUNT);
  array.wrapS = RepeatWrapping;
  array.wrapT = RepeatWrapping;
  array.minFilter = LinearMipmapLinearFilter;
  array.magFilter = LinearFilter;
  array.generateMipmaps = true;
  array.colorSpace = SRGBColorSpace;
  array.anisotropy = anisotropy;
  array.needsUpdate = true;

  const dummy = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  dummy.colorSpace = SRGBColorSpace;
  dummy.needsUpdate = true;

  const waterNormal = makeWaterNormal();
  const tex: WorldTextures = {
    array,
    waterNormal,
    dummy,
    dispose() {
      array.dispose();
      dummy.dispose();
      waterNormal.dispose();
    },
  };
  cache.set(biome.id, tex);
  return tex;
}

export function disposeTextureCache(): void {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}

function makeWaterNormal(): DataTexture {
  const size = 128;
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      h[y * size + x] = tfbm(u, v, 4, 3, 4) + 0.5 * tfbm(u, v, 9, 8, 2);
    }
  }
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const l = h[y * size + ((x - 1 + size) % size)];
      const r = h[y * size + ((x + 1) % size)];
      const t = h[((y - 1 + size) % size) * size + x];
      const bt = h[((y + 1) % size) * size + x];
      let nx = (l - r) * 5;
      let ny = (t - bt) * 5;
      let nz = 1;
      const nl = Math.hypot(nx, ny, nz);
      nx /= nl;
      ny /= nl;
      nz /= nl;
      const o = (y * size + x) * 4;
      d[o] = (nx * 0.5 + 0.5) * 255;
      d[o + 1] = (ny * 0.5 + 0.5) * 255;
      d[o + 2] = (nz * 0.5 + 0.5) * 255;
      d[o + 3] = 255;
    }
  }
  const t = new DataTexture(d, size, size);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = NoColorSpace;
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------ sprites

export interface SpriteTextures {
  soft: CanvasTexture;
  flash: CanvasTexture;
  smoke: CanvasTexture;
  ring: CanvasTexture;
  streak: CanvasTexture;
  spark: CanvasTexture;
  dispose(): void;
}

function spriteCanvas(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  draw(ctx, size);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = ClampToEdgeWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  return t;
}

/** Procedural particle sprites shared by weather, muzzle flash and explosions. */
export function makeSpriteTextures(): SpriteTextures {
  const soft = spriteCanvas(64, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
  const flash = spriteCanvas(128, (ctx, s) => {
    ctx.translate(s / 2, s / 2);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,230,160,0.9)');
    g.addColorStop(1, 'rgba(255,140,40,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.fillStyle = 'rgba(255,240,190,0.95)';
    for (let i = 0; i < 6; i += 1) {
      ctx.save();
      ctx.rotate((i / 6) * Math.PI * 2 + 0.2);
      ctx.beginPath();
      ctx.moveTo(0, -3);
      ctx.lineTo(s * 0.48, 0);
      ctx.lineTo(0, 3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  });
  const smoke = spriteCanvas(128, (ctx, s) => {
    for (let i = 0; i < 9; i += 1) {
      const a = hash1(i * 3) * Math.PI * 2;
      const r = hash1(i * 3 + 1) * s * 0.2;
      const x = s / 2 + Math.cos(a) * r;
      const y = s / 2 + Math.sin(a) * r;
      const g = ctx.createRadialGradient(x, y, 0, x, y, s * (0.22 + hash1(i) * 0.14));
      g.addColorStop(0, 'rgba(255,255,255,0.5)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }
  });
  const ring = spriteCanvas(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.32, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
  const streak = spriteCanvas(64, (ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, s, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.75, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, s / 2);
    ctx.lineTo(s, s / 2 - 5);
    ctx.lineTo(s, s / 2 + 5);
    ctx.closePath();
    ctx.fill();
  });
  const spark = spriteCanvas(32, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
  const all: Texture[] = [soft, flash, smoke, ring, streak, spark];
  return {
    soft,
    flash,
    smoke,
    ring,
    streak,
    spark,
    dispose() {
      for (const t of all) t.dispose();
    },
  };
}
