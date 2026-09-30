/**
 * Deterministic random numbers. Everything in the simulation draws from an
 * `Rng` so that a (seed, input stream) pair always replays identically — the
 * foundation for daily ops, shareable seeds, replays, bot tests and netcode.
 */

/** cyrb53-style string hash → 32-bit unsigned seed. */
export function hashString(input: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 ^ h1) >>> 0;
}

/** Mix two integers into one seed (for deriving child streams). */
export function mixSeed(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

/** sfc32 — small, fast, 128-bit state, passes PractRand to 1TB. */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number) {
    this.a = 0x9e3779b9;
    this.b = 0x243f6a88;
    this.c = 0xb7e15162;
    this.d = seed >>> 0;
    for (let i = 0; i < 12; i += 1) this.nextU32();
  }

  static fromString(label: string): Rng {
    return new Rng(hashString(label));
  }

  nextU32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  sign(): 1 | -1 {
    return this.next() < 0.5 ? -1 : 1;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick on empty list');
    return items[Math.floor(this.next() * items.length)];
  }

  /** Weighted pick; weights need not sum to 1. */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T {
    let total = 0;
    for (const item of items) total += Math.max(0, weight(item));
    let roll = this.next() * total;
    for (const item of items) {
      roll -= Math.max(0, weight(item));
      if (roll <= 0) return item;
    }
    return items[items.length - 1];
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = items[i];
      items[i] = items[j];
      items[j] = tmp;
    }
    return items;
  }

  /** Approximately normal (Irwin–Hall, n=4), mean 0, sd ~1. */
  gaussian(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.732;
  }

  /** Derive an independent child stream (e.g. per-system) without consuming this one's sequence meaningfully. */
  fork(label: string | number): Rng {
    const salt = typeof label === 'number' ? label : hashString(label);
    return new Rng(mixSeed(this.nextU32(), salt));
  }

  getState(): [number, number, number, number] {
    return [this.a, this.b, this.c, this.d];
  }

  setState(state: readonly [number, number, number, number]): void {
    [this.a, this.b, this.c, this.d] = state;
  }
}

/** Human-shareable seed codes like "DUST-7K2Q". */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function seedToCode(seed: number): string {
  let n = seed >>> 0;
  let out = '';
  for (let i = 0; i < 6; i += 1) {
    out += CODE_ALPHABET[n % CODE_ALPHABET.length];
    n = Math.floor(n / CODE_ALPHABET.length);
  }
  return out;
}

export function codeToSeed(code: string): number {
  const clean = code.toUpperCase().replace(/[^0-9A-Z]/g, '');
  let valid = clean.length > 0;
  for (const ch of clean) if (!CODE_ALPHABET.includes(ch)) valid = false;
  if (!valid || clean.length !== 6) return hashString(clean || 'dusty');
  let n = 0;
  for (let i = clean.length - 1; i >= 0; i -= 1) {
    n = n * CODE_ALPHABET.length + CODE_ALPHABET.indexOf(clean[i]);
  }
  return n >>> 0;
}

/** Stable seed for a UTC calendar day — everyone gets the same Daily Op. */
export function dailySeed(date: Date = new Date()): { seed: number; key: string; dayNumber: number } {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const epoch = Date.UTC(2026, 0, 1);
  const dayNumber = Math.floor((Date.UTC(y, m - 1, d) - epoch) / 86_400_000) + 1;
  return { seed: hashString(`dusty-daily-${key}`), key, dayNumber };
}
