/** Wordle-style share text for Daily Op results. */

export const DEFAULT_SHARE_URL = 'dustyduty.game';

export interface DailyShareInput {
  /** Daily number (`dailySeed(date).dayNumber`). */
  dayNumber: number;
  /** 0..3 */
  stars: number;
  /** Seconds. */
  time: number;
  /** 0..1 */
  accuracy: number;
  kills: number;
}

/** m:ss (hours roll into minutes: 75 min -> 75:00). */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const starString = (stars: number, total = 3): string => {
  const n = Math.max(0, Math.min(total, Math.floor(stars)));
  return '★'.repeat(n) + '☆'.repeat(total - n);
};

/**
 * e.g.
 *   Dusty Duty Daily #273 ★★☆
 *   ⏱ 3:12 · 🎯 41% · 💀 18
 *   dustyduty.game
 */
export function dailyShareText(r: DailyShareInput, url: string = DEFAULT_SHARE_URL): string {
  const acc = Math.round(Math.max(0, Math.min(1, Number.isFinite(r.accuracy) ? r.accuracy : 0)) * 100);
  const lines = [
    `Dusty Duty Daily #${Math.floor(r.dayNumber)} ${starString(r.stars)}`,
    `⏱ ${formatTime(r.time)} · 🎯 ${acc}% · 💀 ${Math.max(0, Math.floor(r.kills))}`,
  ];
  if (url) lines.push(url);
  return lines.join('\n');
}

export type ShareOutcome = 'shared' | 'copied' | 'failed';

/** Native share sheet if available, else clipboard. Never throws. */
export async function shareText(text: string): Promise<ShareOutcome> {
  try {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav && typeof nav.share === 'function') {
      try {
        await nav.share({ text });
        return 'shared';
      } catch (e) {
        // User cancelled the sheet: not a failure worth a fallback copy.
        if ((e as { name?: string })?.name === 'AbortError') return 'failed';
      }
    }
    if (nav?.clipboard && typeof nav.clipboard.writeText === 'function') {
      await nav.clipboard.writeText(text);
      return 'copied';
    }
  } catch {
    /* fall through */
  }
  return 'failed';
}
