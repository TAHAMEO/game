/**
 * Balance report: a scripted player lives and dies N times against the same save, and
 * we print what the Entity did and learned each life. Run with `npm run campaign`.
 * (Excluded from `npm test`: it plays ~30 minutes of game time.)
 */
import { it } from 'vitest';
import { defaultConfig } from '../src/core/config';
import type { Tell } from '../src/core/entity';
import { MemoryStore } from '../src/core/persistence';
import { Sim } from '../src/core/sim';
import { Bot } from './bot';

const LIVES = 12;
const MAX_MINUTES = 15;
const OUTCOME: Record<string, string> = { done: '✓', sprung: '⚡', interrupted: '·', aborted: '✗' };

it('campaign', { timeout: 900_000 }, () => {
  const store = new MemoryStore();
  const rows: string[] = [];
  for (let life = 0; life < LIVES; life++) {
    const sim = new Sim(defaultConfig(700 + life), store);
    const bot = new Bot(sim, { hides: true, torch: true, flees: true, panicky: life % 2 === 0 });
    const tells: Record<'real' | 'fake', Record<string, number>> = { real: {}, fake: {} };
    const orig = sim.director.onTell.bind(sim.director);
    sim.director.onTell = (t: Tell, level: number) => {
      const bucket = t.fake ? tells.fake : tells.real;
      bucket[t.kind] = (bucket[t.kind] ?? 0) + 1;
      orig(t, level);
    };
    let maxFloor = 0;
    let chase = 0;
    for (let i = 0; i < 60 * 60 * MAX_MINUTES && sim.phase === 'playing'; i++) {
      sim.step(1 / 60, bot.input());
      sim.drainEvents();
      if (sim.entity.stateKind === 'chase') chase += 1 / 60;
      maxFloor = Math.max(maxFloor, sim.director.floor);
    }
    const d = sim.director;
    const fmt = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => `${k}×${v}`).join(' ') || '–';
    rows.push(
      [
        `life ${String(sim.runNumber).padStart(2)}`,
        `tier ${d.tier}`,
        `${sim.phase.padEnd(7)} ${sim.time.toFixed(0).padStart(4)}s`,
        `floor ${maxFloor.toFixed(2)}`,
        `chased ${chase.toFixed(0)}s`,
        `escapes ${d.adapt.escapes}`,
        `ghosts ${d.perception.emitted} (flinched ${d.profile.ghostReactions})`,
        `torch tax: ${d.flashTax.phase}`,
        `tells real [${fmt(tells.real)}] fake [${fmt(tells.fake)}]`,
        `plans ${d.bait.history.map((h) => h.kind + OUTCOME[h.outcome]).join(' ') || '–'}`,
        `radio ${sim.objectives.calls.map((c) => (c.fake ? 'FAKE' : 'real')).join(',') || '–'}`,
        `nest ${sim.world.props.length}`,
        sim.player.deathCause,
      ].join(' | '),
    );
  }
  const learned = Object.keys(JSON.parse(store.get('the-quiet.save.v1')!).learned).join(', ');
  console.log(`\n${rows.join('\n')}\n\nThe Entity learned: ${learned || 'nothing'}\n`);
});
