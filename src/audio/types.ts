/** Shared audio types. Re-exported from AudioEngine.ts, which is the public entry point. */

export type SfxId =
  | 'step' | 'land' | 'jump' | 'slide' | 'reloadOut' | 'reloadIn' | 'bolt' | 'dryfire' | 'switch'
  | 'hitmarker' | 'headshot' | 'kill' | 'hurt' | 'heartbeat' | 'explosion' | 'bounce' | 'pin'
  | 'pickup' | 'intel' | 'plant' | 'beep' | 'objective' | 'uiClick' | 'uiHover' | 'uiConfirm'
  | 'uiBack' | 'radio' | 'crack' | 'ricochet' | 'impactFlesh' | 'impactWood' | 'impactMetal'
  | 'impactStone' | 'impactDirt' | 'break' | 'glass' | 'levelUp' | 'star' | 'medal' | 'countdown'
  | 'win' | 'lose' | 'laser' | 'alert' | 'wave';

export interface PlayOpts {
  volume?: number;
  pitch?: number;
  /** Surface enum value (src/sim/grid.ts). Selects the footstep / landing texture. */
  surface?: number;
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export type ReverbKind = 'town' | 'open' | 'canyon' | 'yard';
export type AmbienceKind = 'wind' | 'market' | 'birds' | 'harbor' | 'storm' | 'hum' | 'none';
export type MusicTrack = 'menu' | 'combat' | 'none';

export interface Volumes {
  master: number;
  sfx: number;
  music: number;
  ui: number;
}
