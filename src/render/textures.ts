import { Rng } from '../core/rng';

/** Pixel data packed as little-endian ABGR (the layout of ImageData viewed as Uint32). */
export interface Tex {
  w: number;
  h: number;
  data: Uint32Array;
}

type Draw = (g: CanvasRenderingContext2D, rng: Rng, w: number, h: number) => void;

function make(w: number, h: number, seed: number, draw: Draw): Tex {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingEnabled = false;
  draw(g, new Rng(seed), w, h);
  const img = g.getImageData(0, 0, w, h);
  return { w, h, data: new Uint32Array(img.data.buffer.slice(0)) };
}

const rgb = (r: number, g: number, b: number, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;

function speckle(g: CanvasRenderingContext2D, rng: Rng, w: number, h: number, n: number, dark: number, light: number): void {
  for (let i = 0; i < n; i++) {
    const v = rng.chance(0.5) ? dark : light;
    g.fillStyle = `rgba(${v},${v},${v},${rng.range(0.05, 0.18)})`;
    g.fillRect(rng.int(0, w - 1), rng.int(0, h - 1), 1, 1);
  }
}

function stains(g: CanvasRenderingContext2D, rng: Rng, w: number, h: number, n: number, col: string): void {
  for (let i = 0; i < n; i++) {
    const x = rng.int(0, w - 1);
    const y = rng.int(0, Math.floor(h * 0.6));
    const len = rng.int(6, h - y);
    const grd = g.createLinearGradient(0, y, 0, y + len);
    grd.addColorStop(0, col);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x, y, rng.int(1, 3), len);
  }
}

// ======================================================================= walls

const plaster: Draw = (g, rng, w, h) => {
  g.fillStyle = rgb(128, 124, 108);
  g.fillRect(0, 0, w, h);
  // dado: institutional green tiles on the lower 40%
  const dado = Math.floor(h * 0.6);
  g.fillStyle = rgb(78, 98, 84);
  g.fillRect(0, dado, w, h - dado);
  g.fillStyle = rgb(60, 76, 66);
  for (let x = 0; x < w; x += 8) g.fillRect(x, dado, 1, h - dado);
  for (let y = dado; y < h; y += 8) g.fillRect(0, y, w, 1);
  g.fillStyle = rgb(52, 58, 52);
  g.fillRect(0, dado - 2, w, 2);
  g.fillStyle = rgb(40, 40, 36);
  g.fillRect(0, h - 3, w, 3);
  speckle(g, rng, w, h, 500, 40, 200);
  stains(g, rng, w, h, 5, 'rgba(70,60,40,0.35)');
};

const tile: Draw = (g, rng, w, h) => {
  g.fillStyle = rgb(176, 184, 178);
  g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 8) {
    for (let x = 0; x < w; x += 8) {
      const v = rng.range(-10, 10);
      g.fillStyle = rgb(176 + v, 184 + v, 178 + v);
      g.fillRect(x + 1, y + 1, 7, 7);
    }
  }
  g.fillStyle = rgb(110, 118, 112);
  for (let x = 0; x < w; x += 8) g.fillRect(x, 0, 1, h);
  for (let y = 0; y < h; y += 8) g.fillRect(0, y, w, 1);
  const grd = g.createLinearGradient(0, h * 0.5, 0, h);
  grd.addColorStop(0, 'rgba(60,50,30,0)');
  grd.addColorStop(1, 'rgba(60,50,30,0.45)');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(40,40,40,0.6)';
  g.beginPath();
  const cx = rng.int(10, 50);
  g.moveTo(cx, 10);
  g.lineTo(cx + 4, 18);
  g.lineTo(cx + 2, 26);
  g.stroke();
  stains(g, rng, w, h, 3, 'rgba(90,70,40,0.3)');
};

const concrete: Draw = (g, rng, w, h) => {
  g.fillStyle = rgb(88, 88, 84);
  g.fillRect(0, 0, w, h);
  speckle(g, rng, w, h, 1400, 30, 160);
  g.fillStyle = rgba(0, 0, 0, 0.18);
  for (let y = 0; y < h; y += 21) g.fillRect(0, y, w, 1);
  // pipe band
  g.fillStyle = rgb(70, 64, 58);
  g.fillRect(0, 12, w, 5);
  g.fillStyle = rgb(110, 100, 86);
  g.fillRect(0, 12, w, 1);
  g.fillStyle = rgb(50, 46, 40);
  g.fillRect(28, 10, 4, 9);
  stains(g, rng, w, h, 6, 'rgba(40,30,20,0.4)');
};

function rgba(r: number, gg: number, b: number, a: number): string {
  return rgb(r, gg, b, a);
}

const brick: Draw = (g, rng, w, h) => {
  g.fillStyle = rgb(48, 36, 32);
  g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 8) {
    const off = (y / 8) % 2 ? 8 : 0;
    for (let x = -8; x < w; x += 16) {
      const v = rng.range(-12, 12);
      g.fillStyle = rgb(92 + v, 52 + v * 0.5, 42 + v * 0.4);
      g.fillRect(x + off + 1, y + 1, 15, 7);
    }
  }
  const grd = g.createLinearGradient(0, h * 0.7, 0, h);
  grd.addColorStop(0, 'rgba(30,50,25,0)');
  grd.addColorStop(1, 'rgba(30,50,25,0.7)');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  speckle(g, rng, w, h, 300, 20, 120);
};

const wallpaper: Draw = (g, rng, w, h) => {
  g.fillStyle = rgb(104, 88, 70);
  g.fillRect(0, 0, w, h);
  g.fillStyle = rgb(84, 70, 56);
  for (let y = 0; y < h; y += 12) {
    for (let x = (y / 12) % 2 ? 6 : 0; x < w; x += 12) {
      g.beginPath();
      g.arc(x + 3, y + 4, 2.2, 0, Math.PI * 2);
      g.fill();
      g.fillRect(x + 2, y + 6, 2, 4);
    }
  }
  // peeling patches
  for (let i = 0; i < 4; i++) {
    const x = rng.int(0, w - 16);
    const y = rng.int(0, h - 20);
    g.fillStyle = rgb(150, 140, 120);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + rng.int(8, 16), y + rng.int(0, 6));
    g.lineTo(x + rng.int(4, 12), y + rng.int(10, 20));
    g.closePath();
    g.fill();
  }
  stains(g, rng, w, h, 8, 'rgba(30,20,10,0.5)');
  speckle(g, rng, w, h, 400, 20, 160);
};

const nestWall: Draw = (g, rng, w, h) => {
  g.fillStyle = rgb(34, 28, 26);
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 24; i++) {
    g.strokeStyle = rgba(70, 50, 44, rng.range(0.3, 0.7));
    g.lineWidth = rng.range(0.6, 2);
    g.beginPath();
    const x = rng.int(0, w);
    g.moveTo(x, rng.int(0, h));
    g.bezierCurveTo(x + rng.range(-10, 10), rng.int(0, h), x + rng.range(-10, 10), rng.int(0, h), x + rng.range(-6, 6), rng.int(0, h));
    g.stroke();
  }
  // claw scratches in threes
  for (let k = 0; k < 3; k++) {
    const x = rng.int(6, w - 14);
    const y = rng.int(4, h - 30);
    g.strokeStyle = rgba(150, 140, 130, 0.5);
    g.lineWidth = 1;
    for (let j = 0; j < 3; j++) {
      g.beginPath();
      g.moveTo(x + j * 3, y);
      g.lineTo(x + j * 3 + 5, y + 22);
      g.stroke();
    }
  }
  stains(g, rng, w, h, 10, 'rgba(10,6,4,0.6)');
};

const door: Draw = (g, rng, w, h) => {
  g.fillStyle = rgb(40, 44, 46);
  g.fillRect(0, 0, w, h);
  g.fillStyle = rgb(104, 116, 122);
  g.fillRect(4, 2, w - 8, h - 2);
  g.fillStyle = rgb(18, 22, 26);
  g.fillRect(20, 10, 24, 14); // window
  g.fillStyle = rgba(120, 140, 160, 0.25);
  g.fillRect(21, 11, 6, 12);
  g.fillStyle = rgb(150, 156, 160);
  g.fillRect(44, 32, 10, 3); // push plate
  g.fillStyle = rgb(80, 86, 90);
  g.fillRect(4, h - 12, w - 8, 10); // kick plate
  speckle(g, rng, w, h, 250, 30, 200);
  stains(g, rng, w, h, 2, 'rgba(60,50,40,0.35)');
};

const doorLocked: Draw = (g, rng, w, h) => {
  door(g, rng, w, h);
  g.fillStyle = rgb(170, 30, 26);
  g.fillRect(14, 30, 36, 12);
  g.fillStyle = rgb(230, 225, 215);
  for (let x = 17; x < 48; x += 4) g.fillRect(x, 34, 2, 4);
  g.fillStyle = rgb(60, 60, 60);
  g.fillRect(48, 36, 6, 6); // padlock hasp
};

const locker: Draw = (g, rng, w, h) => {
  g.fillStyle = rgb(30, 34, 32);
  g.fillRect(0, 0, w, h);
  for (const x0 of [2, 33]) {
    g.fillStyle = rgb(86, 104, 94);
    g.fillRect(x0, 2, 29, h - 4);
    g.fillStyle = rgb(40, 48, 44);
    for (let y = 8; y < 22; y += 3) g.fillRect(x0 + 6, y, 17, 1); // slats
    g.fillStyle = rgb(160, 160, 150);
    g.fillRect(x0 + 22, 30, 3, 8); // handle
    g.fillStyle = rgb(200, 196, 180);
    g.fillRect(x0 + 10, 4, 8, 3); // number plate
  }
  speckle(g, rng, w, h, 300, 30, 190);
  stains(g, rng, w, h, 3, 'rgba(70,50,30,0.35)');
};

const lockerAjar: Draw = (g, rng, w, h) => {
  locker(g, rng, w, h);
  g.fillStyle = rgb(4, 4, 6);
  g.fillRect(33, 2, 10, h - 4);
  g.fillStyle = rgb(120, 140, 128);
  g.fillRect(43, 2, 2, h - 4); // the door edge catching light
};

const drawer: Draw = (g, rng, w, h) => {
  g.fillStyle = rgb(60, 64, 66);
  g.fillRect(0, 0, w, h);
  for (const [x, y] of [
    [2, 2],
    [33, 2],
    [2, 33],
    [33, 33],
  ] as const) {
    const grd = g.createLinearGradient(x, y, x + 29, y + 29);
    grd.addColorStop(0, rgb(170, 176, 178));
    grd.addColorStop(1, rgb(110, 116, 120));
    g.fillStyle = grd;
    g.fillRect(x, y, 29, 29);
    g.fillStyle = rgb(70, 74, 76);
    g.fillRect(x + 9, y + 13, 11, 3);
    g.fillStyle = rgb(230, 230, 220);
    g.fillRect(x + 3, y + 3, 7, 4); // name card
  }
  speckle(g, rng, w, h, 200, 40, 220);
};

const vent: Draw = (g, rng, w, h) => {
  plaster(g, rng, w, h);
  g.fillStyle = rgb(40, 42, 40);
  g.fillRect(12, 18, 40, 22);
  g.fillStyle = rgb(120, 122, 116);
  g.fillRect(12, 18, 40, 2);
  g.fillRect(12, 38, 40, 2);
  g.fillRect(12, 18, 2, 22);
  g.fillRect(50, 18, 2, 22);
  for (let y = 22; y < 38; y += 3) {
    g.fillStyle = rgb(96, 98, 92);
    g.fillRect(14, y, 36, 1);
  }
  g.fillStyle = rgb(8, 8, 8);
  g.fillRect(14, 21, 36, 1);
};

const tap: Draw = (g, rng, w, h) => {
  tile(g, rng, w, h);
  g.fillStyle = rgb(210, 214, 210);
  g.fillRect(14, 30, 36, 12);
  g.fillStyle = rgb(150, 154, 150);
  g.fillRect(16, 31, 32, 3);
  g.fillStyle = rgb(170, 170, 176);
  g.fillRect(30, 22, 4, 9); // spout
  g.fillRect(26, 22, 12, 2);
  g.fillStyle = rgb(120, 120, 130);
  g.fillRect(31, 42, 2, 18); // pipe
};

const fusebox: Draw = (g, rng, w, h) => {
  concrete(g, rng, w, h);
  g.fillStyle = rgb(110, 112, 108);
  g.fillRect(10, 14, 44, 40);
  g.fillStyle = rgb(70, 72, 70);
  g.fillRect(12, 16, 40, 36);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      g.fillStyle = rgb(30, 30, 30);
      g.fillRect(16 + c * 9, 20 + r * 10, 6, 7);
      g.fillStyle = rgb(190, 180, 150);
      g.fillRect(17 + c * 9, 21 + r * 10, 4, 3);
    }
  }
  g.fillStyle = rgb(200, 170, 30);
  for (let x = 10; x < 54; x += 6) g.fillRect(x, 54, 3, 4);
};

const radio: Draw = (g, rng, w, h) => {
  plaster(g, rng, w, h);
  g.fillStyle = rgb(36, 38, 36);
  g.fillRect(6, 24, 52, 26);
  g.fillStyle = rgb(24, 60, 40);
  g.fillRect(10, 28, 22, 10); // display
  g.fillStyle = rgb(60, 140, 90);
  g.fillRect(12, 32, 8, 1);
  for (const x of [38, 47]) {
    g.fillStyle = rgb(150, 150, 140);
    g.beginPath();
    g.arc(x + 3, 33, 4, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = rgb(20, 20, 20);
  g.fillRect(10, 42, 44, 4); // speaker grille
  g.fillStyle = rgb(60, 60, 60);
  g.fillRect(44, 14, 3, 10); // mic stalk
  g.fillRect(41, 12, 9, 4);
};

const gate: Draw = (g, _rng, w, h) => {
  g.fillStyle = rgb(6, 8, 14);
  g.fillRect(0, 0, w, h);
  g.fillStyle = rgb(16, 20, 30);
  g.fillRect(0, h * 0.55, w, h * 0.45);
  for (let x = 2; x < w; x += 7) {
    g.fillStyle = rgb(54, 54, 58);
    g.fillRect(x, 0, 2, h);
  }
  g.fillRect(0, 8, w, 3);
  g.fillRect(0, h - 12, w, 3);
  g.fillStyle = rgb(130, 120, 100);
  for (let y = 26; y < 44; y += 3) g.fillRect(28 + ((y / 3) % 2), y, 6, 2); // chain
  g.fillStyle = rgb(150, 120, 60);
  g.fillRect(27, 42, 8, 7); // padlock
};

const gateOpen: Draw = (g, rng, w, h) => {
  const grd = g.createRadialGradient(w / 2, h * 0.6, 2, w / 2, h * 0.6, w * 0.7);
  grd.addColorStop(0, rgb(255, 250, 220));
  grd.addColorStop(0.4, rgb(180, 160, 110));
  grd.addColorStop(1, rgb(20, 20, 26));
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  for (let x = 2; x < 14; x += 7) {
    g.fillStyle = rgb(30, 30, 30);
    g.fillRect(x, 0, 2, h);
  }
  void rng;
};

const windowTex: Draw = (g, rng, w, h) => {
  plaster(g, rng, w, h);
  g.fillStyle = rgb(60, 58, 52);
  g.fillRect(8, 8, 48, 34);
  const grd = g.createLinearGradient(0, 10, 0, 40);
  grd.addColorStop(0, rgb(18, 24, 40));
  grd.addColorStop(1, rgb(8, 10, 16));
  g.fillStyle = grd;
  g.fillRect(10, 10, 44, 30);
  g.fillStyle = rgb(60, 58, 52);
  g.fillRect(31, 10, 2, 30);
  g.fillRect(10, 24, 44, 2);
  for (let i = 0; i < 12; i++) {
    g.fillStyle = rgba(140, 160, 200, rng.range(0.1, 0.3));
    g.fillRect(rng.int(10, 53), rng.int(10, 30), 1, rng.int(3, 9)); // rain on glass
  }
};

const shelves: Draw = (g, rng, w, h) => {
  g.fillStyle = rgb(44, 40, 36);
  g.fillRect(0, 0, w, h);
  for (let y = 4; y < h; y += 15) {
    g.fillStyle = rgb(90, 80, 66);
    g.fillRect(0, y + 12, w, 3);
    for (let x = 2; x < w - 4; ) {
      const bw = rng.int(4, 12);
      const v = rng.range(-20, 20);
      g.fillStyle = rgb(140 + v, 120 + v, 90 + v);
      g.fillRect(x, y + rng.int(1, 4), bw - 1, 12 - rng.int(0, 3));
      x += bw;
    }
  }
};

const hedge: Draw = (g, rng, w, h) => {
  g.fillStyle = rgb(14, 24, 14);
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 600; i++) {
    const v = rng.range(0, 30);
    g.fillStyle = rgb(20 + v, 40 + v, 20 + v * 0.6);
    g.fillRect(rng.int(0, w), rng.int(0, h), rng.int(1, 3), rng.int(1, 3));
  }
};

const vehicle: Draw = (g, rng, w, h) => {
  g.fillStyle = rgb(170, 172, 168);
  g.fillRect(0, 0, w, h);
  g.fillStyle = rgb(150, 30, 30);
  g.fillRect(0, 30, w, 6);
  g.fillStyle = rgb(30, 40, 50);
  g.fillRect(6, 8, 22, 14);
  g.fillStyle = rgb(40, 40, 40);
  g.beginPath();
  g.arc(16, h - 4, 7, 0, Math.PI * 2);
  g.arc(48, h - 4, 7, 0, Math.PI * 2);
  g.fill();
  speckle(g, rng, w, h, 300, 60, 220);
  stains(g, rng, w, h, 4, 'rgba(60,50,40,0.4)');
};

const machinery: Draw = (g, rng, w, h) => {
  g.fillStyle = rgb(60, 56, 50);
  g.fillRect(0, 0, w, h);
  g.fillStyle = rgb(90, 70, 50);
  g.beginPath();
  g.arc(32, 30, 20, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = rgb(50, 40, 30);
  g.beginPath();
  g.arc(32, 30, 12, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = rgb(120, 110, 90);
  g.fillRect(0, 54, w, 4);
  speckle(g, rng, w, h, 400, 30, 180);
};

// ======================================================================= floors & ceilings

const lino: Draw = (g, rng, w, h) => {
  for (let y = 0; y < h; y += 16) {
    for (let x = 0; x < w; x += 16) {
      const dark = ((x + y) / 16) % 2 === 0;
      g.fillStyle = dark ? rgb(96, 104, 94) : rgb(122, 128, 116);
      g.fillRect(x, y, 16, 16);
    }
  }
  speckle(g, rng, w, h, 700, 40, 180);
  for (let i = 0; i < 6; i++) {
    g.strokeStyle = rgba(40, 40, 36, 0.3);
    g.beginPath();
    const x = rng.int(0, w);
    const y = rng.int(0, h);
    g.moveTo(x, y);
    g.lineTo(x + rng.int(-14, 14), y + rng.int(-4, 4));
    g.stroke();
  }
};

const floorTile: Draw = (g, rng, w, h) => {
  g.fillStyle = rgb(150, 156, 152);
  g.fillRect(0, 0, w, h);
  g.fillStyle = rgb(100, 106, 102);
  for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 1, h);
  for (let y = 0; y < h; y += 16) g.fillRect(0, y, w, 1);
  g.fillStyle = rgb(60, 66, 64);
  g.beginPath();
  g.arc(32, 32, 3, 0, Math.PI * 2); // drain
  g.fill();
  speckle(g, rng, w, h, 500, 50, 200);
  stains(g, rng, w, h, 2, 'rgba(70,50,30,0.25)');
};

const concreteFloor: Draw = (g, rng, w, h) => {
  g.fillStyle = rgb(74, 74, 70);
  g.fillRect(0, 0, w, h);
  speckle(g, rng, w, h, 1500, 20, 150);
  g.fillStyle = rgba(0, 0, 0, 0.25);
  g.fillRect(0, 31, w, 1);
  g.fillRect(31, 0, 1, h);
};

const gravel: Draw = (g, rng, w, h) => {
  g.fillStyle = rgb(44, 44, 44);
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) {
    const v = rng.range(30, 110);
    g.fillStyle = rgb(v, v, v * 0.95);
    g.fillRect(rng.int(0, w), rng.int(0, h), rng.int(1, 2), rng.int(1, 2));
  }
};

const grass: Draw = (g, rng, w, h) => {
  g.fillStyle = rgb(24, 32, 20);
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) {
    const v = rng.range(0, 40);
    g.fillStyle = rgb(26 + v * 0.6, 40 + v, 22 + v * 0.4);
    g.fillRect(rng.int(0, w), rng.int(0, h), 1, rng.int(1, 3));
  }
};

const boards: Draw = (g, rng, w, h) => {
  for (let x = 0; x < w; x += 8) {
    const v = rng.range(-14, 14);
    g.fillStyle = rgb(78 + v, 60 + v, 44 + v);
    g.fillRect(x, 0, 8, h);
    g.fillStyle = rgb(36, 26, 20);
    g.fillRect(x, 0, 1, h);
    g.fillRect(x, rng.int(0, h), 8, 1);
  }
  speckle(g, rng, w, h, 400, 20, 140);
};

const nestFloor: Draw = (g, rng, w, h) => {
  g.fillStyle = rgb(30, 24, 22);
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = rgba(rng.range(120, 180), rng.range(110, 160), rng.range(90, 130), rng.range(0.3, 0.7));
    g.fillRect(rng.int(0, w), rng.int(0, h), rng.int(2, 7), 1); // bone splinters
  }
  for (let i = 0; i < 10; i++) {
    g.fillStyle = rgba(60, 20, 16, rng.range(0.3, 0.6));
    g.beginPath();
    g.arc(rng.int(0, w), rng.int(0, h), rng.range(2, 6), 0, Math.PI * 2);
    g.fill();
  }
};

const ceilTile: Draw = (g, rng, w, h) => {
  g.fillStyle = rgb(150, 150, 140);
  g.fillRect(0, 0, w, h);
  speckle(g, rng, w, h, 900, 80, 200);
  g.fillStyle = rgb(90, 90, 86);
  g.fillRect(0, 0, w, 2);
  g.fillRect(0, 0, 2, h);
  g.fillRect(0, 32, w, 2);
  g.fillRect(32, 0, 2, h);
  if (rng.chance(0.9)) {
    const grd = g.createRadialGradient(44, 44, 1, 44, 44, 14);
    grd.addColorStop(0, 'rgba(110,80,40,0.5)');
    grd.addColorStop(1, 'rgba(110,80,40,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  }
};

const ceilConcrete: Draw = (g, rng, w, h) => {
  g.fillStyle = rgb(60, 60, 58);
  g.fillRect(0, 0, w, h);
  speckle(g, rng, w, h, 1200, 20, 120);
};

const sky: Draw = (g, rng, w, h) => {
  g.fillStyle = rgb(6, 8, 16);
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 6; i++) {
    g.fillStyle = rgba(200, 210, 255, rng.range(0.3, 0.9));
    g.fillRect(rng.int(0, w), rng.int(0, h), 1, 1);
  }
};

// ======================================================================= texture sets

export interface TextureSet {
  walls: Record<string, Tex>;
  floors: Record<string, Tex>;
  ceilings: Record<string, Tex>;
}

export function buildTextures(): TextureSet {
  const S = 64;
  const walls: Record<string, Tex> = {
    plaster: make(S, S, 1, plaster),
    tile: make(S, S, 2, tile),
    concrete: make(S, S, 3, concrete),
    brick: make(S, S, 4, brick),
    wallpaper: make(S, S, 5, wallpaper),
    nest: make(S, S, 6, nestWall),
    door: make(S, S, 7, door),
    doorLocked: make(S, S, 8, doorLocked),
    locker: make(S, S, 9, locker),
    lockerAjar: make(S, S, 10, lockerAjar),
    drawer: make(S, S, 11, drawer),
    vent: make(S, S, 12, vent),
    tap: make(S, S, 13, tap),
    fusebox: make(S, S, 14, fusebox),
    radio: make(S, S, 15, radio),
    gate: make(S, S, 16, gate),
    gateOpen: make(S, S, 17, gateOpen),
    window: make(S, S, 18, windowTex),
    shelves: make(S, S, 19, shelves),
    hedge: make(S, S, 20, hedge),
    vehicle: make(S, S, 21, vehicle),
    machinery: make(S, S, 22, machinery),
  };
  const floors: Record<string, Tex> = {
    lino: make(S, S, 31, lino),
    tile: make(S, S, 32, floorTile),
    concrete: make(S, S, 33, concreteFloor),
    gravel: make(S, S, 34, gravel),
    grass: make(S, S, 35, grass),
    boards: make(S, S, 36, boards),
    nest: make(S, S, 37, nestFloor),
  };
  const ceilings: Record<string, Tex> = {
    tile: make(S, S, 41, ceilTile),
    concrete: make(S, S, 42, ceilConcrete),
    sky: make(S, S, 43, sky),
  };
  return { walls, floors, ceilings };
}

/** Zone key → wall / floor / ceiling texture names. */
export const ZONE_MATERIALS: Record<string, { wall: string; floor: string; ceil: string }> = {
  n: { wall: 'nest', floor: 'nest', ceil: 'concrete' },
  o: { wall: 'wallpaper', floor: 'boards', ceil: 'tile' },
  u: { wall: 'tile', floor: 'tile', ceil: 'tile' },
  h: { wall: 'plaster', floor: 'lino', ceil: 'tile' },
  s: { wall: 'plaster', floor: 'lino', ceil: 'tile' },
  r: { wall: 'plaster', floor: 'lino', ceil: 'tile' },
  w: { wall: 'plaster', floor: 'lino', ceil: 'tile' },
  e: { wall: 'plaster', floor: 'lino', ceil: 'tile' },
  c: { wall: 'brick', floor: 'grass', ceil: 'sky' },
  a: { wall: 'brick', floor: 'gravel', ceil: 'sky' },
  m: { wall: 'concrete', floor: 'concrete', ceil: 'concrete' },
  g: { wall: 'tile', floor: 'tile', ceil: 'concrete' },
};
