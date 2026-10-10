import * as THREE from 'three';

/** Small canvas-drawn textures: signs, posters, labels, wall writing, handprints. */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Grime and age over a flat-coloured canvas. */
function age(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, seed: number): void {
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  ctx.save();
  for (let i = 0; i < 40 * amount; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = (0.02 + rnd() * 0.12) * Math.max(w, h);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(60,45,25,${0.05 + rnd() * 0.12})`);
    g.addColorStop(1, 'rgba(60,45,25,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 6 * amount; i++) {
    ctx.strokeStyle = `rgba(30,25,20,${0.08 + rnd() * 0.15})`;
    ctx.lineWidth = 1 + rnd() * 2;
    ctx.beginPath();
    const x = rnd() * w;
    ctx.moveTo(x, rnd() * h * 0.3);
    ctx.lineTo(x + (rnd() - 0.5) * 8, h * (0.4 + rnd() * 0.6));
    ctx.stroke();
  }
  ctx.restore();
}

export function signTexture(text: string, opts: { bg?: string; fg?: string; sub?: string; seed?: number } = {}): THREE.CanvasTexture {
  const [c, ctx] = canvas(1024, 256);
  ctx.fillStyle = opts.bg ?? '#1d3b36';
  ctx.fillRect(0, 0, 1024, 256);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 6;
  ctx.strokeRect(14, 14, 996, 228);
  ctx.fillStyle = opts.fg ?? '#e8e4d6';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${opts.sub ? 92 : 108}px "Helvetica Neue", Arial, sans-serif`;
  ctx.fillText(text.toUpperCase(), 512, opts.sub ? 100 : 132, 940);
  if (opts.sub) {
    ctx.font = '500 52px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText(opts.sub.toUpperCase(), 512, 192, 940);
  }
  age(ctx, 1024, 256, 1.2, opts.seed ?? 1);
  return tex(c);
}

export function exitTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(512, 192);
  ctx.fillStyle = '#0a3f1a';
  ctx.fillRect(0, 0, 512, 192);
  ctx.fillStyle = '#b8ffcf';
  ctx.font = '700 120px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('EXIT', 300, 100);
  // running figure
  ctx.strokeStyle = '#b8ffcf';
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(90, 50, 14, 0, Math.PI * 2);
  ctx.moveTo(85, 70);
  ctx.lineTo(75, 115);
  ctx.lineTo(100, 150);
  ctx.moveTo(75, 115);
  ctx.lineTo(50, 150);
  ctx.moveTo(82, 82);
  ctx.lineTo(110, 100);
  ctx.moveTo(82, 82);
  ctx.lineTo(55, 92);
  ctx.stroke();
  return tex(c);
}

const POSTERS: ReadonlyArray<{ title: string; body: string[]; color: string }> = [
  { title: 'QUIET PLEASE', body: ['Patients are resting.', 'Speak softly. Walk softly.', 'Thank you for your silence.'], color: '#2d4f6c' },
  { title: 'WASH YOUR HANDS', body: ['Before and after', 'every patient.', 'Every time.'], color: '#3b6b4f' },
  { title: 'VISITING HOURS', body: ['2 pm – 4 pm', '6 pm – 8 pm', 'No visitors on the Old Wing.'], color: '#6b4a2d' },
  { title: 'FIRE ASSEMBLY', body: ['In case of fire', 'do not use the lifts.', 'Assemble at the Chapel Garden.'], color: '#7a2a24' },
  { title: 'ST. ASHGROVE', body: ['General Hospital', 'Caring since 1931.', ''], color: '#24323f' },
  { title: 'HAVE YOU SEEN', body: ['ADA WREN?', 'Age 9. Last seen 14 Oct.', 'Call the front desk.'], color: '#d9d2bf' },
  { title: 'NIGHT STAFF', body: ['Report all noises', 'to Security.', 'Do not investigate alone.'], color: '#3d3d55' },
];

export function posterTexture(index: number): THREE.CanvasTexture {
  const p = POSTERS[index % POSTERS.length]!;
  const [c, ctx] = canvas(512, 720);
  ctx.fillStyle = '#e8e2cf';
  ctx.fillRect(0, 0, 512, 720);
  ctx.fillStyle = p.color;
  ctx.fillRect(28, 28, 456, 200);
  const light = p.color === '#d9d2bf';
  ctx.fillStyle = light ? '#1a1a1a' : '#f2eedf';
  ctx.font = '700 64px "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(p.title, 256, 128, 430);
  ctx.fillStyle = '#2a2622';
  ctx.font = '500 40px Georgia, serif';
  p.body.forEach((line, i) => ctx.fillText(line, 256, 330 + i * 70, 440));
  if (p.title === 'HAVE YOU SEEN') {
    // a smudged photo
    ctx.fillStyle = '#6d675c';
    ctx.fillRect(176, 240, 160, 40);
  }
  age(ctx, 512, 720, 2.2, index + 3);
  // torn corner
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.moveTo(512, 720);
  ctx.lineTo(430, 720);
  ctx.lineTo(512, 640);
  ctx.fill();
  return tex(c);
}

/** Scrawled words for the walls [story]. Black paint, or scratched into plaster. */
export function writingTexture(text: string, seed: number, names?: string[]): THREE.CanvasTexture {
  const [c, ctx] = canvas(1024, 512);
  ctx.clearRect(0, 0, 1024, 512);
  let s = seed * 7919 + 13;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  if (names) {
    ctx.fillStyle = 'rgba(30,20,18,0.85)';
    ctx.textBaseline = 'middle';
    const list = names.length ? names : ['ADA'];
    let i = 0;
    for (let y = 40; y < 500; y += 36) {
      for (let x = 20; x < 980; ) {
        const n = list[i++ % list.length]!.toUpperCase();
        ctx.font = `${18 + rnd() * 10}px "Courier New", monospace`;
        ctx.save();
        ctx.translate(x, y + (rnd() - 0.5) * 8);
        ctx.rotate((rnd() - 0.5) * 0.12);
        ctx.fillText(n, 0, 0);
        ctx.restore();
        x += ctx.measureText(n).width + 18 + rnd() * 20;
      }
    }
    return tex(c);
  }
  const blood = rnd() < 0.5;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const size = text.length > 18 ? 74 : text.length > 9 ? 104 : 150;
  ctx.font = `700 ${size}px "Brush Script MT", "Comic Sans MS", cursive`;
  ctx.fillStyle = blood ? 'rgba(92,10,8,0.92)' : 'rgba(18,16,14,0.92)';
  ctx.save();
  ctx.translate(512, 256);
  ctx.rotate((rnd() - 0.5) * 0.12);
  // jitter the words to look hand-painted
  for (let k = 0; k < 3; k++) {
    ctx.globalAlpha = k === 0 ? 1 : 0.35;
    ctx.fillText(text, (rnd() - 0.5) * 6, (rnd() - 0.5) * 6, 980);
  }
  ctx.restore();
  // drips
  ctx.globalAlpha = 1;
  const m = ctx.measureText(text);
  const w = Math.min(980, m.width);
  for (let i = 0; i < 9; i++) {
    const x = 512 - w / 2 + rnd() * w;
    const y0 = 256 + size * 0.3;
    const len = 30 + rnd() * 150;
    ctx.strokeStyle = blood ? 'rgba(92,10,8,0.8)' : 'rgba(18,16,14,0.8)';
    ctx.lineWidth = 3 + rnd() * 5;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x + (rnd() - 0.5) * 3, y0 + len);
    ctx.stroke();
  }
  return tex(c);
}

/** A hand: palm and four fingers, white on transparent (tinted and faded in the shader). */
export function handprintTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.filter = 'blur(3px)';
  ctx.beginPath();
  ctx.ellipse(128, 160, 46, 52, 0, 0, Math.PI * 2);
  ctx.fill();
  const fingers = [
    [84, 96, 12, 40, -0.2],
    [110, 78, 12, 48, -0.06],
    [138, 76, 12, 50, 0.04],
    [164, 90, 11, 42, 0.18],
    [178, 150, 11, 34, 0.9],
  ] as const;
  for (const [x, y, rw, rh, a] of fingers) {
    ctx.beginPath();
    ctx.ellipse(x, y, rw, rh, a, 0, Math.PI * 2);
    ctx.fill();
  }
  return tex(c, false);
}

/** Lined paper with handwriting-ish strokes (notes, case files). */
export function paperTexture(kind: 'note' | 'record', seed: number): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 320);
  ctx.fillStyle = kind === 'record' ? '#d8cfb4' : '#e6e1d2';
  ctx.fillRect(0, 0, 256, 320);
  let s = seed * 31 + 7;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  if (kind === 'record') {
    ctx.fillStyle = '#7a2a24';
    ctx.font = '700 22px "Courier New", monospace';
    ctx.fillText('CONFIDENTIAL', 40, 40);
    ctx.strokeStyle = '#7a2a24';
    ctx.strokeRect(30, 18, 196, 32);
  }
  ctx.strokeStyle = 'rgba(40,40,60,0.75)';
  ctx.lineWidth = 2;
  for (let y = 70; y < 300; y += 18) {
    let x = 24;
    ctx.beginPath();
    ctx.moveTo(x, y);
    while (x < 230 - rnd() * 40) {
      x += 4 + rnd() * 6;
      ctx.lineTo(x, y + (rnd() - 0.5) * 4);
    }
    ctx.stroke();
  }
  age(ctx, 256, 320, 1, seed);
  return tex(c);
}

export function labelTexture(text: string, bg = '#d9d4c2', fg = '#1a1a1a'): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 128);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = fg;
  ctx.font = '700 72px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 68, 230);
  return tex(c);
}
