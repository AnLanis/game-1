import { it } from 'vitest';
import { Campaign } from '../../src/content';
import { campaignMission } from '../../src/procgen/mission';
import { DEFAULT_LOADOUT } from '../../src/sim/mission';
import { runBot } from './helpers';

const log = (s: string): void => void process.stderr.write(s + '\n');

it('smoke all ops invulnerable', () => {
  for (const op of Campaign.all()) {
    const t0 = performance.now();
    const cfg = campaignMission(op, 'regular', DEFAULT_LOADOUT);
    const r = runBot(cfg, { maxTicks: 60 * 400, invulnerable: true });
    const w = r.world;
    const o = w.objectives;
    log(`${op.id.padEnd(18)} ${w.status.padEnd(8)} tick=${String(r.ticks).padStart(6)} (${(r.ticks / 60).toFixed(0)}s) obj=${o.index}/${o.list.length} alive=${w.actors.filter((a) => a.alive && a.team === 1).length} kills=${w.player.stats.kills} ${(performance.now() - t0).toFixed(0)}ms ${w.endReason}`);
  }
}, 300000);
