import type { BonusKind } from '../content/campaign';
import type { ObjectiveKind } from '../content/types';
import type { LevelData, Point } from './level';

export type GameMode = 'campaign' | 'daily' | 'contract' | 'laststand';

export interface Loadout {
  primary: string;
  primaryAtt: string[];
  secondary: string;
  secondaryAtt: string[];
  perk: string;
}

export interface ObjectiveSpec {
  kind: ObjectiveKind;
  label: string;
  count?: number;
  seconds?: number;
  waves?: number;
  zone?: { x: number; z: number; r: number };
  targets?: Point[];
  escape?: Point;
}

export interface MissionConfig {
  mode: GameMode;
  seed: number;
  title: string;
  codename: string;
  biomeId: string;
  difficultyId: string;
  level: LevelData;
  loadout: Loadout;
  modifiers: string[];
  objectives: ObjectiveSpec[];
  parTime: number;
  bonus: { kind: BonusKind; target: number; label: string } | null;
  /** Campaign op id / daily key / contract id for records. */
  recordKey: string;
}

export const DEFAULT_LOADOUT: Loadout = {
  primary: 'carbine',
  primaryAtt: [],
  secondary: 'sidearm',
  secondaryAtt: [],
  perk: 'quickhands',
};
