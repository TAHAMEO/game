import type { Player } from '../core/player';
import type { Sim } from '../core/sim';
import type { GameEvent } from '../core/types';

interface Line {
  el: HTMLElement;
  until: number;
}

interface Vision {
  start: number;
  dur: number;
  lines: HTMLElement[];
}

export interface HudView {
  /** Whose eyes the screen shows (yourself, or whoever you watch once you are out). */
  viewId: number;
  /** Your own seat. */
  localId: number;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * The HUD is deliberately thin. No stress meter, no sanity bar, no clock [S, Z]:
 * an interaction prompt, subtitles, diegetic notices, what is in your pockets — and what the
 * building shows you: visions, whispers, the pages of a case file.
 */
export class Hud {
  private readonly root: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly subs: HTMLElement;
  private readonly notices: HTMLElement;
  private readonly inv: HTMLElement;
  private readonly note: HTMLElement;
  private readonly record: HTMLElement;
  private readonly vision: HTMLElement;
  private readonly whisper: HTMLElement;
  private readonly found: HTMLElement;
  private readonly cross: HTMLElement;
  private readonly spectate: HTMLElement;
  private readonly team: HTMLElement;
  private lines: Line[] = [];
  private noticeLines: Line[] = [];
  private visionNow: Vision | null = null;
  private whisperUntil = 0;
  private foundUntil = 0;
  private clock = 0;
  /** Ids already shown, so a page found twice (host and copy) toasts once. */
  private shownRecord = -1;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="hud-vision" hidden><div class="vz-zone"></div><div class="vz-lines"></div></div>
      <div class="hud-whisper"></div>
      <div class="hud-cross"></div>
      <div class="hud-team"></div>
      <div class="hud-notices"></div>
      <div class="hud-subs"></div>
      <div class="hud-prompt"></div>
      <div class="hud-bar"><i></i></div>
      <div class="hud-inv"></div>
      <div class="hud-found"></div>
      <div class="hud-spectate" hidden></div>
      <div class="hud-note" hidden></div>
      <div class="hud-record" hidden></div>`;
    this.prompt = root.querySelector('.hud-prompt')!;
    this.bar = root.querySelector('.hud-bar i')!;
    this.subs = root.querySelector('.hud-subs')!;
    this.notices = root.querySelector('.hud-notices')!;
    this.inv = root.querySelector('.hud-inv')!;
    this.note = root.querySelector('.hud-note')!;
    this.record = root.querySelector('.hud-record')!;
    this.vision = root.querySelector('.hud-vision')!;
    this.whisper = root.querySelector('.hud-whisper')!;
    this.found = root.querySelector('.hud-found')!;
    this.cross = root.querySelector('.hud-cross')!;
    this.spectate = root.querySelector('.hud-spectate')!;
    this.team = root.querySelector('.hud-team')!;
  }

  /** Only touch the DOM when the content actually changes (keeps paint/composite cheap). */
  private readonly last = new WeakMap<HTMLElement, string>();
  private set(el: HTMLElement, html: string): void {
    if (this.last.get(el) === html) return;
    this.last.set(el, html);
    el.innerHTML = html;
  }

  private style(el: HTMLElement, prop: 'opacity' | 'width', v: string): void {
    if (el.style[prop] !== v) el.style[prop] = v;
  }

  reset(): void {
    this.subs.innerHTML = '';
    this.notices.innerHTML = '';
    this.lines = [];
    this.noticeLines = [];
    this.note.hidden = true;
    this.record.hidden = true;
    this.endVision();
    this.whisperUntil = 0;
    this.foundUntil = 0;
    this.shownRecord = -1;
    this.style(this.whisper, 'opacity', '0');
    this.style(this.found, 'opacity', '0');
  }

  /** Events for whoever the screen is showing (the rest belong to someone else's head). */
  handle(events: GameEvent[], sim: Sim, view: HudView): void {
    for (const e of events) {
      if (e.to !== undefined && e.to !== view.viewId && e.to !== view.localId) continue;
      const mine = e.to === undefined || e.to === view.viewId;
      if (e.type === 'subtitle') {
        if (mine) this.subtitle(e.speaker, e.text, e.duration, e.radio === true);
      } else if (e.type === 'notice') {
        // Notices are your own thoughts: only yours, even while you watch someone else.
        if (e.to === undefined || e.to === view.localId) this.notice(e.text, e.duration);
      } else if (e.type === 'story' && mine) {
        const b = e.beat;
        if (b.kind === 'vision') this.startVision(b.zone, b.lines, b.duration);
        else if (b.kind === 'whisper') this.showWhisper(b.text);
        else if (b.kind === 'record' && b.id !== this.shownRecord) {
          this.shownRecord = b.id;
          const n = sim.story.pages;
          this.found.innerHTML = `<small>A page of a case file</small><b>${esc(b.title)}</b><small>${n} of ${sim.story.total}</small>`;
          this.foundUntil = this.clock + 5;
        }
      }
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

  // ------------------------------------------------------------------ what the building shows you

  private startVision(zone: string, lines: string[], dur: number): void {
    this.endVision();
    this.vision.hidden = false;
    this.vision.querySelector('.vz-zone')!.textContent = zone;
    const box = this.vision.querySelector('.vz-lines')!;
    box.innerHTML = '';
    const els = lines.map((l) => {
      const p = document.createElement('p');
      p.textContent = l;
      p.style.opacity = '0';
      box.appendChild(p);
      return p;
    });
    this.visionNow = { start: this.clock, dur, lines: els };
  }

  private endVision(): void {
    this.visionNow = null;
    this.vision.hidden = true;
  }

  private showWhisper(text: string): void {
    this.whisper.textContent = text;
    // somewhere off-centre, never twice in the same place
    const a = Math.random() * Math.PI * 2;
    this.whisper.style.left = `${50 + Math.cos(a) * 14}%`;
    this.whisper.style.top = `${46 + Math.sin(a) * 12}%`;
    this.whisperUntil = this.clock + 4.2;
  }

  private updateVision(): void {
    const v = this.visionNow;
    if (!v) return;
    const age = this.clock - v.start;
    if (age > v.dur) {
      this.endVision();
      return;
    }
    // lines arrive one by one, linger, and all go together at the end
    const n = v.lines.length;
    const slot = (v.dur - 1.6) / Math.max(1, n);
    const out = Math.min(1, (v.dur - age) / 1.2);
    v.lines.forEach((el, i) => {
      const t0 = 0.6 + i * slot;
      const a = Math.max(0, Math.min(1, (age - t0) / 0.9));
      this.style(el, 'opacity', (a * out).toFixed(2));
    });
    this.style(this.vision, 'opacity', Math.min(1, age / 0.8, out).toFixed(2));
  }

  // ------------------------------------------------------------------ per frame

  update(sim: Sim, dt: number, view: HudView): void {
    this.clock += dt;
    for (const list of [this.lines, this.noticeLines]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const l = list[i]!;
        const left = l.until - this.clock;
        if (left < 0.8) l.el.style.opacity = String(Math.max(0, left / 0.8).toFixed(2));
        if (left <= 0) {
          l.el.remove();
          list.splice(i, 1);
        }
      }
    }
    this.updateVision();
    const wl = this.whisperUntil - this.clock;
    this.style(this.whisper, 'opacity', wl > 0 ? Math.min(1, wl / 1.5, (4.2 - wl) / 0.8).toFixed(2) : '0');
    const fl = this.foundUntil - this.clock;
    this.style(this.found, 'opacity', fl > 0 ? Math.min(1, fl / 1, (5 - fl) / 0.4).toFixed(2) : '0');

    const me = sim.players[view.localId] ?? sim.player;
    const watched = sim.players[view.viewId] ?? me;
    const spectating = watched !== me;
    this.spectate.hidden = !spectating && me.active;
    if (!this.spectate.hidden) {
      const why = me.escaped ? 'You got out.' : me.alive ? '' : 'You are gone.';
      this.set(
        this.spectate,
        spectating
          ? `${esc(why)} Watching <b>${esc(watched.name)}</b>${sim.activePlayers.length > 1 ? ` <span><kbd>←</kbd><kbd>→</kbd> or click: someone else</span>` : ''}`
          : esc(why),
      );
    }
    this.updateTeam(sim, view);
    this.updateSelf(sim, me, !spectating && me.active);
  }

  private updateTeam(sim: Sim, view: HudView): void {
    if (sim.players.length < 2) {
      this.set(this.team, '');
      return;
    }
    const rows = sim.players.map((p) => {
      const state = p.escaped ? 'out' : !p.alive ? 'gone' : p.hidden ? 'hidden' : p.wounded ? 'hurt' : '';
      const cls = p.escaped ? 'out' : !p.alive ? 'dead' : '';
      return `<div class="${cls}${p.id === view.localId ? ' me' : ''}">${esc(p.shortName)}${state ? ` <i>${state}</i>` : ''}</div>`;
    });
    this.set(this.team, rows.join(''));
  }

  private updateSelf(sim: Sim, pl: Player, live: boolean): void {
    const prompt = live && !pl.channel ? (pl.hidden ? (pl.transition ? null : 'Leave') : pl.promptFor(pl.focus)) : null;
    this.set(this.prompt, prompt ? `<kbd>E</kbd> ${esc(prompt)}` : '');
    this.cross.className = `hud-cross${!live || pl.hidden || pl.transition ? ' off' : prompt ? ' on' : ''}`;
    const prog = live ? pl.channelProgress : 0;
    this.style(this.bar.parentElement!, 'opacity', prog > 0 ? '1' : '0');
    this.style(this.bar, 'width', `${Math.round(prog * 100)}%`);

    if (!live) this.set(this.inv, '');
    else {
      const inv = pl.inv;
      const bits: string[] = [];
      if (inv.fuses) bits.push(`${inv.fuses} fuse${inv.fuses > 1 ? 's' : ''}`);
      if (inv.keys.has('maintenance')) bits.push('maintenance key');
      if (inv.batteries) bits.push(`${inv.batteries} batter${inv.batteries > 1 ? 'ies' : 'y'}`);
      if (inv.bottles) bits.push(`${inv.bottles} bottle${inv.bottles > 1 ? 's' : ''}`);
      const status: string[] = [];
      if (pl.isMarked) status.push('Your sleeve is soaked black.');
      if (pl.wounded) status.push('You are bleeding.');
      this.set(this.inv, `<div>${esc(bits.join(' · ') || 'empty pockets')}</div>${status.map((s) => `<div class="status">${esc(s)}</div>`).join('')}`);
    }

    if (live && pl.readingNote !== null) {
      const n = sim.world.notes[pl.readingNote];
      if (n && (this.note.hidden || this.note.dataset.id !== String(n.id))) {
        this.note.dataset.id = String(n.id);
        this.note.innerHTML = `<h3>${esc(n.title)}</h3><p>${esc(n.text)}</p><small>Walk away to put it down.</small>`;
        this.note.hidden = false;
      }
    } else this.note.hidden = true;

    if (live && pl.readingRecord !== null) {
      const id = pl.readingRecord;
      if (this.record.hidden || this.record.dataset.id !== String(id)) {
        const r = sim.story.recordText(id, pl);
        if (r) {
          this.record.dataset.id = String(id);
          this.record.innerHTML = `
            <div class="rec-head"><span>St. Ashgrove General — Quiet Ward</span><span>Confidential</span></div>
            <h3>${esc(r.title)}</h3>
            <p>${esc(r.text)}</p>
            <div class="rec-foot"><span>Case file · page ${id + 1} of ${sim.story.total}</span><small>Walk away to put it down.</small></div>`;
          this.record.hidden = false;
        }
      }
    } else this.record.hidden = true;
  }

  set visible(v: boolean) {
    this.root.hidden = !v;
  }
}
