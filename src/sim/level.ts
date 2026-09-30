import type { Grid } from './grid';

export interface Point {
  x: number;
  z: number;
}

export interface SquadSpawn {
  x: number;
  z: number;
  members: string[];
  patrol: Point[];
  /** Guards hold position, patrols walk their route, hvt flees when alerted. */
  behavior: 'guard' | 'patrol' | 'hvt' | 'bodyguard';
  /** Distance order from player spawn (0 = first encounter). */
  order: number;
}

export type ObjectiveMarkerKind = 'cache' | 'intel' | 'hostage' | 'hold' | 'extract' | 'array' | 'pump';

export interface PlacedMarker {
  kind: ObjectiveMarkerKind;
  x: number;
  z: number;
  radius: number;
}

export type PropKind =
  | 'stall'
  | 'palm'
  | 'tree'
  | 'bush'
  | 'crate'
  | 'barrel'
  | 'sandbags'
  | 'car'
  | 'truck'
  | 'fountain'
  | 'lamp'
  | 'awning'
  | 'haybale'
  | 'fence'
  | 'rock'
  | 'boulder'
  | 'container'
  | 'crane'
  | 'forklift'
  | 'tank'
  | 'tower'
  | 'dome'
  | 'solar'
  | 'antenna'
  | 'rover'
  | 'barrier'
  | 'wall'
  | 'pipe'
  | 'bollard'
  | 'drift'
  | 'crater'
  | 'hedge'
  | 'tent'
  | 'dish'
  | 'pump'
  | 'cache'
  | 'intel'
  | 'flag'
  | 'bench'
  | 'rug';

export interface PropInstance {
  kind: PropKind;
  x: number;
  y: number;
  z: number;
  rot: number;
  /** Footprint/size hints (m). */
  sx: number;
  sy: number;
  sz: number;
  variant: number;
  color?: string;
}

export interface BuildingInstance {
  /** Inclusive cell rect. */
  i0: number;
  j0: number;
  i1: number;
  j1: number;
  height: number;
  style: 'plaster' | 'brick' | 'warehouse' | 'bunker' | 'habitat' | 'barn' | 'shed' | 'container' | 'tower';
  color: string;
  trim: string;
  variant: number;
}

export interface BreakableInstance {
  cell: number;
  kind: 'crate' | 'barrel' | 'explosive';
  x: number;
  z: number;
  height: number;
  color: string;
}

export interface LampInstance {
  x: number;
  y: number;
  z: number;
  color: string;
  intensity: number;
}

export interface PickupSpawn {
  x: number;
  z: number;
  kind: 'ammo' | 'medkit' | 'grenade' | 'armor';
}

export interface PaintRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  kind: 'street' | 'plaza' | 'field' | 'dirt' | 'pad' | 'water' | 'crop';
}

export interface LevelData {
  seed: number;
  biome: string;
  grid: Grid;
  playerSpawn: { x: number; z: number; yaw: number };
  squads: SquadSpawn[];
  reinforcements: Point[];
  civilians: Point[];
  markers: PlacedMarker[];
  props: PropInstance[];
  buildings: BuildingInstance[];
  breakables: BreakableInstance[];
  lamps: LampInstance[];
  pickups: PickupSpawn[];
  paint: PaintRect[];
  /** Named landmark positions for briefing/minimap flavour. */
  landmarks: { name: string; x: number; z: number }[];
  /** Render ownership per cell (procgen Owner enum: block/building/prop/border). */
  cellOwner: Uint8Array;
}
