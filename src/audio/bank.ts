/**
 * Turns the pure sample recipes in synth.ts into AudioBuffers. Sounds are rendered lazily, and the
 * whole set is warmed in priority order through time-sliced `warm()` calls, so unlocking audio never
 * blocks a frame for long. Anything asked for before its slot comes up renders on the spot.
 */

import { BANK, BANK_INDEX, renderEntry, type BankEntry } from './synth';

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class SoundBank {
  private readonly store = new Map<string, Array<AudioBuffer | undefined>>();
  private readonly queue: Array<{ e: BankEntry; v: number }> = [];
  private qi = 0;
  /** Total milliseconds spent rendering so far (diagnostics). */
  renderMs = 0;

  constructor(private readonly ctx: BaseAudioContext) {
    // Variant 0 of everything first, so every sound is playable early; extra variations follow.
    let maxV = 0;
    for (const e of BANK) if (!e.lazy) maxV = Math.max(maxV, e.variants);
    for (let v = 0; v < maxV; v++) {
      for (const e of BANK) if (!e.lazy && v < e.variants) this.queue.push({ e, v });
    }
  }

  variants(key: string): number {
    return BANK_INDEX.get(key)?.variants ?? 0;
  }

  /** Buffer for (key, variant); variant wraps. Renders immediately if it has not been rendered yet. */
  get(key: string, variant = 0): AudioBuffer | null {
    const e = BANK_INDEX.get(key);
    if (!e) return null;
    const idx = ((variant % e.variants) + e.variants) % e.variants;
    let arr = this.store.get(key);
    if (!arr) {
      arr = new Array<AudioBuffer | undefined>(e.variants);
      this.store.set(key, arr);
    }
    let b = arr[idx];
    if (!b) {
      const t0 = now();
      const data = renderEntry(e, idx);
      b = this.ctx.createBuffer(1, data.length, e.sr);
      b.getChannelData(0).set(data);
      arr[idx] = b;
      this.renderMs += now() - t0;
    }
    return b;
  }

  /** Render queued sounds until the time budget (ms) is spent. Returns true once everything is warm. */
  warm(budgetMs: number): boolean {
    const t0 = now();
    while (this.qi < this.queue.length && now() - t0 < budgetMs) {
      const { e, v } = this.queue[this.qi++];
      this.get(e.key, v);
    }
    return this.qi >= this.queue.length;
  }

  get pending(): number {
    return this.queue.length - this.qi;
  }
}
