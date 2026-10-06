import { describe, expect, it } from 'vitest';
import { Biomes, Campaign } from '../../src/content';
import { campaignMission, lastStandMission } from '../../src/procgen/mission';
import { PlayerBot } from '../../src/sim/bot';
import { DEFAULT_LOADOUT, type MissionConfig } from '../../src/sim/mission';
import { emptyCmd, type SimEvent } from '../../src/sim/types';
import { SimWorld } from '../../src/sim/world';
import { runBot } from './helpers';

const OPS = Campaign.all();

/** Every actor/projectile number must stay finite; catches NaN propagation early. */
function assertFinite(w: SimWorld, label: string): void {
  for (const a of w.actors) {
    for (const v of [a.x, a.y, a.z, a.vx, a.vy, a.vz, a.yaw, a.pitch, a.hp]) {
      if (!Number.isFinite(v)) throw new Error(`${label}: non-finite state on ${a.kind}#${a.id} (${a.defId}) at tick ${w.tick}: ${JSON.stringify([a.x, a.y, a.z, a.yaw, a.hp])}`);
    }
  }
  for (const pr of w.projectiles) {
    if (![pr.x, pr.y, pr.z, pr.vx, pr.vy, pr.vz].every(Number.isFinite)) throw new Error(`${label}: non-finite projectile at tick ${w.tick}`);
  }
}

describe('sim: determinism', () => {
  const hashRun = (cfg: MissionConfig, ticks: number, invulnerable = true): number[] => {
    const w = new SimWorld(cfg);
    w.invulnerable = invulnerable;
    const bot = new PlayerBot(w, 1);
    const out: number[] = [];
    for (let t = 0; t < ticks; t += 1) {
      w.step(bot.next());
      out.push(w.hash());
    }
    return out;
  };

  it('same mission + same bot ⇒ identical world hash every tick (1800 ticks, twice from scratch)', () => {
    const a = hashRun(campaignMission(OPS[0], 'regular', DEFAULT_LOADOUT), 1800);
    const b = hashRun(campaignMission(OPS[0], 'regular', DEFAULT_LOADOUT), 1800);
    expect(a).toHaveLength(1800);
    expect(b).toEqual(a);
    // The hash actually tracks the simulation (it moves as the fight unfolds).
    expect(new Set(a).size).toBe(1800);
  });

  it('still identical when the player can be hurt, die and end the mission', () => {
    const a = hashRun(campaignMission(OPS[4], 'dust', DEFAULT_LOADOUT), 1800, false);
    const b = hashRun(campaignMission(OPS[4], 'dust', DEFAULT_LOADOUT), 1800, false);
    expect(b).toEqual(a);
  });

  it('a different seed diverges', () => {
    const base = hashRun(campaignMission(OPS[0], 'regular', DEFAULT_LOADOUT), 600);
    const other = hashRun(campaignMission({ ...OPS[0], seed: OPS[0].seed + 1 }, 'regular', DEFAULT_LOADOUT), 600);
    expect(other[599]).not.toBe(base[599]);
    expect(other[0]).not.toBe(base[0]);
  });

  it('worlds do not share hidden module state (interleaved stepping matches solo runs)', () => {
    const cfgA = () => campaignMission(OPS[0], 'regular', DEFAULT_LOADOUT);
    const cfgB = () => campaignMission(OPS[6], 'veteran', DEFAULT_LOADOUT);
    const soloA = hashRun(cfgA(), 900);
    const soloB = hashRun(cfgB(), 900);
    const wa = new SimWorld(cfgA());
    const wb = new SimWorld(cfgB());
    wa.invulnerable = true;
    wb.invulnerable = true;
    const ba = new PlayerBot(wa, 1);
    const bb = new PlayerBot(wb, 1);
    for (let t = 0; t < 900; t += 1) {
      wa.step(ba.next());
      wb.step(bb.next());
      if (t % 100 === 99) {
        expect(wa.hash(), `A tick ${t}`).toBe(soloA[t]);
        expect(wb.hash(), `B tick ${t}`).toBe(soloB[t]);
      }
    }
  });

  it('records/replays: same command stream on a fresh world reproduces the end state', () => {
    const cfg = () => campaignMission(OPS[3], 'regular', DEFAULT_LOADOUT);
    const w1 = new SimWorld(cfg());
    const bot = new PlayerBot(w1, 1);
    const cmds = [];
    for (let t = 0; t < 900; t += 1) {
      const c = bot.next();
      cmds.push({ ...c });
      w1.step(c);
    }
    const w2 = new SimWorld(cfg());
    for (const c of cmds) w2.step(c);
    expect(w2.hash()).toBe(w1.hash());
    expect(w2.player.x).toBe(w1.player.x);
    expect(w2.player.z).toBe(w1.player.z);
  });
});

describe('sim: spawn sanity', () => {
  it('nothing spawns inside solid geometry (every campaign op, several difficulties)', () => {
    for (const op of OPS) {
      for (const diff of ['recruit', 'dust']) {
        const w = new SimWorld(campaignMission(op, diff, DEFAULT_LOADOUT));
        for (const a of w.actors) {
          const h = w.grid.heightAt(a.x, a.z);
          expect(h, `${op.id}: ${a.kind}/${a.defId} at ${a.x.toFixed(1)},${a.z.toFixed(1)} inside geometry (h=${h})`).toBeLessThanOrEqual(0.35);
        }
        for (const pk of w.pickups) expect(w.grid.heightAt(pk.x, pk.z), `${op.id}: pickup inside geometry`).toBeLessThanOrEqual(0.35);
        for (const it of w.interactables) expect(w.grid.heightAt(it.x, it.z), `${op.id}: interactable inside geometry`).toBeLessThanOrEqual(0.35);
      }
    }
  });
});

describe('sim: full-loop smoke (invulnerable PlayerBot completes every campaign op)', () => {
  const rows: string[] = [];
  for (const op of OPS) {
    it(`${op.id} reaches success within 400 s`, () => {
      const cfg = campaignMission(op, 'regular', DEFAULT_LOADOUT);
      const started = cfg.objectives.map((o) => o.kind);
      const seen: string[] = [];
      const r = runBot(cfg, {
        maxTicks: 60 * 400,
        invulnerable: true,
        onTick: (w) => {
          if (w.tick % 30 === 0) assertFinite(w, op.id);
          const cur = w.objectives.current;
          if (cur && seen[seen.length - 1] !== cur.spec.kind) seen.push(cur.spec.kind);
        },
      });
      const w = r.world;
      rows.push(`${op.id}: ${(r.ticks / 60).toFixed(0)}s`);
      expect(w.status, `${op.id}: ${w.objectives.current?.spec.kind} "${w.objectives.current?.detail}" @${(r.ticks / 60).toFixed(0)}s ${w.endReason}`).toBe('success');
      expect(w.objectives.complete).toBe(true);
      expect(w.player.hp).toBe(w.player.maxHp);
      expect(w.scoring.score).toBeGreaterThan(0);
      // Every objective in the chain was actually the active one at some point, in order.
      const chain = started.filter((k, n) => started[n - 1] !== k);
      expect(seen).toEqual(chain);
      for (const o of w.objectives.list) expect(o.done).toBe(true);
    });
  }

  it('finishes with bounded actor / event / projectile buffers even if nobody drains events', () => {
    const cfg = campaignMission(OPS[11], 'regular', DEFAULT_LOADOUT); // Olympus: the busiest op
    const w = new SimWorld(cfg);
    w.invulnerable = true;
    const bot = new PlayerBot(w, 1);
    let maxEvents = 0;
    let maxActors = 0;
    for (let t = 0; t < 60 * 120 && w.status === 'running'; t += 1) {
      w.step(bot.next());
      maxEvents = Math.max(maxEvents, w.events.length);
      maxActors = Math.max(maxActors, w.actors.length);
    }
    expect(maxEvents).toBeLessThanOrEqual(6000);
    expect(maxActors).toBeLessThan(150);
    expect(w.projectiles.length).toBeLessThan(60);
  });
});

describe('sim: Last Stand smoke', () => {
  for (const biome of ['market', 'frost']) {
    it(`${biome}: waves keep coming for 120 s with an invulnerable bot`, () => {
      const cfg = lastStandMission(biome, 1234, 'regular', DEFAULT_LOADOUT);
      const waves: number[] = [];
      let peak = 0;
      const r = runBot(cfg, {
        maxTicks: 60 * 120,
        invulnerable: true,
        onTick: (w) => {
          if (w.tick % 30 === 0) assertFinite(w, `laststand/${biome}`);
          peak = Math.max(peak, w.director.aliveHostiles());
          if (waves[waves.length - 1] !== w.director.wave) waves.push(w.director.wave);
          // Reinforcements must never appear inside walls or the map border.
          for (const a of w.actors) if (a.kind === 'enemy' && a.tag === 'reinforcement' && a.deathTick === 0 && w.tick - 1 <= 60 * 120 && w.grid.heightAt(a.x, a.z) > 0.35 && a.brain!.combatTick === w.tick) {
            throw new Error(`reinforcement spawned in a wall at ${a.x},${a.z}`);
          }
        },
      });
      const w = r.world;
      expect(w.status).toBe('running');
      expect(w.director.lastStand).toBe(true);
      expect(w.director.wave).toBeGreaterThanOrEqual(2);
      expect(waves).toEqual(Array.from({ length: waves.length }, (_, n) => n)); // waves advance one at a time
      expect(peak).toBeGreaterThan(4);
      expect(w.player.stats.kills).toBeGreaterThan(5);
      expect(w.scoring.kills).toBe(w.player.stats.kills);
    });
  }

  it('every biome can host a Last Stand: wave 1 spawns and reaches the player area', () => {
    for (const b of Biomes.all()) {
      const cfg = lastStandMission(b.id, 55, 'regular', DEFAULT_LOADOUT);
      const w = new SimWorld(cfg);
      w.invulnerable = true;
      const cmd = emptyCmd();
      let spawned = 0;
      const seen: SimEvent[] = [];
      for (let t = 0; t < 60 * 12; t += 1) {
        w.step(cmd);
        w.drainEvents(seen);
        spawned += seen.filter((e) => e.type === 'spawn').length;
      }
      expect(w.director.wave, `${b.id}: wave started`).toBeGreaterThanOrEqual(1);
      expect(spawned, `${b.id}: enemies spawned`).toBeGreaterThan(3);
    }
  });
});

describe('sim: balance sanity (player can be hurt)', () => {
  const play = (diff: string, skill: number, botSeed: number, maxTicks: number) => {
    const cfg = campaignMission(Campaign.get('op-market-sweep'), diff, DEFAULT_LOADOUT);
    const w = new SimWorld(cfg);
    const bot = new PlayerBot(w, skill, botSeed);
    const drain: SimEvent[] = [];
    let aiShots = 0;
    let aiHitsOnPlayer = 0;
    for (let t = 0; t < maxTicks && w.status === 'running'; t += 1) {
      w.step(bot.next());
      for (const e of w.events) {
        if (e.type === 'shot' && e.actorId !== w.player.id) {
          aiShots += 1;
          if (e.hitActor === w.player.id) aiHitsOnPlayer += 1;
        }
      }
      w.drainEvents(drain);
    }
    return { w, aiShots, aiHitsOnPlayer };
  };

  it('recruit: a competent bot (skill 1.3) clears Market Sweep in at least 2 of 3 attempts', () => {
    const results = [0, 1, 2].map((seed) => play('recruit', 1.3, seed, 60 * 300));
    const wins = results.filter((r) => r.w.status === 'success').length;
    expect(wins, results.map((r) => `${r.w.status}@${(r.w.tick / 60).toFixed(0)}s hp=${r.w.player.hp.toFixed(0)}`).join(', ')).toBeGreaterThanOrEqual(2);
  });

  it('regular: enemies actually fight back (they shoot, they hit, the player takes damage)', () => {
    const r = play('regular', 1.3, 0, 60 * 60);
    expect(r.aiShots).toBeGreaterThan(20);
    expect(r.aiHitsOnPlayer).toBeGreaterThan(0);
    expect(r.w.player.stats.damageTaken).toBeGreaterThan(0);
  });

  it('regular is meaningfully harder than recruit (more damage taken on average over 3 bot seeds)', () => {
    const dmg = (diff: string): number => [0, 1, 2].reduce((sum, s) => sum + play(diff, 1.3, s, 60 * 45).w.player.stats.damageTaken, 0) / 3;
    expect(dmg('regular')).toBeGreaterThan(dmg('recruit'));
  });

  it('a passive player standing in the open eventually gets killed on dust difficulty', () => {
    const cfg = campaignMission(Campaign.get('op-market-sweep'), 'dust', DEFAULT_LOADOUT);
    const w = new SimWorld(cfg);
    // Alert everyone with a gunshot-like noise from the player's position, then stand still.
    w.noise(w.player.x, w.player.z, 500, w.player.id);
    const idle = emptyCmd();
    for (let t = 0; t < 60 * 120 && w.status === 'running'; t += 1) w.step(idle);
    expect(w.status).toBe('failed');
    expect(w.endReason).toMatch(/killed/i);
  });
});

describe('sim: performance', () => {
  it('a tick with 40+ hostiles in combat averages well under the 16 ms budget', () => {
    const cfg = lastStandMission('market', 99, 'regular', DEFAULT_LOADOUT);
    const w = new SimWorld(cfg);
    w.invulnerable = true;
    const pts = cfg.level.reinforcements;
    const roster = ['rifleman', 'rusher', 'breacher', 'marksman', 'grenadier', 'juggernaut'];
    for (let n = 0; n < 48; n += 1) {
      const pt = pts[n % pts.length];
      const a = w.spawnEnemy(roster[n % roster.length], pt.x, pt.z, 'reinforcement');
      const br = a.brain!;
      br.state = 'combat';
      br.lastKnownX = w.player.x;
      br.lastKnownZ = w.player.z;
      br.lastSeenTick = 0;
      br.awareness = 1;
    }
    const bot = new PlayerBot(w, 1);
    const drain: SimEvent[] = [];
    for (let t = 0; t < 120; t += 1) w.step(bot.next()); // warm-up (JIT, flow field)
    let total = 0;
    let minAlive = Infinity;
    const N = 600;
    for (let t = 0; t < N; t += 1) {
      const cmd = bot.next();
      const t0 = performance.now();
      w.step(cmd);
      total += performance.now() - t0;
      if (t % 30 === 0) {
        w.drainEvents(drain);
        minAlive = Math.min(minAlive, w.actors.filter((a) => a.alive && a.team === 1).length);
      }
    }
    expect(minAlive).toBeGreaterThanOrEqual(40);
    const avg = total / N;
    expect(avg, `avg ${avg.toFixed(2)} ms/tick`).toBeLessThan(4); // typically ~0.5 ms; slack for slow CI
  });
});
