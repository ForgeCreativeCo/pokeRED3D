// The start menu's screens: the Bag, the player's card, OPTION, the Pokédex,
// and the Continue screen shown at start-up when there's a save. Each draws
// into its own full-screen element and takes one menu press per frame.

import type { Input } from '../input/input';
import type { ItemData, Pocket, PokemonFile } from '../data/types';
import type { Options, Story } from '../scripts/story';
import { formatTime, type SaveFile } from '../save/save';

/** What every menu screen offers the start menu. */
export interface Screen {
  open: boolean;
  show(): void;
  close(): void;
  /** one frame of input; returns whether it's still open */
  update(): boolean;
  /** what's on screen, for tests */
  readonly state: string;
}

/** Runs a dialogue (text box, YES / NO) while a screen waits for it. */
export type Talk = (flow: () => Promise<void>) => void;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** FireRed text (with \n breaks and {PLAYER}) as HTML lines. */
const lines = (t: string, names: Record<string, string>) => esc(t.replace(/\{(\w+)\}/g, (_, k: string) => names[k] ?? '')).replace(/\\[nlp]/g, '<br>');

abstract class Base implements Screen {
  open = false;
  protected root: HTMLElement;
  constructor(protected input: Input, doc: Document, id: string) {
    this.root = doc.getElementById(id)!;
  }
  show() { this.open = true; this.root.hidden = false; this.input.clearHeld(); this.render(); }
  close() { this.open = false; this.root.hidden = true; }
  update(): boolean {
    if (!this.open) return false;
    const key = this.input.taken();
    if (key) { this.press(key); if (this.open) this.render(); }
    return this.open;
  }
  protected abstract press(key: NonNullable<ReturnType<Input['taken']>>): void;
  protected abstract render(): void;
  abstract get state(): string;
}

// ---- the Bag ----

const BAG_POCKETS: { pocket: Pocket; title: string }[] = [
  { pocket: 'ITEMS', title: 'ITEMS' }, { pocket: 'KEY_ITEMS', title: 'KEY ITEMS' }, { pocket: 'POKE_BALLS', title: 'POKé BALLS' },
];

export class BagMenu extends Base {
  private pocket = 0;
  private sel = 0;
  private mode: 'list' | 'actions' | 'toss' = 'list';
  private action = 0;
  private qty = 1;
  /** a dialogue is running (the text box has the buttons) */
  private talking = false;

  constructor(
    input: Input, doc: Document, private story: Story, private items: Record<string, ItemData>, private texts: Record<string, string>, private talk: Talk,
    /** the text box these dialogues use */
    private textboxOf: () => { say(t: string): Promise<void>; yesNo(): Promise<number>; close(): void },
  ) {
    super(input, doc, 'bag');
  }

  private get stacks() { return this.story.bag.pockets[BAG_POCKETS[this.pocket].pocket]; }
  private get stack() { return this.stacks[this.sel]; }
  private actions() { return this.stack && this.items[this.stack.item]?.important ? ['USE', 'CANCEL'] : ['USE', 'TOSS', 'CANCEL']; }

  show() { this.mode = 'list'; super.show(); }

  update(): boolean {
    if (this.talking) return true; // the text box is taking the presses
    return super.update();
  }

  protected press(key: string) {
    const n = this.stacks.length; // the last row is CLOSE BAG
    if (this.mode === 'list') {
      if (key === 'b') this.close();
      else if (key === 'left') { this.pocket = (this.pocket + BAG_POCKETS.length - 1) % BAG_POCKETS.length; this.sel = 0; }
      else if (key === 'right') { this.pocket = (this.pocket + 1) % BAG_POCKETS.length; this.sel = 0; }
      else if (key === 'up') this.sel = Math.max(0, this.sel - 1);
      else if (key === 'down') this.sel = Math.min(n, this.sel + 1);
      else if (key === 'a') { if (this.sel === n) this.close(); else { this.mode = 'actions'; this.action = 0; } }
    } else if (this.mode === 'actions') {
      const acts = this.actions();
      if (key === 'b') this.mode = 'list';
      else if (key === 'up') this.action = (this.action + acts.length - 1) % acts.length;
      else if (key === 'down') this.action = (this.action + 1) % acts.length;
      else if (key === 'a') {
        const act = acts[this.action];
        if (act === 'USE') this.say(this.texts.gText_OakForbidsUseOfItemHere);
        else if (act === 'TOSS') { this.mode = 'toss'; this.qty = 1; }
        else this.mode = 'list';
      }
    } else {
      const max = this.stack.count;
      if (key === 'b') this.mode = 'actions';
      else if (key === 'up') this.qty = this.qty >= max ? 1 : this.qty + 1;
      else if (key === 'down') this.qty = this.qty <= 1 ? max : this.qty - 1;
      else if (key === 'right') this.qty = Math.min(max, this.qty + 10);
      else if (key === 'left') this.qty = Math.max(1, this.qty - 10);
      else if (key === 'a') this.confirmToss();
    }
  }

  /** Show a line in the text box, then come back to the list. */
  private say(text: string, then?: (answer: number) => void, ask = false) {
    this.talking = true;
    this.talk(async () => {
      const box = this.textboxOf();
      await box.say(text);
      const answer = ask ? await box.yesNo() : 1;
      box.close();
      then?.(answer);
      this.talking = false;
      this.mode = 'list';
      if (this.open) this.render();
    });
  }

  private confirmToss() {
    const { item } = this.stack, qty = this.qty;
    this.story.names.STR_VAR_2 = String(qty);
    this.say(this.texts.gText_ThrowAwayStrVar2OfThisItemQM, (yes) => {
      if (yes) this.story.bag.remove(item, qty);
      this.sel = Math.min(this.sel, this.stacks.length);
    }, true);
  }

  get state() {
    if (!this.open) return 'closed';
    const row = this.stack ? `${this.items[this.stack.item]?.name ?? this.stack.item} x${this.stack.count}` : 'CLOSE BAG';
    const extra = this.mode === 'actions' ? `: ${this.actions()[this.action]}` : this.mode === 'toss' ? `: toss x${this.qty}` : '';
    return `bag ${BAG_POCKETS[this.pocket].title}: ${row}${extra}`;
  }

  protected render() {
    const p = BAG_POCKETS[this.pocket];
    const rows = this.stacks.map((s, i) => {
      const it = this.items[s.item];
      const count = it?.important ? '' : `<span class="count">×${s.count}</span>`;
      return `<li class="${i === this.sel ? 'sel' : ''}"><span>${esc(it?.name ?? s.item)}</span>${count}</li>`;
    });
    rows.push(`<li class="${this.sel === this.stacks.length ? 'sel' : ''}"><span>CLOSE BAG</span></li>`);
    const desc = this.stack ? lines(this.items[this.stack.item]?.description ?? '', this.story.names) : 'Close the BAG.';
    const acts = this.mode === 'actions' ? `<ul class="choices">${this.actions().map((a, i) => `<li class="${i === this.action ? 'sel' : ''}">${a}</li>`).join('')}</ul>` : '';
    const toss = this.mode === 'toss' ? `<div class="qty">×${String(this.qty).padStart(3, '0')}</div>` : '';
    this.root.innerHTML = `<div class="bagScreen">
      <div class="bagSide"><div class="bagPic" aria-hidden="true"></div>
        <div class="pocketName">◀ ${p.title} ▶</div>
        <div class="pocketDots">${BAG_POCKETS.map((_, i) => `<i class="${i === this.pocket ? 'on' : ''}"></i>`).join('')}</div></div>
      <ul class="itemList">${rows.join('')}</ul>
      <p class="itemDesc">${desc}</p>
      ${acts}${toss}
    </div>`;
  }
}

// ---- the player's card ----

export class TrainerCard extends Base {
  constructor(input: Input, doc: Document, private story: Story) { super(input, doc, 'card'); }
  protected press(key: string) { if (key === 'a' || key === 'b' || key === 'start') this.close(); }
  get state() { return this.open ? `card ${this.story.names.PLAYER}` : 'closed'; }
  protected render() {
    const s = this.story;
    const dex = s.flags.has('FLAG_SYS_POKEDEX_GET') ? `<dt>POKéDEX</dt><dd>${s.dex.caught.size}</dd>` : '';
    this.root.innerHTML = `<div class="trainerCard">
      <header><span>TRAINER CARD</span><span>IDNo. ${String(s.trainerId & 0xffff).padStart(5, '0')}</span></header>
      <dl>
        <dt>NAME</dt><dd>${esc(s.names.PLAYER)}</dd>
        <dt>MONEY</dt><dd>¥${s.money}</dd>
        ${dex}
        <dt>TIME</dt><dd>${formatTime(s.playTime)}</dd>
      </dl>
      <div class="badges">${Array.from({ length: 8 }, () => '<i></i>').join('')}</div>
    </div>`;
  }
}

// ---- OPTION ----

const OPTION_ROWS: { key: keyof Options; label: string; values: string[] }[] = [
  { key: 'textSpeed', label: 'TEXT SPEED', values: ['SLOW', 'MID', 'FAST'] },
  { key: 'battleScene', label: 'BATTLE SCENE', values: ['ON', 'OFF'] },
  { key: 'battleStyle', label: 'BATTLE STYLE', values: ['SHIFT', 'SET'] },
  { key: 'sound', label: 'SOUND', values: ['MONO', 'STEREO'] },
];

export class OptionsMenu extends Base {
  private row = 0;
  constructor(input: Input, doc: Document, private story: Story, private apply: () => void) { super(input, doc, 'options'); }
  show() { this.row = 0; super.show(); }
  protected press(key: string) {
    const r = OPTION_ROWS[this.row];
    if (key === 'b' || key === 'start' || (key === 'a' && !r)) { this.close(); return; }
    if (key === 'up') this.row = (this.row + OPTION_ROWS.length) % (OPTION_ROWS.length + 1);
    else if (key === 'down') this.row = (this.row + 1) % (OPTION_ROWS.length + 1);
    else if ((key === 'left' || key === 'right') && r) {
      const vals = r.values, i = vals.indexOf(this.story.options[r.key]);
      (this.story.options as unknown as Record<string, string>)[r.key] = vals[(i + (key === 'right' ? 1 : vals.length - 1)) % vals.length];
      this.apply();
    }
  }
  get state() {
    if (!this.open) return 'closed';
    const r = OPTION_ROWS[this.row];
    return r ? `option ${r.label}: ${this.story.options[r.key]}` : 'option CANCEL';
  }
  protected render() {
    const rows = OPTION_ROWS.map((r, i) => `<li class="${i === this.row ? 'sel' : ''}"><span>${r.label}</span>`
      + `<span class="vals">${r.values.map((v) => `<b class="${v === this.story.options[r.key] ? 'on' : ''}">${v}</b>`).join('')}</span></li>`);
    rows.push(`<li class="${this.row === OPTION_ROWS.length ? 'sel' : ''}"><span>CANCEL</span></li>`);
    this.root.innerHTML = `<div class="optionScreen"><header>OPTION</header><ul>${rows.join('')}</ul></div>`;
  }
}

// ---- the Pokédex ----

export class Pokedex extends Base {
  private sel = 0;
  constructor(input: Input, doc: Document, private story: Story, private data: PokemonFile) { super(input, doc, 'dex'); }
  /** National numbers up to the highest seen, as the Kanto Pokédex lists them. */
  private entries() {
    const seen = [...this.story.dex.seen].map((s) => this.data.species[s]).filter(Boolean);
    const top = Math.max(0, ...seen.map((s) => s.dex));
    const byNum = new Map(Object.entries(this.data.species).filter(([, s]) => s.dex).map(([k, s]) => [s.dex, k]));
    return Array.from({ length: top }, (_, i) => byNum.get(i + 1) ?? '');
  }
  show() { this.sel = 0; super.show(); }
  protected press(key: string) {
    const n = this.entries().length;
    if (key === 'b' || key === 'start') this.close();
    else if (key === 'up') this.sel = Math.max(0, this.sel - 1);
    else if (key === 'down') this.sel = Math.min(Math.max(0, n - 1), this.sel + 1);
  }
  get state() { return this.open ? `pokedex seen ${this.story.dex.seen.size} owned ${this.story.dex.caught.size}` : 'closed'; }
  protected render() {
    const { seen, caught } = this.story.dex;
    const rows = this.entries().map((sp, i) => {
      const known = seen.has(sp);
      return `<li class="${i === this.sel ? 'sel' : ''}"><span class="no">No${String(i + 1).padStart(3, '0')}</span>`
        + `<span class="ball">${caught.has(sp) ? '●' : ''}</span><span>${known ? esc(this.data.species[sp].name) : '----------'}</span></li>`;
    });
    this.root.innerHTML = `<div class="dexScreen"><header><span>POKéDEX</span><span>SEEN ${seen.size} · OWN ${caught.size}</span></header>
      <ul>${rows.join('') || '<li>Nothing seen yet.</li>'}</ul></div>`;
  }
}

// ---- Continue / New game ----

export class TitleScreen extends Base {
  private sel = 0;
  /** what the player chose, once they have */
  choice: 'continue' | 'new' | null = null;
  constructor(input: Input, doc: Document, private save: SaveFile, private data: PokemonFile) { super(input, doc, 'continueScreen'); }
  protected press(key: string) {
    if (key === 'up' || key === 'down') this.sel ^= 1;
    else if (key === 'a' || key === 'start') { this.choice = this.sel === 0 ? 'continue' : 'new'; this.close(); }
  }
  get state() { return this.open ? `title ${this.sel === 0 ? 'CONTINUE' : 'NEW GAME'}` : 'closed'; }
  protected render() {
    const s = this.save.story;
    const dex = s.flags.includes('FLAG_SYS_POKEDEX_GET') ? `<dt>POKéDEX</dt><dd>${s.dex.caught.length}</dd>` : '';
    const lead = s.party[0] && this.data.species[s.party[0].species];
    this.root.innerHTML = `<div class="titleScreen">
      <div class="choice ${this.sel === 0 ? 'sel' : ''}"><b>CONTINUE</b>
        <dl><dt>PLAYER</dt><dd>${esc(s.names.PLAYER)}</dd>${dex}<dt>TIME</dt><dd>${formatTime(s.playTime)}</dd></dl>
        ${lead ? `<p class="lead">with ${esc(s.party[0].nickname ?? lead.name)} Lv${s.party[0].level}</p>` : ''}</div>
      <div class="choice ${this.sel === 1 ? 'sel' : ''}"><b>NEW GAME</b></div>
    </div>`;
  }
}
