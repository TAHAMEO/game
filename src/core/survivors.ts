import { TUNING } from './config';
import { SURVIVOR_POOL, type SurvivorDef } from './hospital';
import { cellAt, cellCenter } from './level';
import { dist, type Vec2 } from './math';
import type { Sim } from './sim';
import type { HidingSpot } from './types';

export interface Survivor {
  id: number;
  def: SurvivorDef;
  pos: Vec2;
  /** The hiding place they are in right now (null = out in the open). */
  spot: HidingSpot | null;
  home: HidingSpot | null;
  alive: boolean;
  met: boolean;
  /** How much you have invested in them. The Director weaponises this [X]. */
  attachment: number;
  talkIndex: number;
  waving: boolean;
  diedAt: number;
  private_: { nextNoise: number; nextCall: number; threatSince: number; playerNearDuringThreat: boolean; awaySince: number; lastWave: number; askedBattery: boolean };
}

const L = TUNING.loudness;

/**
 * L-lite survivors and X. FALSE COMPANY. Survivors are real people who hide, cough,
 * call for help and can die. Once the Entity has learned there are others, it learns
 * to wear them — and it prefers the ones you cared about.
 */
export class Survivors {
  readonly list: Survivor[] = [];

  constructor(private readonly sim: Sim) {
    if (!sim.features.survivors) return;
    const rng = sim.rng;
    const pool = rng.shuffle([...SURVIVOR_POOL]);
    const markers = rng.shuffle([...sim.level.markers.survivor]);
    for (let i = 0; i < Math.min(2, markers.length, pool.length); i++) {
      const m = markers[i]!;
      const mp = cellCenter(sim.level, m);
      const spots = sim.world.spots
        .filter((s) => !s.occupant && !(s.kind === 'bed' && s.cluttered) && dist(cellCenter(sim.level, s.access), mp) < 4.5)
        .sort((a, b) => dist(cellCenter(sim.level, a.access), mp) - dist(cellCenter(sim.level, b.access), mp));
      const home = spots[0] ?? null;
      const sv: Survivor = {
        id: i,
        def: pool[i]!,
        pos: home ? cellCenter(sim.level, home.access) : mp,
        spot: home,
        home,
        alive: true,
        met: false,
        attachment: 0,
        talkIndex: 0,
        waving: false,
        diedAt: -1,
        private_: { nextNoise: rng.range(20, 60), nextCall: 0, threatSince: -1, playerNearDuringThreat: false, awaySince: -1, lastWave: -99, askedBattery: false },
      };
      if (home) home.occupant = { kind: 'survivor', id: i };
      this.list.push(sv);
    }
  }

  canTalk(sv: Survivor): boolean {
    return sv.alive && !sv.spot;
  }

  private voice(sv: Survivor) {
    return { pitch: sv.def.pitch, rate: sv.def.rate };
  }

  update(dt: number): void {
    const sim = this.sim;
    const ent = sim.entity;
    const pl = sim.player;
    for (const sv of this.list) {
      if (!sv.alive) continue;
      const p = sv.private_;
      const dEnt = dist(ent.pos, sv.pos);
      const dPl = dist(pl.pos, sv.pos);
      const threatened = ent.threatening && dEnt < 6 && ent.stateKind !== 'chase';

      // Real calls for help. Ignore them and they die [X].
      if (threatened) {
        if (p.threatSince < 0) p.threatSince = sim.time;
        if (dPl < 9) p.playerNearDuringThreat = true;
        if (sim.time >= p.nextCall) {
          p.nextCall = sim.time + 5;
          this.speak(sv, sv.met ? `${sim.player.name.split(' ').pop()}! Help — it's here!` : 'Help! Someone — please — it’s here!', L.survivorCall, 'survivor');
        }
      } else if (p.threatSince >= 0 && sim.time - p.threatSince > 2) {
        if (p.playerNearDuringThreat) {
          sv.attachment += 3;
          sim.log('X', `you saved ${sv.def.name}`);
          this.speak(sv, 'You came back. You actually came back.', 12, 'survivor');
        }
        p.threatSince = -1;
        p.playerNearDuringThreat = false;
      }

      // Small noises: coughs and stifled sobs. More often when it is near.
      p.nextNoise -= dt;
      if (p.nextNoise <= 0) {
        p.nextNoise = dEnt < 10 ? sim.rng.range(12, 25) : sim.rng.range(35, 80);
        sim.emitNoise('cough', sv.pos, L.survivorCough, 'survivor', { speaker: sv.id });
      }

      if (sv.spot) {
        // A real survivor will sometimes lean out and wave you over — exactly like the mimic does.
        if (!sv.met && dPl < 11 && dPl > 4 && sim.time - p.lastWave > 40 && sim.world.los(pl.pos, sv.pos) && sim.rng.chance(dt * 0.5)) {
          p.lastWave = sim.time;
          this.emerge(sv);
          sv.waving = true;
          this.speak(sv, 'Over here! Quick — over here!', 20, 'survivor');
        }
        continue;
      }
      // Out in the open (talking): go back into hiding when you leave or it comes.
      if (dEnt < 9 || dPl > 6) {
        if (p.awaySince < 0) p.awaySince = sim.time;
        if (dEnt < 9 || sim.time - p.awaySince > 4) this.rehide(sv);
      } else p.awaySince = -1;
      if (sv.waving && dPl < 3) sv.waving = false;
    }
  }

  private emerge(sv: Survivor): void {
    if (sv.spot) {
      sv.spot.occupant = null;
      sv.pos = cellCenter(this.sim.level, sv.spot.access);
      sv.spot = null;
    }
  }

  private rehide(sv: Survivor): void {
    sv.waving = false;
    const home = sv.home;
    if (home && !home.occupant && !home.body) {
      home.occupant = { kind: 'survivor', id: sv.id };
      sv.spot = home;
      sv.pos = cellCenter(this.sim.level, home.access);
    }
    sv.private_.awaySince = -1;
  }

  private speak(sv: Survivor, text: string, loud: number, source: 'survivor' | 'entity', mimic = false): void {
    const sim = this.sim;
    const n = sim.emitNoise('voice', sv.pos, loud, source === 'survivor' ? 'survivor' : 'entity', { speaker: sv.id });
    sim.say(sv.def.name, text, { voice: this.voice(sv), mimic, volume: Math.min(1, (n.playerLevel ?? 0) / 30), pos: sv.pos });
  }

  whisperOccupied(id: number): void {
    const sv = this.list[id]!;
    this.emerge(sv);
    this.talk(id);
  }

  talk(id: number): void {
    const sim = this.sim;
    const sv = this.list[id]!;
    if (!sv.alive) return;
    sv.met = true;
    sv.waving = false;
    const pl = sim.player;
    const p = sv.private_;
    if (p.askedBattery && pl.inv.batteries > 0) {
      pl.inv.batteries--;
      pl.inv.bottles++;
      p.askedBattery = false;
      sv.attachment += 2;
      this.say(sv, 'Thank you. Here — it’s not much. Throw it, it chases the sound. Mostly.');
      return;
    }
    const lines = this.lines(sv);
    const line = lines[Math.min(sv.talkIndex, lines.length - 1)]!;
    if (sv.talkIndex < lines.length) {
      sv.talkIndex++;
      sv.attachment += 1;
    }
    this.say(sv, line);
  }

  private say(sv: Survivor, text: string): void {
    this.sim.say(sv.def.name, text, { voice: this.voice(sv), duration: 6 });
  }

  private lines(sv: Survivor): string[] {
    const sim = this.sim;
    const fuse = sim.world.items.find((i) => i.kind === 'fuse' && i.state === 'ground');
    const zone = fuse ? sim.level.zones[sim.level.zoneOf[cellAt(sim.level, fuse.pos)]!]!.name : null;
    const out = [
      `${sv.def.name}. I was on nights. It took the others one at a time. It listens — it listens with its whole head.`,
      zone ? `There was a fuse in ${zone}. I saw it before the lights went.` : 'The breaker’s in Maintenance. Downstairs. I’m not going down there.',
      'Don’t trust the lights. It likes it when you stand in the light.',
    ];
    if (sim.player.inv.batteries > 0) {
      sv.private_.askedBattery = true;
      out.push('Have you got a battery? Please. I can’t be in the dark again.');
    }
    out.push('If you hear me calling for you… make sure it’s me.');
    return out;
  }

  kill(id: number, cause: string): void {
    const sim = this.sim;
    const sv = this.list[id]!;
    if (!sv.alive) return;
    sv.alive = false;
    sv.diedAt = sim.time;
    if (sv.spot) sv.spot.occupant = null;
    sv.spot = null;
    sv.waving = false;
    sim.emitNoise('scream', sv.pos, 60, 'survivor', { speaker: sv.id });
    sim.say(sv.def.name, '—', { voice: this.voice(sv), duration: 1.5 });
    sim.memory.data.survivorsLost.push({ name: sv.def.name, color: sv.def.color, run: sim.runNumber });
    sim.log('X', `${sv.def.name} is dead (${cause}). It has their voice now.`);
  }

  /** Dragged home to the nest [W]. */
  depositBody(id: number, at: Vec2): void {
    const sim = this.sim;
    const sv = this.list[id]!;
    sv.pos = { ...at };
    sim.world.props.push({
      id: sim.world.newId(),
      kind: 'survivorBody',
      pos: { x: at.x + sim.rng.range(-0.4, 0.4), y: at.y + sim.rng.range(-0.4, 0.4) },
      label: sv.def.name,
      examine: `${sv.def.name}. You knew them for an hour.`,
      color: sv.def.color,
    });
  }

  /** The Entity, wearing someone [X]. Identical name, identical voice. */
  mimicCall(id: number, at: Vec2): void {
    const sim = this.sim;
    const sv = this.list[id]!;
    const first = sim.player.name.split(' ').pop();
    const lines = ['Over here… please.', 'Help me. I can’t — I can’t walk.', 'Is someone there? Please.', `${first}? Is that you? Over here.`];
    let text = sim.rng.pick(lines);
    if (sim.director.tier < 3 && sim.rng.chance(0.35)) text = 'Over here… over here… over here.';
    const n = sim.emitNoise('voice', at, 40, 'entity', { speaker: sv.id });
    sim.say(sv.def.name, text, { voice: this.voice(sv), mimic: true, volume: Math.min(1, (n.playerLevel ?? 0) / 30), pos: at });
  }
}
