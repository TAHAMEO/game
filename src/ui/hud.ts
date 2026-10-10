import type { Sim } from '../core/sim';
import type { GameEvent } from '../core/types';

interface Line {
  el: HTMLElement;
  until: number;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * The HUD is deliberately thin. No stress meter, no sanity bar, no clock [S, Z]:
 * an interaction prompt, subtitles, diegetic notices and what is in your pockets.
 */
export class Hud {
  private prompt: HTMLElement;
  private bar: HTMLElement;
  private subs: HTMLElement;
  private notices: HTMLElement;
  private inv: HTMLElement;
  private note: HTMLElement;
  private lines: Line[] = [];
  private noticeLines: Line[] = [];
  private clock = 0;

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <div class="hud-notices"></div>
      <div class="hud-subs"></div>
      <div class="hud-prompt"></div>
      <div class="hud-bar"><i></i></div>
      <div class="hud-inv"></div>
      <div class="hud-note" hidden></div>`;
    this.prompt = root.querySelector('.hud-prompt')!;
    this.bar = root.querySelector('.hud-bar i')!;
    this.subs = root.querySelector('.hud-subs')!;
    this.notices = root.querySelector('.hud-notices')!;
    this.inv = root.querySelector('.hud-inv')!;
    this.note = root.querySelector('.hud-note')!;
  }

  reset(): void {
    this.subs.innerHTML = '';
    this.notices.innerHTML = '';
    this.lines = [];
    this.noticeLines = [];
    this.note.hidden = true;
  }

  handle(events: GameEvent[]): void {
    for (const e of events) {
      if (e.type === 'subtitle') this.subtitle(e.speaker, e.text, e.duration, e.radio === true);
      else if (e.type === 'notice') this.notice(e.text, e.duration);
    }
  }

  subtitle(speaker: string, text: string, duration: number, radio: boolean): void {
    const el = document.createElement('div');
    el.className = radio ? 'sub radio' : 'sub';
    el.innerHTML = `<b>${esc(speaker)}</b> ${esc(text)}`;
    this.subs.appendChild(el);
    this.lines.push({ el, until: this.clock + duration });
    while (this.lines.length > 3) this.lines.shift()!.el.remove();
  }

  notice(text: string, duration: number): void {
    if (this.noticeLines.some((l) => l.el.textContent === text)) return;
    const el = document.createElement('div');
    el.className = 'notice';
    el.textContent = text;
    this.notices.appendChild(el);
    this.noticeLines.push({ el, until: this.clock + duration });
    while (this.noticeLines.length > 3) this.noticeLines.shift()!.el.remove();
  }

  /** Returns true while a note is open (the game keeps running — reading is never safe). */
  update(sim: Sim, dt: number): void {
    this.clock += dt;
    for (const list of [this.lines, this.noticeLines]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const l = list[i]!;
        const left = l.until - this.clock;
        l.el.style.opacity = String(Math.max(0, Math.min(1, left / 0.8)));
        if (left <= 0) {
          l.el.remove();
          list.splice(i, 1);
        }
      }
    }
    const pl = sim.player;
    const prompt = pl.alive && !pl.channel ? (pl.hidden ? (pl.transition ? null : 'Leave') : pl.promptFor(pl.focus)) : null;
    this.prompt.innerHTML = prompt ? `<kbd>E</kbd> ${esc(prompt)}` : '';
    const prog = pl.channelProgress;
    this.bar.parentElement!.style.opacity = prog > 0 ? '1' : '0';
    this.bar.style.width = `${(prog * 100).toFixed(1)}%`;

    const inv = pl.inv;
    const bits: string[] = [];
    if (inv.fuses) bits.push(`${inv.fuses} fuse${inv.fuses > 1 ? 's' : ''}`);
    if (inv.keys.has('maintenance')) bits.push('maintenance key');
    if (inv.batteries) bits.push(`${inv.batteries} batter${inv.batteries > 1 ? 'ies' : 'y'}`);
    if (inv.bottles) bits.push(`${inv.bottles} bottle${inv.bottles > 1 ? 's' : ''}`);
    const status: string[] = [];
    if (pl.isMarked) status.push('Your sleeve is soaked black.');
    if (pl.wounded) status.push('You are bleeding.');
    this.inv.innerHTML = `<div>${esc(bits.join(' · ') || 'empty pockets')}</div>${status.map((s) => `<div class="status">${esc(s)}</div>`).join('')}`;

    if (pl.readingNote !== null) {
      const n = sim.world.notes[pl.readingNote]!;
      if (this.note.hidden || this.note.dataset.id !== String(n.id)) {
        this.note.dataset.id = String(n.id);
        this.note.innerHTML = `<h3>${esc(n.title)}</h3><p>${esc(n.text)}</p><small>Walk away to put it down.</small>`;
        this.note.hidden = false;
      }
      if (pl.speed > 0.3 || pl.channel || pl.hidden) pl.readingNote = null;
    } else this.note.hidden = true;
  }
}
