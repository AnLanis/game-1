import { Difficulties } from '../content';
import { defaultInputSettings, sanitizeInputSettings, type InputSettings } from '../input/Input';

export type QualityLevel = 'auto' | 'low' | 'medium' | 'high' | 'ultra';
export type ColorblindMode = 'off' | 'protan' | 'deutan' | 'tritan';
export type CrosshairStyle = 'cross' | 'dot' | 'circle';

export const QUALITY_LEVELS: readonly QualityLevel[] = ['auto', 'low', 'medium', 'high', 'ultra'];
export const COLORBLIND_MODES: readonly ColorblindMode[] = ['off', 'protan', 'deutan', 'tritan'];
export const CROSSHAIR_STYLES: readonly CrosshairStyle[] = ['cross', 'dot', 'circle'];

export interface VolumeSettings {
  master: number;
  sfx: number;
  music: number;
  ui: number;
}

export interface GameSettings {
  input: InputSettings;
  /** Vertical field of view in degrees (hip). */
  fov: number;
  quality: QualityLevel;
  /** Internal resolution scale 0.5..1 (1 = full / auto). */
  renderScale: number;
  reducedMotion: boolean;
  /** 0..1 camera shake amount. */
  shake: number;
  /** 0..1 head bob / weapon sway amount. */
  headBob: number;
  damageNumbers: boolean;
  hitmarkers: boolean;
  colorblind: ColorblindMode;
  highContrastEnemies: boolean;
  subtitles: boolean;
  /** 0.75..1.5 HUD scale multiplier. */
  hudScale: number;
  crosshair: CrosshairStyle;
  /** CSS colour, #rgb / #rrggbb / #rrggbbaa. */
  crosshairColor: string;
  volumes: VolumeSettings;
  fpsCounter: boolean;
  /**
   * Last selected difficulty id (registry id in content Difficulties).
   * Also the destination of the migrated v1 campaign difficulty.
   */
  difficulty: string;
}

/** Slider ranges for settings UIs (min, max). */
export const SETTINGS_RANGES = {
  fov: [65, 110],
  renderScale: [0.5, 1],
  shake: [0, 1],
  headBob: [0, 1],
  hudScale: [0.75, 1.5],
  volume: [0, 1],
  sensitivity: [0.05, 6],
  adsSensitivity: [0.3, 1.5],
  touchSensitivity: [0.2, 3],
  gamepadSensitivity: [0.2, 3],
  aimAssist: [0, 1],
} as const;

export const DEFAULT_DIFFICULTY = 'regular';

export const DEFAULT_SETTINGS: GameSettings = {
  input: defaultInputSettings(),
  fov: 80,
  quality: 'auto',
  renderScale: 1,
  reducedMotion: false,
  shake: 1,
  headBob: 1,
  damageNumbers: true,
  hitmarkers: true,
  colorblind: 'off',
  highContrastEnemies: false,
  subtitles: true,
  hudScale: 1,
  crosshair: 'cross',
  crosshairColor: '#ffffff',
  volumes: { master: 0.8, sfx: 1, music: 0.6, ui: 0.8 },
  fpsCounter: false,
  difficulty: DEFAULT_DIFFICULTY,
};

/** Deep copy of DEFAULT_SETTINGS (never hand out the shared constant to mutate). */
export const defaultSettings = (): GameSettings => ({
  ...DEFAULT_SETTINGS,
  input: defaultInputSettings(),
  volumes: { ...DEFAULT_SETTINGS.volumes },
});

export const cloneSettings = (s: GameSettings): GameSettings => ({
  ...s,
  input: { ...s.input, bindings: Object.fromEntries(Object.entries(s.input.bindings).map(([k, v]) => [k, [...v]])) as InputSettings['bindings'] },
  volumes: { ...s.volumes },
});

const num = (v: unknown, def: number, [lo, hi]: readonly [number, number]): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
const bool = (v: unknown, def: boolean): boolean => (typeof v === 'boolean' ? v : def);
const pick = <T extends string>(v: unknown, allowed: readonly T[], def: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : def;

const COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Coerce arbitrary data (old saves, hand-edited JSON) into a valid GameSettings; unknown keys are dropped. */
export function sanitizeSettings(raw: unknown): GameSettings {
  const d = DEFAULT_SETTINGS;
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const vol = (r.volumes && typeof r.volumes === 'object' ? r.volumes : {}) as Record<string, unknown>;
  const R = SETTINGS_RANGES;
  return {
    input: sanitizeInputSettings(r.input),
    fov: Math.round(num(r.fov, d.fov, R.fov)),
    quality: pick(r.quality, QUALITY_LEVELS, d.quality),
    renderScale: num(r.renderScale, d.renderScale, R.renderScale),
    reducedMotion: bool(r.reducedMotion, d.reducedMotion),
    shake: num(r.shake, d.shake, R.shake),
    headBob: num(r.headBob, d.headBob, R.headBob),
    damageNumbers: bool(r.damageNumbers, d.damageNumbers),
    hitmarkers: bool(r.hitmarkers, d.hitmarkers),
    colorblind: pick(r.colorblind, COLORBLIND_MODES, d.colorblind),
    highContrastEnemies: bool(r.highContrastEnemies, d.highContrastEnemies),
    subtitles: bool(r.subtitles, d.subtitles),
    hudScale: num(r.hudScale, d.hudScale, R.hudScale),
    crosshair: pick(r.crosshair, CROSSHAIR_STYLES, d.crosshair),
    crosshairColor: typeof r.crosshairColor === 'string' && COLOR_RE.test(r.crosshairColor) ? r.crosshairColor : d.crosshairColor,
    volumes: {
      master: num(vol.master, d.volumes.master, R.volume),
      sfx: num(vol.sfx, d.volumes.sfx, R.volume),
      music: num(vol.music, d.volumes.music, R.volume),
      ui: num(vol.ui, d.volumes.ui, R.volume),
    },
    fpsCounter: bool(r.fpsCounter, d.fpsCounter),
    difficulty: typeof r.difficulty === 'string' && Difficulties.has(r.difficulty) ? r.difficulty : d.difficulty,
  };
}

/** Reduced motion is a master switch over shake / bob (effective 0..1 amounts for the renderer). */
export const effectiveShake = (s: GameSettings): number => (s.reducedMotion ? 0 : s.shake);
export const effectiveHeadBob = (s: GameSettings): number => (s.reducedMotion ? 0 : s.headBob);
