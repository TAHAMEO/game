import { cellCenter, cellDistance, Tile } from './level';
import { KNOWLEDGE_SIGNS } from './persistence';
import type { Sim } from './sim';

/**
 * W. THE NEST — WHAT IT KEEPS. The nest is where the game stores its memory of you:
 * trophies from past runs, survivors it took, signs of behaviours it has practised,
 * and — once it knows you well enough — the body of who you were last time.
 */
export function dressNest(sim: Sim): void {
  const { level, world, memory } = sim;
  const data = memory.data;
  const nestRegion = level.regions.find((r) => r.kind === 'nest');
  if (!nestRegion) return;
  const entrance = nestRegion.links[0] ? level.regions[nestRegion.links[0].region]!.center : nestRegion.center;
  // Deeper cells first: the hoard grows from the back wall toward the entrance.
  const cells = nestRegion.cells
    .filter((c) => level.tiles[c] === Tile.Floor)
    .sort((a, b) => cellDistance(level, b, entrance) - cellDistance(level, a, entrance));
  let slot = 0;
  const place = () => {
    const c = cells[slot % cells.length]!;
    const ring = Math.floor(slot / cells.length);
    slot++;
    const p = cellCenter(level, c);
    return { x: p.x + sim.rng.range(-0.3, 0.3) * (1 + ring * 0.2), y: p.y + sim.rng.range(-0.3, 0.3) * (1 + ring * 0.2) };
  };

  if (sim.features.nestTrophies) {
    for (const key of Object.keys(data.learned)) {
      const sign = KNOWLEDGE_SIGNS[key];
      if (!sign) continue;
      world.props.push({ id: world.newId(), kind: 'sign', pos: place(), label: sign.label, examine: sign.examine });
    }
    for (const s of data.survivorsLost.slice(-8)) {
      world.props.push({
        id: world.newId(),
        kind: 'survivorBody',
        pos: place(),
        label: s.name,
        examine: s.run === sim.runNumber - 1 ? `${s.name}. Fresh.` : `${s.name}. It has had them a while.`,
        color: s.color,
      });
    }
    const trophies = data.trophies.slice(-24);
    for (const t of trophies) {
      const age = sim.runNumber - t.run;
      world.props.push({
        id: world.newId(),
        kind: t.kind === 'debris' ? 'debris' : 'trophy',
        pos: place(),
        label: t.label,
        examine: age <= 1 ? `${t.label}. Still warm from the last one who carried it.` : `${t.label}. Dust has settled on it. ${age} lives ago.`,
      });
    }
  }

  const last = data.lastCharacter;
  if (sim.features.ownRemains && last && sim.director.tier >= 2) {
    const text = `${last.name}. ${last.cause} The badge is yours. Was yours.`;
    const spot = last.spot !== null ? world.spots[last.spot] : undefined;
    if (spot && spot.kind !== 'bed' && !spot.occupant && sim.rng.chance(0.5)) {
      spot.body = `Someone is already in here, propped upright. ${text}`;
      sim.log('W', `your previous body is propped in a ${spot.kind}`);
    } else {
      world.props.push({ id: world.newId(), kind: 'remains', pos: place(), label: 'a body', examine: `Dragged here. ${text} It kept you.` });
      sim.log('W', 'your previous body is in the nest');
    }
  }
}
