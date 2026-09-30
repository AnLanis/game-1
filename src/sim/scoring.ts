import type { Actor, HitZone, Medal } from './types';
import type { SimWorld } from './world';

export const MEDAL_INFO: Record<Medal, { name: string; xp: number }> = {
  headshot: { name: 'Headshot', xp: 25 },
  double: { name: 'Double Kill', xp: 50 },
  triple: { name: 'Triple Kill', xp: 100 },
  multi: { name: 'Multi Kill', xp: 175 },
  longshot: { name: 'Longshot', xp: 50 },
  pointblank: { name: 'Point Blank', xp: 25 },
  collateral: { name: 'Collateral', xp: 150 },
  grenade: { name: 'Frag Kill', xp: 40 },
  streak5: { name: 'Untouchable ×5', xp: 150 },
  streak10: { name: 'Ghost ×10', xp: 400 },
  comeback: { name: 'Comeback', xp: 75 },
  firstblood: { name: 'First Blood', xp: 30 },
  barrel: { name: 'Kaboom', xp: 60 },
  untouchable: { name: 'Flawless', xp: 500 },
  quickdraw: { name: 'Quickdraw', xp: 40 },
};

/**
 * In-match score, XP and medals. Lives in the sim so results are
 * deterministic and replay-verifiable (anti-cheat friendly for leaderboards).
 */
export class Scoring {
  score = 0;
  xp = 0;
  kills = 0;
  headshots = 0;
  grenadeKills = 0;
  civilianKills = 0;
  streak = 0;
  bestStreak = 0;
  private lastKillTick = -9999;
  private multi = 0;
  private lastShotSerial = -1;
  private killsThisSerial = 0;
  readonly medals = new Map<Medal, number>();
  objectivesXp = 0;

  constructor(private readonly w: SimWorld) {}

  private award(medal: Medal): void {
    const info = MEDAL_INFO[medal];
    this.medals.set(medal, (this.medals.get(medal) ?? 0) + 1);
    this.xp += info.xp;
    this.score += info.xp * 10;
    this.w.emit({ type: 'medal', medal, xp: info.xp });
  }

  onPlayerDamaged(amount: number): void {
    if (amount >= 10) this.streak = 0;
  }

  onKill(killer: Actor | null, victim: Actor, zone: HitZone, distance: number, kind: 'bullet' | 'explosion', viaBarrel: boolean): void {
    const w = this.w;
    if (!killer || killer.kind !== 'player') return;
    if (victim.kind === 'civilian' || victim.kind === 'hostage') {
      this.civilianKills += 1;
      this.score -= 2500;
      return;
    }
    const baseXp = w.enemyXp(victim);
    this.kills += 1;
    this.xp += baseXp;
    this.score += baseXp * 10;
    if (this.kills === 1) this.award('firstblood');
    if (kind === 'bullet' && zone === 'head') {
      this.headshots += 1;
      this.award('headshot');
    }
    if (kind === 'explosion') {
      if (viaBarrel) this.award('barrel');
      else {
        this.grenadeKills += 1;
        this.award('grenade');
      }
    }
    if (kind === 'bullet' && distance >= 45) this.award('longshot');
    if (kind === 'bullet' && distance <= 3) this.award('pointblank');
    if (killer.hp < killer.maxHp * 0.25) this.award('comeback');

    // Multi-kills: within 3 s of each other.
    if (w.tick - this.lastKillTick <= 180) this.multi += 1;
    else this.multi = 1;
    this.lastKillTick = w.tick;
    if (this.multi === 2) this.award('double');
    else if (this.multi === 3) this.award('triple');
    else if (this.multi >= 4) this.award('multi');

    // Collateral: two kills from one trigger pull.
    if (kind === 'bullet') {
      if (w.shotSerial === this.lastShotSerial) {
        this.killsThisSerial += 1;
        if (this.killsThisSerial === 2) this.award('collateral');
      } else {
        this.lastShotSerial = w.shotSerial;
        this.killsThisSerial = 1;
      }
    }

    // Streak = kills without taking meaningful damage.
    this.streak += 1;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    if (this.streak === 5) this.award('streak5');
    if (this.streak === 10) this.award('streak10');
  }

  onObjective(): void {
    this.objectivesXp += 150;
    this.xp += 150;
    this.score += 1500;
  }

  finalize(damageTaken: number, success: boolean): void {
    if (success && damageTaken < 1) this.award('untouchable');
  }
}
