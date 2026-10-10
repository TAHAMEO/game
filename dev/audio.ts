import { footstep, heartbeat, play, stinger, swell, thunder, whisper, type Surface } from '../src/audio/recipes';
import { makeImpulse, SPACES } from '../src/audio/reverb';
import { makeNoise } from '../src/audio/synth';
import { bell, musicBox, paChime, phoneRing, humming } from '../src/audio/ambience';
import type { SoundKind } from '../src/core/types';

const kinds: SoundKind[] = ['step','entityStep','door','doorBash','locker','glass','whoosh','gasp','exhale','breath','tap','breaker','radio','rattle','click','knock','tilt','inhale','sigh','snap','cough','voice','lightPop','pickup','drag','hum','gate','scream','thud','whisper','thunder'];
const results: Record<string, { peak: number; rms: number; nan: boolean; dur: number }> = {};
async function render(name: string, seconds: number, make: (o: { ctx: BaseAudioContext; dest: AudioNode; t: number; noise: ReturnType<typeof makeNoise> }) => void) {
  const ctx = new OfflineAudioContext(1, Math.floor(44100 * seconds), 44100);
  const noise = makeNoise(ctx, 3);
  make({ ctx, dest: ctx.destination, t: 0.01, noise });
  const buf = await ctx.startRendering();
  const d = buf.getChannelData(0);
  let peak = 0, sum = 0, nan = false;
  for (let i = 0; i < d.length; i++) { const v = d[i]!; if (!Number.isFinite(v)) nan = true; peak = Math.max(peak, Math.abs(v)); sum += v * v; }
  results[name] = { peak: +peak.toFixed(3), rms: +Math.sqrt(sum / d.length).toFixed(4), nan, dur: seconds };
}
for (const k of kinds) await render(k, 5, (o) => play(o as never, k, 'tile'));
for (const s of ['tile','wood','concrete','grass','asphalt','wet'] as Surface[]) await render('foot:' + s, 1, (o) => footstep(o as never, s, 0.7));
await render('stinger', 3, (o) => stinger(o as never, 1));
await render('swell', 3, (o) => swell(o as never, 2, 1));
await render('thunder', 5, (o) => thunder(o as never, 1));
await render('whisper6', 3, (o) => whisper(o as never, 6, 0.5));
await render('heartbeat', 1, (o) => heartbeat(o as never, 1));
await render('bell', 6, (o) => bell(o as never, 0.5));
await render('musicBox', 5, (o) => musicBox(o as never, 0.3));
await render('phone', 7, (o) => phoneRing(o as never, 0.12));
await render('pa', 4, (o) => paChime(o as never, 0.25));
await render('humming', 4, (o) => humming(o as never, 0.12));
for (const sp of Object.keys(SPACES)) {
  const ctx = new OfflineAudioContext(2, 44100, 44100);
  const ir = makeImpulse(ctx, SPACES[sp]!);
  let peak = 0; const d = ir.getChannelData(0); for (const v of d) peak = Math.max(peak, Math.abs(v));
  results['ir:' + sp] = { peak: +peak.toFixed(3), rms: 0, nan: Number.isNaN(peak), dur: ir.duration };
}
(window as unknown as { __results: unknown; __done: boolean }).__results = results;
(window as unknown as { __done: boolean }).__done = true;
