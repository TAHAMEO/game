import { cellCenter } from './level';
import { dist } from './math';
import type { Sim } from './sim';
import type { Gate } from './types';

export type Stage = 'fuses' | 'breaker' | 'radio' | 'extract';

export interface RadioCall {
  t: number;
  gate: Gate['id'];
  fake: boolean;
  text: string;
}

const RESCUER = { pitch: 0.92, rate: 1.0 };

/**
 * U. CORRUPTED OBJECTIVES. Progress is the loudest, brightest, most dangerous thing you
 * can do: the breaker lights up the whole map and can be heard from anywhere; the radio
 * is a beacon, and late in the arms race the voice that answers it may not be human.
 */
export class Objectives {
  powerOn = false;
  readonly realGate: Gate['id'];
  readonly calls: RadioCall[] = [];
  rescueAt: number | null = null;
  arrived = false;

  constructor(private readonly sim: Sim) {
    this.realGate = sim.rng.chance(0.5) ? 'bay' : 'garden';
  }

  stage(): Stage {
    const sim = this.sim;
    if (!this.powerOn) return sim.player.inv.fuses >= sim.world.fusesRequired ? 'breaker' : 'fuses';
    if (!this.calls.length) return 'radio';
    return 'extract';
  }

  /** The cell the player is most plausibly heading for — the bait planner's prediction [T]. */
  predictedTarget(): number {
    const sim = this.sim;
    const pl = sim.player;
    switch (this.stage()) {
      case 'fuses': {
        const needKey = !pl.inv.keys.has('maintenance') && sim.world.doors.some((d) => d.lock === 'maintenance' && d.locked);
        const wanted = sim.world.items.filter((i) => i.state === 'ground' && (i.kind === 'fuse' || (needKey && i.kind === 'key')));
        if (!wanted.length) return sim.world.fuseBox.access;
        wanted.sort((a, b) => dist(a.pos, pl.pos) - dist(b.pos, pl.pos));
        return sim.level.w * Math.floor(wanted[0]!.pos.y) + Math.floor(wanted[0]!.pos.x);
      }
      case 'breaker':
        return sim.world.fuseBox.access;
      case 'radio':
        return sim.world.radio.access;
      case 'extract': {
        const last = this.calls[this.calls.length - 1]!;
        return sim.world.gates.find((g) => g.id === last.gate)!.access;
      }
    }
  }

  /** The breaker: the single loudest, brightest act in the game. */
  restorePower(): void {
    const sim = this.sim;
    this.powerOn = true;
    sim.world.lighting.setPower(true);
    sim.emitNoise('breaker', cellCenter(sim.level, sim.world.fuseBox.access), 100, 'world');
    sim.events.push({ type: 'power', on: true });
    sim.notice('The lights come up all at once. Every one of them. Everywhere.', 5);
    sim.director.onPowerRestored();
  }

  useRadio(): void {
    const sim = this.sim;
    const tier = sim.director.tier;
    const mimicry = sim.features.rescueMimicry && (tier >= 3 || (tier >= 2 && sim.memory.learned('radio')));
    const fake = mimicry && sim.rng.chance(this.calls.length === 0 ? 0.65 : 0.55);
    const gateId = fake ? (this.realGate === 'bay' ? 'garden' : 'bay') : this.realGate;
    const gate = sim.world.gates.find((g) => g.id === gateId)!;
    // A lower-tier mimic stumbles, very slightly. At the top tier, nothing gives it away.
    const stutter = fake && tier < 4;
    const text = stutter
      ? `…this is Rescue Seven, we— we hear you. Get to ${gate.label}. Two minutes. Stay… stay out of sight.`
      : `…this is Rescue Seven, we hear you. Get to ${gate.label}. Two minutes. Stay out of sight.`;
    this.calls.push({ t: sim.time, gate: gateId, fake, text });
    sim.say('RADIO', text, { voice: RESCUER, radio: true, mimic: fake, duration: 7 });
    if (this.rescueAt === null) this.rescueAt = sim.time + 100;
    if (fake) {
      const plan = sim.director.bait.radioAmbush(gate);
      if (plan) sim.director.bait.interject(plan);
    }
    sim.director.onRadio(fake);
  }

  update(): void {
    const sim = this.sim;
    if (this.rescueAt !== null && !this.arrived && sim.time >= this.rescueAt) {
      this.arrived = true;
      const gate = sim.world.gates.find((g) => g.id === this.realGate)!;
      gate.open = true;
      sim.emitNoise('gate', cellCenter(sim.level, gate.access), 55, 'world');
      sim.notice('Outside, an engine idles. Headlights sweep across a window.', 5);
    }
  }

  gateOpen(gate: Gate): boolean {
    return this.arrived && gate.id === this.realGate;
  }

  escapeThrough(gate: Gate): void {
    if (this.gateOpen(gate)) this.sim.onEscape();
  }
}
