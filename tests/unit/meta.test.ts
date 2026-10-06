import { describe, expect, it } from 'vitest';
import { Attachments, Campaign, PLAYER_WEAPONS } from '../../src/content';
import { dailySeed } from '../../src/engine/rng';
import { ACTION_IDS, DEFAULT_BINDINGS, formatBinding, radialDeadzone, sanitizeInputSettings } from '../../src/input/Input';
import {
  challengeStatus,
  dailyChallenges,
  touchStreak,
  updateChallenges,
} from '../../src/meta/challenges';
import {
  applyMissionResult,
  computeStars,
  levelFromXp,
  MAX_LEVEL,
  type MissionResult,
  sanitizeLoadout,
  unlockedAttachments,
  unlockedPerks,
  unlockedWeapons,
  weaponLevelFromXp,
  weaponXpForLevel,
  xpForLevel,
  xpMultiplier,
} from '../../src/meta/progression';
import {
  LEGACY_SAVE_KEY,
  migrateSave,
  newSave,
  SAVE_KEY,
  SAVE_VERSION,
  SaveStore,
  type StorageLike,
} from '../../src/meta/save';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../../src/meta/settings';
import { dailyShareText, formatTime } from '../../src/meta/share';
import { detectPortal, NullPortal } from '../../src/platform/portal';
import { FrameStats, QualityGovernor } from '../../src/platform/telemetry';

class MemStorage implements StorageLike {
  readonly map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

const result = (over: Partial<MissionResult> = {}): MissionResult => ({
  mode: 'campaign',
  recordKey: 'op-market-sweep',
  opId: 'op-market-sweep',
  success: true,
  time: 200,
  parTime: 240,
  kills: 20,
  headshots: 8,
  accuracy: 0.4,
  shots: 100,
  hits: 40,
  damageTaken: 30,
  score: 12000,
  xp: 1000,
  medals: {},
  stars: 2,
  weaponUsage: {},
  difficultyId: 'regular',
  modifiers: [],
  ...over,
});

describe('save migration', () => {
  it('migrates the original v1 campaign save', () => {
    const v1 = JSON.stringify({ unlocked: ['market', 'fields'], bestStars: { market: 3, fields: 1 }, difficulty: 'veteran' });
    const save = migrateSave(JSON.parse(v1));
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.campaign.stars).toEqual({ 'op-market-sweep': 3, 'op-orchard-run': 1 });
    expect(save.campaign.unlockedIndex).toBe(Campaign.indexOf('op-orchard-run'));
    expect(save.settings.difficulty).toBe('veteran');
    expect(save.profile.level).toBe(1);
  });

  it('maps mountain and the other difficulties', () => {
    const a = migrateSave({ unlocked: ['market', 'fields', 'mountain'], bestStars: { mountain: 2 }, difficulty: 'dust' });
    expect(a.campaign.stars).toEqual({ 'op-ridge-push': 2 });
    expect(a.campaign.unlockedIndex).toBe(Campaign.indexOf('op-ridge-push'));
    expect(a.settings.difficulty).toBe('dust');
    expect(migrateSave({ unlocked: ['market'], bestStars: {}, difficulty: 'recruit' }).settings.difficulty).toBe('recruit');
    expect(migrateSave({ unlocked: ['market'], bestStars: {}, difficulty: 'bogus' }).settings.difficulty).toBe('regular');
  });

  it('loads the legacy key through SaveStore and writes v2', () => {
    const storage = new MemStorage();
    storage.setItem(LEGACY_SAVE_KEY, JSON.stringify({ unlocked: ['market', 'fields'], bestStars: { market: 2 }, difficulty: 'dust' }));
    const store = new SaveStore(() => storage);
    const save = store.load();
    expect(save.campaign.stars['op-market-sweep']).toBe(2);
    expect(save.settings.difficulty).toBe('dust');
    const persisted = JSON.parse(storage.getItem(SAVE_KEY) ?? 'null');
    expect(persisted.version).toBe(2);
    // A second boot reads v2, not the legacy key.
    storage.setItem(LEGACY_SAVE_KEY, '{}');
    expect(new SaveStore(() => storage).load().campaign.stars['op-market-sweep']).toBe(2);
  });

  it('survives corrupt data, hostile keys and unavailable storage', () => {
    const storage = new MemStorage();
    storage.setItem(SAVE_KEY, '{not json');
    expect(new SaveStore(() => storage).load().version).toBe(SAVE_VERSION);
    expect(storage.getItem('dusty-duty-save-v2-backup')).toBe('{not json');

    const hostile = migrateSave(JSON.parse('{"version":2,"medals":{"__proto__":5,"double":2},"profile":{"xp":"lots"}}'));
    expect(hostile.medals).toEqual({ double: 2 });
    expect(hostile.profile.xp).toBe(0);

    const broken: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    const store = new SaveStore(() => broken);
    store.update((s) => {
      s.profile.callsign = 'Ghost';
    });
    expect(store.get().profile.callsign).toBe('Ghost');
    expect(store.persistent).toBe(false);
    expect(new SaveStore(() => null).get().version).toBe(SAVE_VERSION);
  });

  it('round-trips a v2 save unchanged', () => {
    const storage = new MemStorage();
    const store = new SaveStore(() => storage);
    const s = newSave();
    s.profile.xp = 5000;
    s.weapons.carbine = { xp: 700, kills: 7, headshots: 2 };
    s.records.daily['2026-09-30'] = { score: 5, stars: 2, time: 100 };
    store.set(s);
    const again = new SaveStore(() => storage).load();
    expect(again.weapons.carbine).toEqual({ xp: 700, kills: 7, headshots: 2 });
    expect(again.records.daily['2026-09-30']).toEqual({ score: 5, stars: 2, time: 100 });
    expect(again.profile.level).toBe(levelFromXp(5000));
  });
});

describe('progression curve', () => {
  it('level 2 needs about 900 XP and the curve is strictly monotonic', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(900);
    for (let n = 2; n <= MAX_LEVEL; n += 1) expect(xpForLevel(n)).toBeGreaterThan(xpForLevel(n - 1));
    expect(xpForLevel(MAX_LEVEL + 10)).toBe(xpForLevel(MAX_LEVEL));
  });

  it('levelFromXp inverts xpForLevel and caps at the max level', () => {
    for (let n = 1; n <= MAX_LEVEL; n += 1) {
      expect(levelFromXp(xpForLevel(n))).toBe(n);
      if (n > 1) expect(levelFromXp(xpForLevel(n) - 1)).toBe(n - 1);
    }
    expect(levelFromXp(-5)).toBe(1);
    expect(levelFromXp(1e12)).toBe(MAX_LEVEL);
  });

  it('weapon mastery gates attachments by AttachmentDef.mastery', () => {
    expect(weaponLevelFromXp(0)).toBe(1);
    expect(weaponLevelFromXp(weaponXpForLevel(4))).toBe(4);
    const carbine = (lvl: number) => unlockedAttachments('carbine', lvl).map((a) => a.id);
    expect(carbine(1)).toContain('reflex');
    expect(carbine(1)).not.toContain('compensator');
    expect(carbine(2)).toContain('compensator');
    for (const a of unlockedAttachments('carbine', 10)) expect(a.classes).toContain('rifle');
    expect(unlockedAttachments('nope', 10)).toEqual([]);
  });

  it('unlocks weapons and perks by level', () => {
    expect(unlockedWeapons(1).map((w) => w.id)).toEqual(expect.arrayContaining(['carbine', 'sidearm']));
    expect(unlockedWeapons(1).length).toBeLessThan(PLAYER_WEAPONS.length);
    expect(unlockedWeapons(99)).toHaveLength(PLAYER_WEAPONS.length);
    expect(unlockedPerks(1).map((p) => p.id)).toEqual(['quickhands']);
    expect(unlockedPerks(99).length).toBeGreaterThan(1);
  });
});

describe('stars', () => {
  const op = { parTime: 240, bonus: { kind: 'headshots' as const, target: 8 } };
  it('awards 0 for a loss and 1 for a slow win', () => {
    expect(computeStars({ success: false, time: 10 }, op)).toBe(0);
    expect(computeStars({ success: true, time: 300, headshots: 20 }, op)).toBe(1);
  });
  it('awards 2 under par and 3 under par with the bonus', () => {
    expect(computeStars({ success: true, time: 200, headshots: 3 }, op)).toBe(2);
    expect(computeStars({ success: true, time: 200, headshots: 8 }, op)).toBe(3);
  });
  it('evaluates every bonus kind and honours a pre-evaluated flag', () => {
    const base = { success: true, time: 100, parTime: 200 };
    const star = (kind: 'nodamage' | 'accuracy' | 'nocivilians' | 'grenadekills' | 'speed', target: number, extra: object) =>
      computeStars({ ...base, ...extra }, { bonus: { kind, target } });
    expect(star('nodamage', 60, { damageTaken: 59 })).toBe(3);
    expect(star('nodamage', 60, { damageTaken: 60 })).toBe(2);
    expect(star('accuracy', 0.35, { accuracy: 0.36 })).toBe(3);
    expect(star('nocivilians', 0, { civilianKills: 1 })).toBe(2);
    expect(star('nocivilians', 0, {})).toBe(3);
    expect(star('grenadekills', 2, { grenadeKills: 2 })).toBe(3);
    expect(star('speed', 120, { time: 119 })).toBe(3);
    expect(computeStars({ ...base, bonusMet: true }, null)).toBe(3);
    expect(computeStars({ ...base, bonusMet: false }, op)).toBe(2);
  });
  it('falls back to the op par when the result has none', () => {
    expect(computeStars({ success: true, time: 100 }, { parTime: 240 })).toBe(2);
    expect(computeStars({ success: true, time: 100 }, null)).toBe(1);
  });
});

describe('applyMissionResult', () => {
  const date = new Date(Date.UTC(2026, 8, 30, 12));

  it('applies difficulty and modifier XP multipliers', () => {
    expect(xpMultiplier('regular', [])).toBe(1);
    expect(xpMultiplier('dust', [])).toBeCloseTo(1.7);
    expect(xpMultiplier('veteran', ['armored', 'lowgrav'])).toBeCloseTo(1.3 * 1.25);
    expect(xpMultiplier('unknown', ['unknown'])).toBe(1);
  });

  it('awards XP, levels, unlocks and does not mutate the input save', () => {
    const before = newSave();
    const snapshot = JSON.stringify(before);
    const out = applyMissionResult(before, result({ xp: 5000, difficultyId: 'veteran' }), date);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(out.missionXp).toBe(6500);
    expect(out.save.profile.xp).toBe(out.xpGained);
    expect(out.save.profile.level).toBe(levelFromXp(out.xpGained));
    expect(out.levelUps).toEqual(Array.from({ length: out.save.profile.level - 1 }, (_, i) => i + 2));
    expect(out.unlocks.some((u) => u.includes('Weapon unlocked: Viper'))).toBe(true);
    expect(out.save.stats.missions).toBe(1);
  });

  it('records campaign stars/best times and unlocks the next op', () => {
    const a = applyMissionResult(newSave(), result({ stars: 2, time: 200 }), date);
    expect(a.newBest).toBe(true);
    expect(a.save.campaign.stars['op-market-sweep']).toBe(2);
    expect(a.save.campaign.bestTimes['op-market-sweep']).toBe(200);
    expect(a.save.campaign.unlockedIndex).toBe(1);
    expect(a.unlocks.some((u) => u.startsWith('Operation unlocked'))).toBe(true);

    const worse = applyMissionResult(a.save, result({ stars: 1, time: 230 }), date);
    expect(worse.newBest).toBe(false);
    expect(worse.save.campaign.stars['op-market-sweep']).toBe(2);
    expect(worse.save.campaign.bestTimes['op-market-sweep']).toBe(200);
    const faster = applyMissionResult(worse.save, result({ stars: 2, time: 150 }), date);
    expect(faster.newBest).toBe(true);
    expect(faster.save.campaign.bestTimes['op-market-sweep']).toBe(150);
  });

  it('does not unlock on failure and counts a death', () => {
    const out = applyMissionResult(newSave(), result({ success: false, stars: 0 }), date);
    expect(out.save.campaign.unlockedIndex).toBe(0);
    expect(out.save.stats.deaths).toBe(1);
  });

  it('tracks weapon mastery and announces attachment unlocks', () => {
    const out = applyMissionResult(newSave(), result({ weaponUsage: { carbine: { kills: 10, headshots: 4 }, ai_rifle: { kills: 99, headshots: 0 } } }), date);
    const w = out.save.weapons.carbine;
    expect(w).toEqual({ xp: 10 * 100 + 4 * 50, kills: 10, headshots: 4 });
    expect(out.save.weapons.ai_rifle).toBeUndefined();
    const expected = Attachments.all().filter((a) => a.mastery > 1 && a.mastery <= weaponLevelFromXp(w.xp) && a.classes.includes('rifle'));
    for (const a of expected) expect(out.unlocks.some((u) => u.includes(a.name))).toBe(true);
  });

  it('records daily, last stand and contract bests', () => {
    let s = applyMissionResult(newSave(), result({ mode: 'daily', recordKey: '2026-09-30', opId: undefined, score: 100, stars: 2, time: 90 }), date).save;
    expect(s.records.daily['2026-09-30']).toEqual({ score: 100, stars: 2, time: 90 });
    const lower = applyMissionResult(s, result({ mode: 'daily', recordKey: '2026-09-30', opId: undefined, score: 50 }), date);
    expect(lower.newBest).toBe(false);
    s = applyMissionResult(s, result({ mode: 'laststand', recordKey: 'market', opId: undefined, wave: 6, score: 900, success: false }), date).save;
    expect(s.records.lastStand.market).toEqual({ wave: 6, score: 900 });
    s = applyMissionResult(s, result({ mode: 'contract', recordKey: 'c1', opId: undefined, score: 700 }), date).save;
    expect(s.records.contracts.c1).toEqual({ score: 700 });
  });

  it('demotes a locked loadout back to what is unlocked', () => {
    const save = newSave();
    save.loadout.primary = 'ranger';
    save.loadout.perk = 'medic';
    save.loadout.primaryAtt = ['acog'];
    const l = sanitizeLoadout(save);
    expect(l.primary).toBe('carbine');
    expect(l.perk).toBe('quickhands');
    expect(l.primaryAtt).toEqual([]);
  });
});

describe('daily challenges', () => {
  const d1 = new Date(Date.UTC(2026, 8, 30, 3));
  const d1b = new Date(Date.UTC(2026, 8, 30, 22));

  it('is deterministic per UTC date and has one challenge per tier', () => {
    const a = dailyChallenges(d1);
    expect(a).toEqual(dailyChallenges(d1b));
    expect(a).toHaveLength(3);
    expect(a.map((c) => c.tier)).toEqual([0, 1, 2]);
    expect(new Set(a.map((c) => c.id)).size).toBe(3);
    for (const c of a) {
      expect(c.title.length).toBeGreaterThan(5);
      expect(c.target).toBeGreaterThan(0);
      expect(c.xp).toBeGreaterThan(0);
    }
  });

  it('varies from day to day', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 30; i += 1) {
      seen.add(
        dailyChallenges(new Date(Date.UTC(2026, 8, 1 + i)))
          .map((c) => c.title)
          .join('|'),
      );
    }
    expect(seen.size).toBeGreaterThan(15);
  });

  it('accumulates progress, pays out once, and resets on a new day', () => {
    const date = d1;
    const defs = dailyChallenges(date);
    let state = newSave().challenges;
    // A run that satisfies every measurable metric at once.
    const big = result({
      kills: 500,
      headshots: 500,
      accuracy: 0.9,
      damageTaken: 0,
      stars: 3,
      difficultyId: 'dust',
      wave: 50,
      mode: 'laststand',
      medals: { double: 10, grenade: 10, pointblank: 10, streak5: 3 },
      weaponUsage: { viper: { kills: 500, headshots: 0 } },
    });
    const won = { ...big, mode: 'campaign' as const };
    const u1 = updateChallenges(state, big, date);
    const u2 = updateChallenges(u1.state, won, date);
    const completed = [...u1.completed, ...u2.completed];
    expect(new Set(completed.map((c) => c.id)).size).toBe(completed.length);
    expect(completed.length).toBe(3);
    expect(u1.xp + u2.xp).toBe(defs.reduce((n, c) => n + c.xp, 0));
    state = u2.state;
    expect(state.claimed.sort()).toEqual(defs.map((c) => c.id).sort());
    // Nothing more to pay today.
    expect(updateChallenges(state, won, date).xp).toBe(0);
    expect(challengeStatus(state, date).every((s) => s.done && s.claimed)).toBe(true);
    // Next day: stale progress is ignored and the state rolls over.
    const tomorrow = new Date(Date.UTC(2026, 9, 1, 1));
    expect(challengeStatus(state, tomorrow).every((s) => s.progress === 0 && !s.claimed)).toBe(true);
    const rolled = updateChallenges(state, result({ kills: 1 }), tomorrow);
    expect(rolled.state.dateKey).toBe(dailySeed(tomorrow).key);
  });

  it('tracks a login streak across consecutive UTC days', () => {
    let s = { lastDay: '', days: 0 };
    let u = touchStreak(s, new Date(Date.UTC(2026, 8, 28, 9)));
    expect(u.streak).toEqual({ lastDay: '2026-09-28', days: 1 });
    s = u.streak;
    u = touchStreak(s, new Date(Date.UTC(2026, 8, 28, 23)));
    expect(u.isNewDay).toBe(false);
    expect(u.streak.days).toBe(1);
    u = touchStreak(s, new Date(Date.UTC(2026, 8, 29, 0, 5)));
    expect(u.streak).toEqual({ lastDay: '2026-09-29', days: 2 });
    u = touchStreak(u.streak, new Date(Date.UTC(2026, 8, 30)));
    expect(u.streak.days).toBe(3);
    u = touchStreak(u.streak, new Date(Date.UTC(2026, 9, 3)));
    expect(u.streak.days).toBe(1);
    expect(u.broken).toBe(true);
  });
});

describe('share text', () => {
  it('formats the daily result', () => {
    const n = dailySeed(new Date(Date.UTC(2026, 8, 30))).dayNumber;
    expect(n).toBe(273);
    expect(dailyShareText({ dayNumber: n, stars: 2, time: 192, accuracy: 0.41, kills: 18 })).toBe(
      'Dusty Duty Daily #273 ★★☆\n⏱ 3:12 · 🎯 41% · 💀 18\ndustyduty.game',
    );
  });
  it('accepts a custom url, clamps values and formats time', () => {
    const t = dailyShareText({ dayNumber: 1, stars: 9, time: 5, accuracy: 2, kills: -3 }, 'https://example.com/play');
    expect(t.split('\n')).toEqual([
      'Dusty Duty Daily #1 ★★★',
      '⏱ 0:05 · 🎯 100% · 💀 0',
      'https://example.com/play',
    ]);
    expect(formatTime(3600)).toBe('60:00');
    expect(dailyShareText({ dayNumber: 2, stars: 0, time: 1, accuracy: 0, kills: 0 }, '')).not.toContain('\n\n');
  });
});

describe('settings', () => {
  it('has the documented defaults and clamps hostile values', () => {
    expect(DEFAULT_SETTINGS.fov).toBe(80);
    expect(DEFAULT_SETTINGS.renderScale).toBe(1);
    expect(DEFAULT_SETTINGS.input.sensitivity).toBe(1);
    expect(DEFAULT_SETTINGS.input.adsSensitivity).toBe(0.8);
    const s = sanitizeSettings({
      fov: 500,
      renderScale: 0,
      hudScale: 9,
      shake: -1,
      quality: 'ludicrous',
      colorblind: 'deutan',
      crosshair: 'dot',
      crosshairColor: 'javascript:alert(1)',
      volumes: { master: 5, sfx: 'loud' },
      input: { adsSensitivity: 9, bindings: { jump: ['KeyJ'], fire: 'nope' } },
      difficulty: 'nightmare',
    });
    expect(s.fov).toBe(110);
    expect(s.renderScale).toBe(0.5);
    expect(s.hudScale).toBe(1.5);
    expect(s.shake).toBe(0);
    expect(s.quality).toBe('auto');
    expect(s.colorblind).toBe('deutan');
    expect(s.crosshair).toBe('dot');
    expect(s.crosshairColor).toBe('#ffffff');
    expect(s.volumes.master).toBe(1);
    expect(s.volumes.sfx).toBe(DEFAULT_SETTINGS.volumes.sfx);
    expect(s.input.adsSensitivity).toBe(1.5);
    expect(s.input.bindings.jump).toEqual(['KeyJ']);
    expect(s.input.bindings.fire).toEqual(DEFAULT_BINDINGS.fire);
    expect(s.difficulty).toBe('regular');
  });
});

describe('input helpers', () => {
  it('applies a radial deadzone with rescale', () => {
    const out = { x: 0, y: 0 };
    radialDeadzone(0.1, 0.1, 0.15, out);
    expect(out).toEqual({ x: 0, y: 0 });
    radialDeadzone(1, 0, 0.15, out);
    expect(out.x).toBeCloseTo(1);
    radialDeadzone(0.575, 0, 0.15, out);
    expect(out.x).toBeCloseTo(0.5);
    radialDeadzone(0.7, 0.7, 0.15, out);
    expect(Math.hypot(out.x, out.y)).toBeLessThanOrEqual(1);
  });
  it('has a binding for every action and formats them', () => {
    for (const id of ACTION_IDS) expect(DEFAULT_BINDINGS[id].length).toBeGreaterThan(0);
    expect(sanitizeInputSettings(null).bindings.forward).toEqual(['KeyW', 'ArrowUp']);
    expect(formatBinding('KeyW')).toBe('W');
    expect(formatBinding('Mouse2')).toBe('Right Click');
    expect(formatBinding('Digit1')).toBe('1');
  });
});

describe('platform', () => {
  it('defaults to a null portal that never blocks', async () => {
    const p = detectPortal({});
    expect(p).toBeInstanceOf(NullPortal);
    await p.init();
    await p.commercialBreak();
    expect(await p.rewardedBreak()).toBe(false);
  });

  it('wraps the Poki SDK idempotently and survives SDK errors', async () => {
    const calls: string[] = [];
    const sdk = {
      init: async () => void calls.push('init'),
      gameLoadingFinished: () => void calls.push('loaded'),
      gameplayStart: () => void calls.push('start'),
      gameplayStop: () => void calls.push('stop'),
      commercialBreak: async () => void calls.push('ad'),
      rewardedBreak: async () => true,
    };
    const p = detectPortal({ PokiSDK: sdk });
    expect(p.name).toBe('poki');
    const hooks: string[] = [];
    p.onAdStart = () => hooks.push('mute');
    p.onAdEnd = () => hooks.push('unmute');
    await p.init();
    p.loadingStart();
    p.loadingDone();
    p.gameplayStart();
    p.gameplayStart();
    await p.commercialBreak();
    expect(calls).toEqual(['init', 'loaded', 'start', 'stop', 'ad']);
    expect(hooks).toEqual(['mute', 'unmute']);
    expect(await p.rewardedBreak()).toBe(true);

    const angry = detectPortal({
      PokiSDK: {
        ...sdk,
        gameplayStart: () => {
          throw new Error('boom');
        },
        commercialBreak: async () => {
          throw new Error('adblock');
        },
      },
    });
    expect(() => angry.gameplayStart()).not.toThrow();
    await expect(angry.commercialBreak()).resolves.toBeUndefined();
  });

  it('wraps the CrazyGames SDK ad callbacks', async () => {
    const sdk = {
      init: async () => undefined,
      game: { gameplayStart: () => undefined, gameplayStop: () => undefined },
      ad: {
        requestAd: (type: string, cb: { adFinished?: () => void; adError?: (e: unknown) => void }) => {
          if (type === 'rewarded') cb.adFinished?.();
          else cb.adError?.('none');
        },
      },
    };
    const p = detectPortal({ CrazyGames: { SDK: sdk } });
    expect(p.name).toBe('crazygames');
    expect(await p.rewardedBreak()).toBe(true);
    await expect(p.commercialBreak()).resolves.toBeUndefined();
  });

  it('computes EMA, fps and p95 over a rolling window, ignoring outliers', () => {
    const fs = new FrameStats(100, 0.1);
    for (let i = 0; i < 100; i += 1) fs.push(i % 20 === 0 ? 0.04 : 0.01);
    expect(fs.samples).toBe(100);
    expect(fs.p95Ms).toBeCloseTo(10, 0);
    expect(fs.percentile(1)).toBeCloseTo(40, 0);
    expect(fs.emaMs).toBeGreaterThan(9);
    expect(fs.fps).toBeGreaterThan(20);
    fs.push(5); // tab was hidden
    expect(fs.hitches).toBe(1);
    expect(fs.samples).toBe(100);
    for (let i = 0; i < 100; i += 1) fs.push(0.03);
    expect(fs.p95Ms).toBeCloseTo(30, 0);
    fs.reset();
    expect(fs.p95Ms).toBe(0);
  });

  it('steps quality down under sustained load and back up when it is cheap', () => {
    const stats = new FrameStats(60);
    const gov = new QualityGovernor(stats, { warmup: 0.5, cooldown: 1, downAfter: 0.5, upAfter: 2 });
    const run = (dt: number, seconds: number): number[] => {
      const steps: number[] = [];
      for (let t = 0; t < seconds; t += dt) {
        stats.push(dt);
        const r = gov.update(dt);
        if (r !== 0) steps.push(r);
      }
      return steps;
    };
    expect(run(0.0167, 1)).toEqual([]);
    expect(run(0.034, 4)[0]).toBe(-1);
    expect(run(0.006, 8)).toContain(1);
  });
});
