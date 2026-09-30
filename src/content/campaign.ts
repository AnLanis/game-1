import type { ObjectiveKind } from './types';

export interface ObjectiveTemplate {
  kind: ObjectiveKind;
  /** eliminate: fraction of hostiles (1 = all). sabotage/intel: count. survive: waves. */
  count?: number;
  /** hold: seconds. */
  seconds?: number;
  /** hold/survive: reinforcement waves while active. */
  waves?: number;
}

export type BonusKind = 'headshots' | 'nodamage' | 'accuracy' | 'nocivilians' | 'grenadekills' | 'speed';

export interface CampaignOp {
  id: string;
  chapter: number;
  name: string;
  codename: string;
  biome: string;
  seed: number;
  briefing: string;
  objectives: ObjectiveTemplate[];
  /** Threat budget: roughly the number of rifleman-equivalents. */
  threat: number;
  parTime: number;
  bonus: { kind: BonusKind; target: number; label: string };
  /** Enemy ids forced into the roster (bosses etc). */
  special?: string[];
  civilians?: number;
}

export const CHAPTERS = ['Qasr Valley', 'Highlands & Docks', 'Out of This World'];

export const CAMPAIGN: CampaignOp[] = [
  {
    id: 'op-market-sweep',
    chapter: 0,
    name: 'Market Sweep',
    codename: 'MARKET SWEEP',
    biome: 'market',
    seed: 1101,
    briefing:
      'Jackal militia seized the Sun Market at dawn. Clear the stalls, then hold the fountain plaza until the relief column arrives.',
    objectives: [{ kind: 'eliminate', count: 0.7 }, { kind: 'hold', seconds: 20, waves: 1 }],
    threat: 9,
    parTime: 240,
    bonus: { kind: 'nocivilians', target: 0, label: 'No civilian casualties' },
    civilians: 5,
  },
  {
    id: 'op-bazaar-burn',
    chapter: 0,
    name: 'Bazaar Burn',
    codename: 'BAZAAR BURN',
    biome: 'market',
    seed: 1207,
    briefing:
      'Three weapons caches are hidden in the old quarter. Plant charges on each, then get out before the whole bazaar wakes up.',
    objectives: [{ kind: 'sabotage', count: 3 }, { kind: 'extract' }],
    threat: 12,
    parTime: 300,
    bonus: { kind: 'headshots', target: 8, label: '8 headshots' },
    civilians: 3,
  },
  {
    id: 'op-orchard-run',
    chapter: 0,
    name: 'Orchard Run',
    codename: 'ORCHARD RUN',
    biome: 'orchard',
    seed: 2203,
    briefing:
      'A courier crashed in the orchards with militia ledgers. Recover all three intel packets. Watch the tree lines for marksmen.',
    objectives: [{ kind: 'intel', count: 3 }, { kind: 'extract' }],
    threat: 12,
    parTime: 330,
    bonus: { kind: 'accuracy', target: 0.35, label: '35% accuracy' },
  },
  {
    id: 'op-harvest-moon',
    chapter: 0,
    name: 'Harvest Moon',
    codename: 'HARVEST MOON',
    biome: 'orchard',
    seed: 2311,
    briefing: 'An aid worker is held in a farmhouse. Reach her, keep her alive, and walk her out to the extraction point.',
    objectives: [{ kind: 'rescue' }, { kind: 'extract' }],
    threat: 13,
    parTime: 360,
    bonus: { kind: 'nodamage', target: 60, label: 'Take under 60 damage' },
  },
  {
    id: 'op-ridge-push',
    chapter: 1,
    name: 'Ridge Push',
    codename: 'RIDGE PUSH',
    biome: 'ridge',
    seed: 3109,
    briefing: 'The pass is fortified checkpoint by checkpoint. Break through and secure the lookout at the summit.',
    objectives: [{ kind: 'eliminate', count: 0.75 }, { kind: 'hold', seconds: 25, waves: 2 }],
    threat: 15,
    parTime: 360,
    bonus: { kind: 'grenadekills', target: 2, label: '2 grenade kills' },
  },
  {
    id: 'op-switchback',
    chapter: 1,
    name: 'Switchback',
    codename: 'SWITCHBACK',
    biome: 'ridge',
    seed: 3217,
    briefing: 'Colonel Varga is inspecting the ridge defenses. He will run the moment shots are fired. Do not let him escape.',
    objectives: [{ kind: 'hvt' }, { kind: 'extract' }],
    threat: 15,
    parTime: 330,
    bonus: { kind: 'speed', target: 200, label: 'Finish in 3:20' },
    special: ['officer'],
  },
  {
    id: 'op-dark-water',
    chapter: 1,
    name: 'Dark Water',
    codename: 'DARK WATER',
    biome: 'port',
    seed: 4103,
    briefing: 'Tidewater smuggles fuel through the night port. Sabotage three pump stations and slip out through the yard.',
    objectives: [{ kind: 'sabotage', count: 3 }, { kind: 'extract' }],
    threat: 16,
    parTime: 390,
    bonus: { kind: 'headshots', target: 10, label: '10 headshots' },
  },
  {
    id: 'op-crane-game',
    chapter: 1,
    name: 'Crane Game',
    codename: 'CRANE GAME',
    biome: 'port',
    seed: 4219,
    briefing: 'Our drone uplink sits under crane four. Hold the loading bay while it transmits. They will come in waves.',
    objectives: [{ kind: 'eliminate', count: 0.5 }, { kind: 'hold', seconds: 45, waves: 3 }],
    threat: 16,
    parTime: 420,
    bonus: { kind: 'nodamage', target: 120, label: 'Take under 120 damage' },
    special: ['juggernaut'],
  },
  {
    id: 'op-whiteout',
    chapter: 2,
    name: 'Whiteout',
    codename: 'WHITEOUT',
    biome: 'frost',
    seed: 5107,
    briefing: 'Frostline keeps its contracts on paper. Pull the files from three bunkers and extract before the storm clears.',
    objectives: [{ kind: 'intel', count: 3 }, { kind: 'extract' }],
    threat: 18,
    parTime: 420,
    bonus: { kind: 'accuracy', target: 0.4, label: '40% accuracy' },
  },
  {
    id: 'op-cold-iron',
    chapter: 2,
    name: 'Cold Iron',
    codename: 'COLD IRON',
    biome: 'frost',
    seed: 5231,
    briefing: 'The PMC commander is inside the compound with two Juggernauts on escort. Take him down.',
    objectives: [{ kind: 'hvt' }, { kind: 'eliminate', count: 0.6 }, { kind: 'extract' }],
    threat: 20,
    parTime: 480,
    bonus: { kind: 'grenadekills', target: 3, label: '3 grenade kills' },
    special: ['officer', 'juggernaut', 'juggernaut'],
  },
  {
    id: 'op-red-dust',
    chapter: 2,
    name: 'Red Dust',
    codename: 'RED DUST',
    biome: 'reddust',
    seed: 6101,
    briefing:
      'The Syndicate runs Arcadia colony from orbit. Knock out their three comm arrays. Low gravity: you can clear the solar rows in one jump.',
    objectives: [{ kind: 'sabotage', count: 3 }, { kind: 'extract' }],
    threat: 20,
    parTime: 450,
    bonus: { kind: 'headshots', target: 12, label: '12 headshots' },
  },
  {
    id: 'op-olympus',
    chapter: 2,
    name: 'Olympus Protocol',
    codename: 'OLYMPUS PROTOCOL',
    biome: 'reddust',
    seed: 6247,
    briefing:
      'Final op. Seize the reactor dome and hold it while the uplink wipes the Syndicate network. Everything they have is coming.',
    objectives: [{ kind: 'eliminate', count: 0.6 }, { kind: 'hold', seconds: 60, waves: 4 }, { kind: 'extract' }],
    threat: 22,
    parTime: 600,
    bonus: { kind: 'nodamage', target: 200, label: 'Take under 200 damage' },
    special: ['juggernaut', 'juggernaut', 'officer'],
  },
];

/** Objective chains used by Contracts / Daily ops. */
export const CONTRACT_TYPES: { id: string; name: string; objectives: ObjectiveTemplate[] }[] = [
  { id: 'sweep', name: 'Sweep & Clear', objectives: [{ kind: 'eliminate', count: 1 }] },
  { id: 'hold', name: 'Hold Ground', objectives: [{ kind: 'eliminate', count: 0.6 }, { kind: 'hold', seconds: 30, waves: 2 }] },
  { id: 'sabotage', name: 'Sabotage', objectives: [{ kind: 'sabotage', count: 3 }, { kind: 'extract' }] },
  { id: 'intel', name: 'Intel Run', objectives: [{ kind: 'intel', count: 3 }, { kind: 'extract' }] },
  { id: 'rescue', name: 'Rescue', objectives: [{ kind: 'rescue' }, { kind: 'extract' }] },
  { id: 'hvt', name: 'Manhunt', objectives: [{ kind: 'hvt' }, { kind: 'extract' }] },
];
