import { afterEach, describe, expect, it } from 'vitest';
import { InputController } from '../src/ui/input';

// Just enough DOM for the controller: event targets and a pointer-locked canvas.
const g = globalThis as unknown as Record<string, unknown>;
function fakeDom(): EventTarget {
  const target = new EventTarget();
  g.window = new EventTarget();
  g.document = Object.assign(new EventTarget(), { pointerLockElement: target });
  return target;
}
function mouse(dx: number): void {
  const e = new Event('mousemove');
  Object.defineProperty(e, 'movementX', { value: dx });
  (g.document as EventTarget).dispatchEvent(e);
}

afterEach(() => {
  delete g.window;
  delete g.document;
});

describe('input', () => {
  it('keeps mouse turning from frames that ran no fixed step (fast displays)', () => {
    const input = new InputController(fakeDom() as HTMLElement);
    input.enabled = true;
    mouse(40);
    expect(input.frame(1 / 144, 0)).toEqual([]);
    mouse(60);
    const steps = input.frame(1 / 144, 1);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.turn).toBeCloseTo(100 * input.sensitivity, 10);
    expect(input.frame(1 / 144, 1)[0]!.turn).toBe(0);
  });

  it('keeps a key press for the next frame that runs a step', () => {
    const input = new InputController(fakeDom() as HTMLElement);
    input.enabled = true;
    const down = new Event('keydown');
    Object.assign(down, { code: 'KeyF', repeat: false });
    (g.window as EventTarget).dispatchEvent(down);
    input.frame(1 / 144, 0);
    expect(input.frame(1 / 144, 1)[0]!.flashlightPressed).toBe(true);
    expect(input.frame(1 / 144, 1)[0]!.flashlightPressed).toBe(false);
  });
});
