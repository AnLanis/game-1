/** Allocation-free math helpers shared by sim and presentation. */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Vec2 {
  x: number;
  z: number;
}

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number): number => (b === a ? 0 : (v - a) / (b - a));

/** Frame-rate independent exponential smoothing toward a target. */
export const damp = (current: number, target: number, lambda: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

export const approach = (current: number, target: number, maxDelta: number): number =>
  current < target ? Math.min(target, current + maxDelta) : Math.max(target, current - maxDelta);

/** Wrap angle into (-PI, PI]. */
export const wrapAngle = (a: number): number => {
  let r = a % TAU;
  if (r > Math.PI) r -= TAU;
  else if (r <= -Math.PI) r += TAU;
  return r;
};

export const angleDiff = (from: number, to: number): number => wrapAngle(to - from);

export const dampAngle = (current: number, target: number, lambda: number, dt: number): number =>
  current + angleDiff(current, target) * (1 - Math.exp(-lambda * dt));

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const copy3 = (out: Vec3, a: Vec3): Vec3 => {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  return out;
};
export const set3 = (out: Vec3, x: number, y: number, z: number): Vec3 => {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
};
export const dist2D = (ax: number, az: number, bx: number, bz: number): number => Math.hypot(bx - ax, bz - az);
export const dist3 = (a: Vec3, b: Vec3): number => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
export const len3 = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const normalize3 = (a: Vec3): Vec3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  a.x /= l;
  a.y /= l;
  a.z /= l;
  return a;
};

/**
 * Yaw/pitch convention (matches a Three.js camera with rotation order YXZ):
 * yaw 0 looks toward -Z, positive yaw turns left (counter-clockwise from above),
 * positive pitch looks up.
 */
export const dirFromYawPitch = (yaw: number, pitch: number, out: Vec3): Vec3 => {
  const cp = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cp;
  return out;
};

/** Yaw that faces from (ax,az) toward (bx,bz). */
export const yawTo = (ax: number, az: number, bx: number, bz: number): number => Math.atan2(-(bx - ax), -(bz - az));

export const pitchTo = (from: Vec3, to: Vec3): number =>
  Math.atan2(to.y - from.y, Math.hypot(to.x - from.x, to.z - from.z));

/** Sample a direction uniformly within a cone of half-angle `spread` around (yaw, pitch). */
export const coneDirection = (
  yaw: number,
  pitch: number,
  spread: number,
  u1: number,
  u2: number,
  out: Vec3,
): Vec3 => {
  const r = spread * Math.sqrt(u1);
  const theta = u2 * TAU;
  return dirFromYawPitch(yaw + (Math.cos(theta) * r) / Math.max(0.2, Math.cos(pitch)), pitch + Math.sin(theta) * r, out);
};

/** Quantize to fixed point for hashing/snapshots. */
export const q = (v: number, scale = 1000): number => Math.round(v * scale);
