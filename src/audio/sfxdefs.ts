/** Per-sound mixing metadata: priority for voice stealing, loudness, reverb send, rate limits. */

import type { SfxId } from './types';

export interface SfxDef {
  /** 0..10. Higher survives voice stealing. */
  prio: number;
  /** Pre-rendered variations (random pick, never the same twice in a row). */
  variants: number;
  bus: 'sfx' | 'ui';
  /** Base gain applied on top of the peak-normalised buffer. */
  gain: number;
  /** Reverb send (0..1), scaled by the environment. */
  send: number;
  /** Minimum seconds between two plays of this id. */
  gap: number;
  /** Max simultaneous voices of this id. */
  max: number;
  /** Apply the +-4% random pitch. */
  jitter: boolean;
  /** Panner reference distance in metres (louder sounds carry further). */
  ref: number;
  /** Cull distance in metres. */
  cull: number;
  /** Delay by distance / 343 m/s (capped at 0.25 s). */
  delay: boolean;
}

function def(prio: number, gain: number, o: Partial<SfxDef> = {}): SfxDef {
  return { prio, gain, variants: 3, bus: 'sfx', send: 0.2, gap: 0, max: 6, jitter: true, ref: 3, cull: 90, delay: false, ...o };
}

const UI = { bus: 'ui', send: 0, jitter: false, max: 4 } as const;
const JINGLE = { bus: 'ui', send: 0, jitter: false, variants: 1, max: 2 } as const;

export const SFX_DEFS: Record<SfxId, SfxDef> = {
  step: def(2, 0.5, { variants: 4, send: 0.15, gap: 0.035, max: 5 }),
  land: def(3, 0.7, { send: 0.2, gap: 0.12, max: 2 }),
  jump: def(2, 0.35, { send: 0.1, gap: 0.1, max: 2 }),
  slide: def(3, 0.45, { send: 0.1, max: 2, variants: 2 }),
  reloadOut: def(4, 0.55),
  reloadIn: def(4, 0.55),
  bolt: def(4, 0.6, { send: 0.25 }),
  dryfire: def(4, 0.45),
  switch: def(3, 0.4, { send: 0.1 }),
  hitmarker: def(8, 0.55, { send: 0.04, gap: 0.03, max: 3 }),
  headshot: def(8, 0.65, { send: 0.05, gap: 0.05, max: 2 }),
  kill: def(8, 0.7, { send: 0.05, gap: 0.05, max: 2 }),
  hurt: def(9, 0.9, { send: 0.1, gap: 0.08, max: 3 }),
  heartbeat: def(6, 0.8, { variants: 2, send: 0, jitter: false, gap: 0.2, max: 2 }),
  explosion: def(9, 1.0, { send: 0.55, ref: 14, cull: 150, delay: true, max: 4 }),
  bounce: def(4, 0.6, { send: 0.3, gap: 0.04, max: 4 }),
  pin: def(4, 0.5),
  pickup: def(5, 0.5, { variants: 2, send: 0.1 }),
  intel: def(6, 0.55, { variants: 1, send: 0.05, jitter: false }),
  plant: def(6, 0.6, { send: 0.2 }),
  beep: def(5, 0.5, { variants: 1, send: 0.2, jitter: false, gap: 0.04, max: 3 }),
  objective: def(7, 0.6, { variants: 1, send: 0.05, jitter: false, max: 2 }),
  uiClick: def(7, 0.5, { ...UI, variants: 3, gap: 0.02 }),
  uiHover: def(3, 0.25, { ...UI, variants: 2, gap: 0.03, max: 2 }),
  uiConfirm: def(7, 0.55, { ...UI, variants: 2 }),
  uiBack: def(7, 0.5, { ...UI, variants: 2 }),
  radio: def(5, 0.5, { send: 0.25, max: 4 }),
  crack: def(8, 0.95, { variants: 4, send: 0.35, gap: 0.04, max: 4 }),
  ricochet: def(3, 0.6, { variants: 4, send: 0.4, gap: 0.04, max: 3 }),
  impactFlesh: def(3, 0.6, { send: 0.25, gap: 0.015, max: 5 }),
  impactWood: def(3, 0.6, { send: 0.3, gap: 0.015, max: 5 }),
  impactMetal: def(3, 0.6, { send: 0.35, gap: 0.015, max: 5 }),
  impactStone: def(3, 0.6, { send: 0.3, gap: 0.015, max: 5 }),
  impactDirt: def(3, 0.6, { send: 0.25, gap: 0.015, max: 5 }),
  break: def(4, 0.7, { send: 0.4, gap: 0.05, max: 3 }),
  glass: def(4, 0.65, { send: 0.4, gap: 0.05, max: 3 }),
  levelUp: def(8, 0.6, JINGLE),
  star: def(7, 0.5, { ...JINGLE, max: 3 }),
  medal: def(8, 0.6, JINGLE),
  countdown: def(8, 0.55, { ...JINGLE, max: 3 }),
  win: def(9, 0.6, JINGLE),
  lose: def(9, 0.6, JINGLE),
  laser: def(5, 0.35, { variants: 1, send: 0.2, jitter: false, max: 3 }),
  alert: def(7, 0.55, { variants: 1, send: 0, jitter: false, gap: 0.1, max: 2 }),
  wave: def(8, 0.7, { variants: 1, send: 0.3, jitter: false, max: 2 }),
};

/** Footstep texture groups. */
export const STEP_GROUPS = ['hard', 'dirt', 'sand', 'regolith', 'metal', 'snow', 'wood', 'foliage', 'fabric', 'glass'] as const;
export type StepGroup = (typeof STEP_GROUPS)[number];

/**
 * Map the sim's Surface enum (src/sim/grid.ts) to a texture group. Numeric on purpose:
 * Surface is a `const enum`, and the audio layer must stay decoupled from the sim.
 * 0 Ground, 1 Stone, 2 Wood, 3 Metal, 4 Sand, 5 Snow, 6 Foliage, 7 Fabric, 8 Rock, 9 Concrete, 10 Regolith, 11 Glass.
 */
export function stepGroupForSurface(surface: number | undefined): StepGroup {
  switch (surface) {
    case 1:
    case 8:
    case 9:
      return 'hard';
    case 2:
      return 'wood';
    case 3:
      return 'metal';
    case 4:
      return 'sand';
    case 5:
      return 'snow';
    case 6:
      return 'foliage';
    case 7:
      return 'fabric';
    case 10:
      return 'regolith';
    case 11:
      return 'glass';
    default:
      return 'dirt';
  }
}
