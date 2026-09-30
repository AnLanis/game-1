import { Enemies } from '../../content';
import { newRayHit } from '../grid';
import type { Point } from '../level';
import { eyeHeight } from '../movement';
import type { Actor } from '../types';
import type { SimWorld } from '../world';

const ray = newRayHit();

interface PendingSpawn {
  defId: string;
  x: number;
  z: number;
  delay: number;
  focusX: number;
  focusZ: number;
}

/**
 * The Director orchestrates the fight at the squad level:
 * - attack tokens cap simultaneous shooters (Doom 2016) so fights stay readable
 * - assigns one flanker per squad (F.E.A.R.-style illusion of coordination)
 * - shares one global grenade cooldown
 * - budgets pathfinding per tick and maintains the crowd flow field
 * - spawns reinforcement waves out of sight (L4D-style) and runs Last Stand.
 */
export class Director {
  wave = 0;
  waveBreak = 0;
  lastStand = false;
  intensity = 0;
  private waveActive = false;
  private readonly pending: PendingSpawn[] = [];
  private grenadeReadyTick = 0;
  private pathBudget = 0;
  private flowCell = -1;
  private flowTick = 0;

  constructor(private readonly w: SimWorld) {}

  aliveHostiles(): number {
    let n = 0;
    for (const a of this.w.actors) if (a.alive && a.team === 1) n += 1;
    return n + this.pending.length;
  }

  canGrenade(): boolean {
    return this.w.tick >= this.grenadeReadyTick;
  }

  grenadeUsed(): void {
    this.grenadeReadyTick = this.w.tick + Math.round(this.w.difficulty.grenadeCooldown * 60);
  }

  requestPath(): boolean {
    if (this.pathBudget <= 0) return false;
    this.pathBudget -= 1;
    return true;
  }

  update(dt: number): void {
    const w = this.w;
    this.pathBudget = 8;
    this.intensity = Math.max(0, this.intensity - dt * 0.08);
    if (w.tick % 6 === 0) this.assignTokens();
    if (w.tick % 30 === 0) this.assignFlankers();

    // Shared flow field toward the player for rushers / hordes.
    const p = w.player;
    const cell = w.grid.cellZ(p.z) * w.grid.w + w.grid.cellX(p.x);
    if (cell !== this.flowCell && w.tick - this.flowTick > 20) {
      this.flowCell = cell;
      this.flowTick = w.tick;
      w.nav.buildFlow(p.x, p.z);
    }

    for (let n = this.pending.length - 1; n >= 0; n -= 1) {
      const s = this.pending[n];
      s.delay -= dt;
      if (s.delay > 0) continue;
      this.pending.splice(n, 1);
      const a = w.spawnEnemy(s.defId, s.x, s.z, 'reinforcement');
      const br = a.brain!;
      br.lastKnownX = s.focusX;
      br.lastKnownZ = s.focusZ;
      br.state = 'combat';
      br.awareness = 1;
      br.combatTick = w.tick;
      br.lastSeenTick = w.tick - 60;
      br.tacticTimer = 0;
      a.yaw = Math.atan2(-(s.focusX - s.x), -(s.focusZ - s.z));
      br.aimYaw = a.yaw;
    }

    if (this.lastStand) this.updateLastStand(dt);
  }

  onPlayerHurt(amount: number): void {
    this.intensity = Math.min(1, this.intensity + amount / 80);
  }

  onKillNearPlayer(): void {
    this.intensity = Math.min(1, this.intensity + 0.12);
  }

  private assignTokens(): void {
    const w = this.w;
    const p = w.player;
    const shooters: Actor[] = [];
    let sniperToken = false;
    for (const a of w.actors) {
      if (!a.alive || a.kind !== 'enemy' || !a.brain) continue;
      a.brain.token = false;
      if (a.brain.state !== 'combat' || !a.brain.canSee) continue;
      const role = w.enemyDef(a).role;
      if (role === 'marksman') {
        if (!sniperToken) {
          a.brain.token = true;
          sniperToken = true;
        }
        continue;
      }
      shooters.push(a);
    }
    // Closest first; stable tiebreak on id keeps it deterministic.
    shooters.sort((a, b) => {
      const da = Math.hypot(a.x - p.x, a.z - p.z);
      const db = Math.hypot(b.x - p.x, b.z - p.z);
      return da - db || a.id - b.id;
    });
    const tokens = w.difficulty.tokens + (this.lastStand ? 1 : 0);
    for (let n = 0; n < shooters.length && n < tokens; n += 1) shooters[n].brain!.token = true;
    // Point-blank enemies always get to shoot back.
    for (const a of shooters) if (Math.hypot(a.x - p.x, a.z - p.z) < 5) a.brain!.token = true;
  }

  private assignFlankers(): void {
    const w = this.w;
    const bySquad = new Map<number, Actor[]>();
    for (const a of w.actors) {
      if (!a.alive || a.kind !== 'enemy' || !a.brain || a.brain.state !== 'combat') continue;
      let list = bySquad.get(a.squad);
      if (!list) bySquad.set(a.squad, (list = []));
      list.push(a);
    }
    for (const list of bySquad.values()) {
      const hasFlanker = list.some((a) => a.brain!.flanker);
      if (hasFlanker || list.length < 2) continue;
      const candidates = list.filter((a) => w.enemyDef(a).flank > 0.2);
      if (!candidates.length) continue;
      const pick = w.aiRng.weighted(candidates, (a) => w.enemyDef(a).flank);
      pick.brain!.flanker = true;
      pick.brain!.tacticTimer = 0;
    }
  }

  /** Spawn a reinforcement wave converging on `focus`, out of the player's sight. */
  spawnWave(count: number, focus: Point, heavy: boolean): void {
    const w = this.w;
    const points = this.spawnPoints(focus, count);
    const roster = w.rosterWeights();
    for (let n = 0; n < count; n += 1) {
      let defId = w.aiRng.weighted(roster, (r) => r[1])[0];
      if (heavy && n === 0 && Enemies.has('juggernaut')) defId = 'juggernaut';
      const pt = points[n % points.length];
      const jitter = (n / points.length) | 0;
      this.pending.push({
        defId,
        x: pt.x + (jitter % 2) * 0.8,
        z: pt.z + ((jitter >> 1) % 2) * 0.8,
        delay: 0.2 + n * 0.45,
        focusX: focus.x,
        focusZ: focus.z,
      });
    }
    w.emit({ type: 'wave', wave: this.wave, count, heavy });
  }

  private spawnPoints(focus: Point, want: number): Point[] {
    const w = this.w;
    const p = w.player;
    const ey = p.y + eyeHeight(p);
    const scored: { pt: Point; score: number }[] = [];
    const candidates = w.level.reinforcements.length ? w.level.reinforcements : [w.level.playerSpawn];
    for (const pt of candidates) {
      const dP = Math.hypot(pt.x - p.x, pt.z - p.z);
      if (dP < 18) continue;
      const dF = Math.hypot(pt.x - focus.x, pt.z - focus.z);
      const hidden = !w.grid.lineOfSight(p.x, ey, p.z, pt.x, 1.4, pt.z, ray);
      let score = -Math.abs(dF - 32) * 0.05 + (hidden ? 3 : 0) - Math.max(0, dP - 70) * 0.1;
      score += w.aiRng.next() * 0.5;
      scored.push({ pt, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const out = scored.slice(0, Math.max(2, Math.min(4, Math.ceil(want / 3)))).map((s) => s.pt);
    if (!out.length) out.push(...candidates.slice(0, 2));
    return out;
  }

  startLastStand(): void {
    this.lastStand = true;
    this.wave = 0;
    this.waveBreak = 4;
    this.waveActive = false;
  }

  private updateLastStand(dt: number): void {
    const w = this.w;
    if (this.waveActive) {
      if (this.aliveHostiles() === 0) {
        this.waveActive = false;
        this.waveBreak = 12;
        w.emit({ type: 'waveClear', wave: this.wave });
        w.resupply();
      }
      return;
    }
    this.waveBreak -= dt;
    if (this.waveBreak > 0) return;
    this.wave += 1;
    this.waveActive = true;
    const n = this.wave;
    const count = Math.round((4 + 2 * n + 0.08 * n * n) * w.difficulty.enemyCountMult);
    w.hpScale = n <= 8 ? 1 + 0.06 * (n - 1) : (1 + 0.06 * 7) * Math.pow(1.05, n - 8);
    const heavy = n % 5 === 0;
    const focus = { x: w.player.x, z: w.player.z };
    // Cap simultaneous spawns; the rest trickle in as the wave proceeds.
    const first = Math.min(count, 14);
    this.spawnWave(first, focus, heavy);
    const rest = count - first;
    for (let r = 0; r < rest; r += 1) {
      this.pending.push({
        defId: w.aiRng.weighted(w.rosterWeights(), (x) => x[1])[0],
        x: w.level.reinforcements[r % Math.max(1, w.level.reinforcements.length)]?.x ?? 0,
        z: w.level.reinforcements[r % Math.max(1, w.level.reinforcements.length)]?.z ?? 0,
        delay: 8 + r * 1.2,
        focusX: focus.x,
        focusZ: focus.z,
      });
    }
  }
}
