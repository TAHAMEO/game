import { Rng } from '../core/rng';
import type { Tex } from './textures';

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): Tex {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  draw(g);
  const img = g.getImageData(0, 0, w, h);
  return { w, h, data: new Uint32Array(img.data.buffer.slice(0)) };
}

// ===================================================================== the Entity

interface Limb {
  /** Shoulder/hip angle from straight down, radians (+ = outward). */
  a: number;
  /** Elbow/knee bend, radians. */
  b: number;
}

interface FigurePose {
  back: boolean;
  headTilt: number;
  headBack: number;
  chest: number;
  mouth: number;
  armL: Limb;
  armR: Limb;
  legL: Limb;
  legR: Limb;
  crouch: number;
  lean: number;
  armsForward: number;
}

const BASE: FigurePose = {
  back: false,
  headTilt: 0,
  headBack: 0,
  chest: 0,
  mouth: 0,
  armL: { a: 0.12, b: 0.1 },
  armR: { a: 0.12, b: 0.1 },
  legL: { a: 0.06, b: 0 },
  legR: { a: 0.06, b: 0 },
  crouch: 0,
  lean: 0,
  armsForward: 0,
};

const SKIN = '#b5afa3';
const SKIN_DARK = '#6b665d';
const VOID = '#0b0a09';

function limb(g: CanvasRenderingContext2D, x: number, y: number, dir: number, l1: number, l2: number, l: Limb, side: number, w1: number, w2: number): [number, number] {
  const a1 = Math.PI / 2 - side * l.a;
  const ex = x + Math.cos(a1) * l1;
  const ey = y + Math.sin(a1) * l1;
  const a2 = a1 + side * l.b * dir;
  const hx = ex + Math.cos(a2) * l2;
  const hy = ey + Math.sin(a2) * l2;
  g.lineCap = 'round';
  g.strokeStyle = SKIN_DARK;
  g.lineWidth = w1 + 1.2;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(ex, ey);
  g.lineTo(hx, hy);
  g.stroke();
  g.strokeStyle = SKIN;
  g.lineWidth = w1;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(ex, ey);
  g.stroke();
  g.lineWidth = w2;
  g.beginPath();
  g.moveTo(ex, ey);
  g.lineTo(hx, hy);
  g.stroke();
  g.fillStyle = VOID;
  g.beginPath();
  g.arc(ex, ey, w1 * 0.35, 0, Math.PI * 2);
  g.fill();
  return [hx, hy];
}

function hand(g: CanvasRenderingContext2D, x: number, y: number, size: number, spread: number): void {
  g.strokeStyle = SKIN;
  g.lineWidth = 1.1;
  g.lineCap = 'round';
  for (let i = -2; i <= 2; i++) {
    const a = Math.PI / 2 + i * spread;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * size, y + Math.sin(a) * size);
    g.stroke();
  }
}

/** The Entity: too tall, too thin, arms that hang past the knees. 64×128, feet at the bottom. */
function figure(p: FigurePose): Tex {
  return canvasTex(64, 128, (g) => {
    const cx = 32 + p.lean * 6;
    const crouch = p.crouch;
    const hipY = 66 + crouch * 38;
    const shoulderY = 28 + crouch * 44 + p.armsForward * 2;
    const legLen = 30 * (1 - crouch * 0.35);
    // legs
    for (const [l, side] of [
      [p.legL, -1],
      [p.legR, 1],
    ] as const) {
      const hx = cx + side * 5;
      const bend = crouch > 0.3 ? { a: l.a + 0.5, b: 2.2 } : l;
      limb(g, hx, hipY, -1, legLen, legLen + 4, bend, side, 4.2, 3.2);
    }
    // torso
    const chestW = 9 + p.chest * 3;
    g.fillStyle = SKIN_DARK;
    g.beginPath();
    g.moveTo(cx - chestW - 1, shoulderY - 1);
    g.lineTo(cx + chestW + 1, shoulderY - 1);
    g.lineTo(cx + 6, hipY + 2);
    g.lineTo(cx - 6, hipY + 2);
    g.closePath();
    g.fill();
    g.fillStyle = SKIN;
    g.beginPath();
    g.moveTo(cx - chestW, shoulderY);
    g.lineTo(cx + chestW, shoulderY);
    g.lineTo(cx + 5, hipY);
    g.lineTo(cx - 5, hipY);
    g.closePath();
    g.fill();
    if (!p.back) {
      g.strokeStyle = SKIN_DARK;
      g.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const y = shoulderY + 6 + i * 4;
        g.beginPath();
        g.moveTo(cx - chestW + 2 + i, y);
        g.quadraticCurveTo(cx, y + 2, cx + chestW - 2 - i, y);
        g.stroke(); // ribs
      }
    } else {
      g.fillStyle = SKIN_DARK;
      for (let y = shoulderY + 3; y < hipY - 2; y += 4) g.fillRect(cx - 1, y, 2, 2); // spine
      g.fillRect(cx - chestW + 2, shoulderY + 4, 4, 8); // shoulder blades
      g.fillRect(cx + chestW - 6, shoulderY + 4, 4, 8);
    }
    // arms
    const armLen = 30 * (1 - crouch * 0.2);
    for (const [l, side] of [
      [p.armL, -1],
      [p.armR, 1],
    ] as const) {
      const sx = cx + side * (chestW + 1);
      if (p.armsForward > 0) {
        // foreshortened reach toward the viewer
        const tx = cx + side * (12 + p.armsForward * 6);
        const ty = shoulderY - 4 - p.armsForward * 8;
        g.strokeStyle = SKIN;
        g.lineWidth = 3.4 + p.armsForward;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(sx, shoulderY + 2);
        g.lineTo(tx, ty);
        g.stroke();
        hand(g, tx, ty, 8 + p.armsForward * 4, 0.5);
      } else {
        const [hx, hy] = limb(g, sx, shoulderY + 2, 1, armLen, armLen + 4, l, side, 3.4, 2.6);
        hand(g, hx, hy, 6, 0.28);
      }
    }
    // neck + head
    const neckTop = shoulderY - 10 + p.headBack * 3;
    g.strokeStyle = SKIN;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx, shoulderY);
    g.lineTo(cx + Math.sin(p.headTilt) * 6, neckTop);
    g.stroke();
    g.save();
    g.translate(cx + Math.sin(p.headTilt) * 6, neckTop - 6);
    g.rotate(p.headTilt);
    g.fillStyle = SKIN_DARK;
    g.beginPath();
    g.ellipse(0, 0, 6, 9 - p.headBack * 2, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = SKIN;
    g.beginPath();
    g.ellipse(0, -0.5, 5.2, 8.2 - p.headBack * 2, 0, 0, Math.PI * 2);
    g.fill();
    if (!p.back) {
      g.fillStyle = VOID;
      const ey = -2 + p.headBack * 2;
      g.beginPath();
      g.ellipse(-2.4, ey, 1.6, 2.4, 0, 0, Math.PI * 2);
      g.ellipse(2.4, ey, 1.6, 2.4, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.ellipse(0, 4 - p.headBack, 1.4 + p.mouth * 1.6, 0.8 + p.mouth * 3, 0, 0, Math.PI * 2);
      g.fill();
    } else {
      g.fillStyle = SKIN_DARK;
      g.fillRect(-1, -6, 2, 12);
    }
    g.restore();
  });
}

export type EntityFrame = 'idle' | 'walkA' | 'walkB' | 'tilt' | 'inhale' | 'lunge' | 'reach' | 'crouch' | 'feed' | 'back' | 'backWalkA' | 'backWalkB';

export function buildEntityFrames(): Record<EntityFrame, Tex> {
  const walk = (s: number, back: boolean): FigurePose => ({
    ...BASE,
    back,
    armL: { a: 0.1 + 0.25 * s, b: 0.2 },
    armR: { a: 0.1 - 0.25 * s, b: 0.2 },
    legL: { a: 0.1 + 0.22 * s, b: 0.1 },
    legR: { a: 0.1 - 0.22 * s, b: 0.1 },
  });
  return {
    idle: figure(BASE),
    walkA: figure(walk(1, false)),
    walkB: figure(walk(-1, false)),
    tilt: figure({ ...BASE, headTilt: 0.62, armL: { a: 0.08, b: 0.05 }, armR: { a: 0.2, b: 0.1 } }),
    inhale: figure({ ...BASE, headBack: 1, chest: 1, mouth: 1, armL: { a: 0.35, b: 0.2 }, armR: { a: 0.35, b: 0.2 } }),
    lunge: figure({ ...BASE, armsForward: 1, mouth: 1, lean: 0.2, chest: 0.6 }),
    reach: figure({ ...BASE, armsForward: 0.6, headTilt: 0.2 }),
    crouch: figure({ ...BASE, crouch: 1, armL: { a: 0.5, b: 0.8 }, armR: { a: 0.5, b: 0.8 }, headTilt: 0.4 }),
    feed: figure({ ...BASE, back: true, crouch: 0.8, armL: { a: 0.6, b: 1 }, armR: { a: 0.6, b: 1 } }),
    back: figure({ ...BASE, back: true }),
    backWalkA: figure(walk(1, true)),
    backWalkB: figure(walk(-1, true)),
  };
}

// ===================================================================== survivors

export function buildSurvivorFrames(color: [number, number, number]): { idle: Tex; wave: Tex; body: Tex } {
  const [r, gg, b] = color;
  const cloth = `rgb(${r},${gg},${b})`;
  const clothDark = `rgb(${r * 0.6},${gg * 0.6},${b * 0.6})`;
  const skin = '#c49a7c';
  const person = (wave: boolean) =>
    canvasTex(48, 96, (g) => {
      // legs
      g.fillStyle = '#2b2b30';
      g.fillRect(17, 56, 6, 38);
      g.fillRect(25, 56, 6, 38);
      // torso
      g.fillStyle = clothDark;
      g.fillRect(13, 27, 22, 31);
      g.fillStyle = cloth;
      g.fillRect(14, 28, 20, 29);
      // arms
      g.fillStyle = cloth;
      g.fillRect(9, 29, 5, 22);
      if (wave) {
        g.save();
        g.translate(36, 30);
        g.rotate(-2.4);
        g.fillRect(-2, 0, 5, 22);
        g.fillStyle = skin;
        g.fillRect(-2, 21, 5, 5);
        g.restore();
      } else g.fillRect(34, 29, 5, 22);
      g.fillStyle = skin;
      g.fillRect(9, 50, 5, 5);
      if (!wave) g.fillRect(34, 50, 5, 5);
      // head
      g.fillStyle = skin;
      g.beginPath();
      g.ellipse(24, 18, 7, 9, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#2a1e18';
      g.beginPath();
      g.ellipse(24, 12, 7.5, 5, 0, Math.PI, Math.PI * 2);
      g.fill();
      g.fillStyle = '#1a1412';
      g.fillRect(20, 17, 2, 2);
      g.fillRect(26, 17, 2, 2);
    });
  const body = canvasTex(64, 24, (g) => {
    g.fillStyle = 'rgba(40,10,8,0.6)';
    g.beginPath();
    g.ellipse(32, 20, 30, 4, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2b2b30';
    g.fillRect(36, 13, 24, 6);
    g.fillStyle = cloth;
    g.fillRect(12, 11, 26, 9);
    g.fillStyle = skin;
    g.beginPath();
    g.ellipse(8, 15, 6, 5, 0, 0, Math.PI * 2);
    g.fill();
  });
  return { idle: person(false), wave: person(true), body };
}

// ===================================================================== items & props

export function buildItemSprites(): Record<string, Tex> {
  const rng = new Rng(77);
  return {
    fuse: canvasTex(32, 32, (g) => {
      g.fillStyle = 'rgba(200,220,230,0.8)';
      g.fillRect(11, 8, 10, 18);
      g.fillStyle = '#c8c8c0';
      g.fillRect(10, 6, 12, 4);
      g.fillRect(10, 24, 12, 4);
      g.fillStyle = '#704020';
      g.fillRect(15, 10, 2, 14);
    }),
    key: canvasTex(32, 32, (g) => {
      g.strokeStyle = '#b02020';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(6, 4);
      g.lineTo(16, 18);
      g.lineTo(26, 4);
      g.stroke();
      g.fillStyle = '#c8a040';
      g.beginPath();
      g.arc(16, 20, 4, 0, Math.PI * 2);
      g.fill();
      g.fillRect(15, 22, 3, 9);
      g.fillRect(18, 27, 3, 2);
    }),
    battery: canvasTex(32, 32, (g) => {
      g.fillStyle = '#202020';
      g.fillRect(12, 10, 9, 18);
      g.fillStyle = '#d07010';
      g.fillRect(12, 10, 9, 6);
      g.fillStyle = '#b0b0b0';
      g.fillRect(15, 7, 3, 3);
    }),
    bottle: canvasTex(32, 32, (g) => {
      g.fillStyle = 'rgba(40,110,60,0.9)';
      g.fillRect(12, 12, 9, 18);
      g.fillRect(14, 4, 5, 9);
      g.fillStyle = 'rgba(160,220,180,0.5)';
      g.fillRect(13, 14, 2, 12);
    }),
    note: canvasTex(32, 32, (g) => {
      g.fillStyle = '#d8d2c0';
      g.save();
      g.translate(16, 22);
      g.rotate(rng.range(-0.3, 0.3));
      g.fillRect(-10, -6, 20, 12);
      g.fillStyle = '#504a40';
      for (let y = -4; y < 5; y += 3) g.fillRect(-8, y, 15, 1);
      g.restore();
    }),
    bed: canvasTex(64, 40, (g) => {
      g.fillStyle = '#4a4e52';
      g.fillRect(4, 18, 3, 22);
      g.fillRect(57, 18, 3, 22);
      g.fillRect(4, 30, 56, 3);
      g.fillStyle = '#8c9090';
      g.fillRect(2, 14, 60, 8);
      g.fillStyle = '#b8b6ac';
      g.fillRect(4, 10, 56, 8);
      g.fillStyle = '#d0ccc0';
      g.fillRect(6, 7, 14, 6);
      g.fillStyle = '#5a5e62';
      g.fillRect(2, 4, 2, 14);
      g.fillRect(60, 4, 2, 14);
    }),
    bedJunk: canvasTex(64, 40, (g) => {
      g.fillStyle = '#4a4e52';
      g.fillRect(4, 18, 3, 22);
      g.fillRect(57, 18, 3, 22);
      g.fillStyle = '#8c9090';
      g.fillRect(2, 14, 60, 8);
      g.fillStyle = '#b8b6ac';
      g.fillRect(4, 10, 56, 8);
      g.fillStyle = '#6a5440';
      g.fillRect(10, 26, 16, 14); // boxes underneath
      g.fillRect(30, 24, 20, 16);
      g.fillStyle = '#4a3a2c';
      g.fillRect(30, 30, 20, 1);
    }),
    trophy: canvasTex(32, 32, (g) => {
      for (let i = 0; i < 9; i++) {
        g.fillStyle = `rgb(${rng.int(60, 160)},${rng.int(50, 140)},${rng.int(40, 120)})`;
        g.fillRect(rng.int(4, 24), rng.int(16, 28), rng.int(3, 8), rng.int(2, 5));
      }
    }),
    debris: canvasTex(32, 20, (g) => {
      g.fillStyle = '#4a6a60';
      g.beginPath();
      g.ellipse(16, 15, 13, 5, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(60,10,8,0.7)';
      g.fillRect(10, 12, 9, 3);
    }),
    remains: canvasTex(48, 40, (g) => {
      g.fillStyle = 'rgba(40,8,6,0.7)';
      g.beginPath();
      g.ellipse(24, 37, 22, 3, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#3c4a50';
      g.fillRect(14, 16, 18, 20);
      g.fillStyle = '#9a8270';
      g.beginPath();
      g.ellipse(22, 12, 6, 7, 0.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#d0d0c0';
      g.fillRect(26, 22, 5, 4); // the badge
      g.fillStyle = '#2a2a30';
      g.fillRect(16, 34, 20, 4);
    }),
    sign: canvasTex(32, 48, (g) => {
      g.fillStyle = '#3c3026';
      g.fillRect(4, 6, 24, 40);
      g.strokeStyle = 'rgba(190,180,160,0.7)';
      g.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        g.beginPath();
        const x = rng.int(6, 24);
        const y = rng.int(8, 30);
        g.moveTo(x, y);
        g.lineTo(x + rng.int(-4, 4), y + rng.int(6, 14));
        g.stroke();
      }
    }),
    fog: canvasTex(32, 32, (g) => {
      const grd = g.createRadialGradient(16, 16, 1, 16, 16, 15);
      grd.addColorStop(0, 'rgba(230,236,240,0.55)');
      grd.addColorStop(1, 'rgba(230,236,240,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 32, 32);
    }),
  };
}
