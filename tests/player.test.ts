import { describe, expect, it } from 'vitest';
import type { Item } from '../src/core/types';
import { makeSim, sedateEntity, step } from './helpers';

describe('player', () => {
  it('keeps a note open while you stand still and puts it down when you walk off', () => {
    const sim = makeSim({ seed: 3 });
    sedateEntity(sim);
    const note = sim.world.items.find((i) => i.kind === 'note')!;
    (sim.player as unknown as { pickup(i: Item): void }).pickup(note);
    expect(sim.player.readingNote).toBe(note.noteId);

    step(sim, 2);
    expect(sim.player.readingNote).toBe(note.noteId);

    step(sim, 1, { forward: 1 });
    expect(sim.player.readingNote).toBeNull();
  });
});
