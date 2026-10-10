import { idleInput, type InputState } from '../core/input';

const GAME_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'KeyC',
  'KeyE',
  'KeyF',
  'KeyG',
  'Space',
  'KeyQ',
]);

/**
 * Keyboard + mouse. Mouse-look uses pointer lock when the page allows it; the arrow
 * keys (and Q/E-free turning with ←/→) work everywhere, including sandboxed iframes.
 */
export class InputController {
  private keys = new Set<string>();
  private edges = new Set<string>();
  private mouseDX = 0;
  private rightClick = false;
  crouchToggled = false;
  sensitivity = 0.0024;
  invertTurn = false;
  enabled = false;
  /** Fired for non-game keys (menus, overlays). */
  onKey: (code: string, e: KeyboardEvent) => void = () => {};

  constructor(private readonly target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat && GAME_KEYS.has(e.code)) {
        e.preventDefault();
        return;
      }
      if (this.enabled && GAME_KEYS.has(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.edges.add(e.code);
      this.keys.add(e.code);
      if (e.code === 'KeyC' && this.enabled) this.crouchToggled = !this.crouchToggled;
      this.onKey(e.code, e);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === this.target && this.enabled) this.mouseDX += e.movementX;
    });
    target.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (e.button === 2) this.rightClick = true;
      if (document.pointerLockElement !== this.target) this.lock();
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  lock(): void {
    try {
      const p = this.target.requestPointerLock() as unknown;
      if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => {});
    } catch {
      /* pointer lock unavailable (e.g. sandboxed iframe) — keyboard turning still works */
    }
  }

  unlock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  get locked(): boolean {
    return document.pointerLockElement === this.target;
  }

  /** Sample everything accumulated since the last frame, split into `steps` fixed steps. */
  frame(dt: number, steps: number): InputState[] {
    const k = this.keys;
    const base = idleInput();
    if (!this.enabled) {
      this.edges.clear();
      this.mouseDX = 0;
      this.rightClick = false;
      return Array.from({ length: steps }, () => ({ ...base }));
    }
    base.forward = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    base.strafe = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    base.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    base.crouch = this.crouchToggled || k.has('ControlLeft');
    base.interact = k.has('KeyE');
    base.holdBreath = k.has('Space');
    const keyTurn = ((k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0)) * 2.4 * dt;
    let turn = this.mouseDX * this.sensitivity + keyTurn;
    if (this.invertTurn) turn = -turn;
    this.mouseDX = 0;
    const out: InputState[] = [];
    for (let i = 0; i < steps; i++) {
      const s = { ...base, turn: turn / Math.max(1, steps) };
      if (i === 0) {
        s.interactPressed = this.edges.has('KeyE');
        s.flashlightPressed = this.edges.has('KeyF');
        s.throwPressed = this.edges.has('KeyG') || this.rightClick;
      }
      out.push(s);
    }
    if (steps > 0) {
      this.edges.clear();
      this.rightClick = false;
    }
    return out;
  }

  clear(): void {
    this.keys.clear();
    this.edges.clear();
    this.mouseDX = 0;
  }
}
