// The party screen and the summary pages, laid out like FireRed's.
//
// Party: the lead Pokémon in a big slot on the left, the other five in a list
// on the right, CANCEL below. A on a Pokémon offers SUMMARY, SWITCH, CANCEL.
// Summary: POKéMON INFO, POKéMON SKILLS and KNOWN MOVES; left and right turn
// the page, up and down change Pokémon, B goes back.

import type { Input } from '../input/input';
import type { PokemonFile } from '../data/types';
import type { Story } from '../scripts/story';
import { abilityOf, displayName, expForLevel, genderOf, natureIndex, type Mon } from '../pokemon/mon';

const TYPE_COLORS: Record<string, string> = {
  NORMAL: '#a8a878', FIRE: '#f08030', WATER: '#6890f0', GRASS: '#78c850', ELECTRIC: '#f8d030', ICE: '#98d8d8',
  FIGHTING: '#c03028', POISON: '#a040a0', GROUND: '#e0c068', FLYING: '#a890f0', PSYCHIC: '#f85888', BUG: '#a8b820',
  ROCK: '#b8a038', GHOST: '#705898', DRAGON: '#7038f8', DARK: '#705848', STEEL: '#b8b8d0', MYSTERY: '#68a090',
};
const PAGES = ['POKéMON INFO', 'POKéMON SKILLS', 'KNOWN MOVES'];
const ACTIONS = ['SUMMARY', 'SWITCH', 'CANCEL'];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const typeName = (t: string) => t.replace(/^TYPE_/, '');
const typeBadge = (t: string) => `<span class="type" style="--type:${TYPE_COLORS[typeName(t)] ?? '#888'}">${typeName(t)}</span>`;
const hpClass = (m: Mon) => (m.hp / m.stats.hp > 0.5 ? 'high' : m.hp / m.stats.hp > 0.2 ? 'mid' : 'low');

type Mode = 'list' | 'actions' | 'summary';

export class PartyMenu {
  open = false;
  private mode: Mode = 'list';
  /** selected slot: 0-5 for Pokémon, 6 for CANCEL */
  private slot = 0;
  private action = 0;
  private page = 0;
  /** slot being moved by SWITCH, or null */
  private moving: number | null = null;
  private root: HTMLElement;

  constructor(private data: PokemonFile, private story: Story, private input: Input, doc: Document) {
    this.root = doc.getElementById('party')!;
  }

  private get party() { return this.story.party; }

  show() {
    if (!this.party.length) return;
    this.open = true;
    this.mode = 'list'; this.slot = 0; this.moving = null;
    this.input.clearHeld();
    this.root.hidden = false;
    this.render();
  }

  close() {
    this.open = false;
    this.root.hidden = true;
  }

  /** One frame of menu input; returns whether the menu is still open. */
  update(): boolean {
    if (!this.open) return false;
    const key = this.input.taken();
    if (!key) return true;
    const n = this.party.length;
    if (this.mode === 'list') {
      if (key === 'b') { if (this.moving !== null) this.moving = null; else this.close(); }
      else if (key === 'up') this.slot = this.slot === 6 ? n - 1 : this.slot === 0 ? 6 : this.slot - 1;
      else if (key === 'down') this.slot = this.slot === 6 ? 0 : this.slot >= n - 1 ? 6 : this.slot + 1;
      else if (key === 'right' && this.slot === 0 && n > 1) this.slot = 1;
      else if (key === 'left' && this.slot > 0 && this.slot < 6) this.slot = 0;
      else if (key === 'a') {
        if (this.slot === 6) { if (this.moving !== null) this.moving = null; else this.close(); }
        else if (this.moving !== null) {
          // Second pick of SWITCH: swap the two.
          const p = this.party, a = this.moving;
          [p[a], p[this.slot]] = [p[this.slot], p[a]];
          this.moving = null;
        } else { this.mode = 'actions'; this.action = 0; }
      }
    } else if (this.mode === 'actions') {
      if (key === 'b') this.mode = 'list';
      else if (key === 'up') this.action = (this.action + ACTIONS.length - 1) % ACTIONS.length;
      else if (key === 'down') this.action = (this.action + 1) % ACTIONS.length;
      else if (key === 'a') {
        const act = ACTIONS[this.action];
        if (act === 'SUMMARY') { this.mode = 'summary'; this.page = 0; }
        else if (act === 'SWITCH') { this.moving = this.slot; this.mode = 'list'; }
        else this.mode = 'list';
      }
    } else {
      if (key === 'b' || key === 'a') this.mode = 'list';
      else if (key === 'left') this.page = Math.max(0, this.page - 1);
      else if (key === 'right') this.page = Math.min(PAGES.length - 1, this.page + 1);
      else if (key === 'up') this.slot = (this.slot + n - 1) % n;
      else if (key === 'down') this.slot = (this.slot + 1) % n;
    }
    if (this.open) this.render();
    return this.open;
  }

  /** What's on screen, for tests: the mode, the selection and the page. */
  get state() {
    if (!this.open) return 'closed';
    const m = this.party[this.slot];
    const who = m ? displayName(this.data, m) : 'CANCEL';
    if (this.mode === 'summary') return `summary ${who}: ${PAGES[this.page]}`;
    if (this.mode === 'actions') return `party ${who}: ${ACTIONS[this.action]}`;
    return `party ${who}${this.moving !== null ? ' (switching)' : ''}`;
  }

  // ---- drawing ----

  private gender(m: Mon) {
    const g = genderOf(this.data.species[m.species], m.personality);
    return g === 'male' ? '<span class="male">♂</span>' : g === 'female' ? '<span class="female">♀</span>' : '';
  }

  private icon(m: Mon) {
    const pic = this.data.pics[m.species];
    return `<span class="icon"${pic ? ` style="background-image:url(${pic.icon})"` : ''}></span>`;
  }

  private hpBar(m: Mon) {
    const pct = Math.max(0, Math.min(100, (m.hp / m.stats.hp) * 100));
    return `<span class="hpbar"><b>HP</b><span class="track"><span class="fill ${hpClass(m)}" style="width:${pct}%"></span></span></span>`;
  }

  private slotHtml(m: Mon | undefined, i: number) {
    const cls = ['slot', i === 0 ? 'lead' : 'other', i === this.slot ? 'sel' : '', i === this.moving ? 'moving' : '', !m ? 'empty' : ''].join(' ');
    if (!m) return `<div class="${cls}"></div>`;
    return `<div class="${cls}">${this.icon(m)}<span class="name">${esc(displayName(this.data, m))}</span>${this.gender(m)}`
      + `<span class="lv">Lv${m.level}</span>${this.hpBar(m)}<span class="hp">${m.hp}/ ${m.stats.hp}</span></div>`;
  }

  private render() {
    if (this.mode === 'summary') { this.root.innerHTML = this.summaryHtml(); return; }
    const p = this.party;
    const prompt = this.moving !== null ? 'Move to where?' : this.mode === 'actions' ? `Do what with ${esc(displayName(this.data, p[this.slot]))}?` : 'Choose a POKéMON.';
    const actions = this.mode === 'actions'
      ? `<ul class="actions">${ACTIONS.map((a, i) => `<li class="${i === this.action ? 'sel' : ''}">${a}</li>`).join('')}</ul>` : '';
    this.root.innerHTML = `<div class="partyScreen">
      <div class="leadCol">${this.slotHtml(p[0], 0)}</div>
      <div class="listCol">${[1, 2, 3, 4, 5].map((i) => this.slotHtml(p[i], i)).join('')}</div>
      <div class="prompt">${prompt}</div>
      <div class="cancel ${this.slot === 6 ? 'sel' : ''}">CANCEL</div>
      ${actions}
    </div>`;
  }

  private summaryHtml() {
    const m = this.party[this.slot], sp = this.data.species[m.species];
    const pic = this.data.pics[m.species];
    const nature = this.data.natures[natureIndex(m)].name;
    const id = String(m.otId & 0xffff).padStart(5, '0');
    let body = '';
    if (this.page === 0) {
      body = `<dl class="info">
        <dt>TYPE/</dt><dd>${sp.types.map(typeBadge).join(' ')}</dd>
        <dt>OT/</dt><dd>${esc(m.otName)}</dd>
        <dt>IDNo.</dt><dd>${id}</dd>
        <dt>ITEM</dt><dd>NONE</dd>
      </dl>
      <p class="memo">${nature} nature.<br>Met at Lv. ${m.metLevel}.</p>`;
    } else if (this.page === 1) {
      const next = m.level >= 100 ? 0 : expForLevel(sp.growth, m.level + 1) - m.exp;
      const ability = abilityOf(sp, m.personality);
      body = `<dl class="skills">
        <dt>HP</dt><dd>${m.hp}/${m.stats.hp}</dd>
        <dt>ATTACK</dt><dd>${m.stats.atk}</dd>
        <dt>DEFENSE</dt><dd>${m.stats.def}</dd>
        <dt>SP. ATK</dt><dd>${m.stats.spa}</dd>
        <dt>SP. DEF</dt><dd>${m.stats.spd}</dd>
        <dt>SPEED</dt><dd>${m.stats.spe}</dd>
        <dt>EXP. POINTS</dt><dd>${m.exp}</dd>
        <dt>NEXT LV.</dt><dd>${next}</dd>
        <dt>ABILITY</dt><dd>${esc(this.data.abilities[ability] ?? ability.replace(/^ABILITY_/, ''))}</dd>
      </dl>`;
    } else {
      body = `<ul class="moves">${[0, 1, 2, 3].map((i) => {
        const mv = m.moves[i], d = mv && this.data.moves[mv.move];
        return d ? `<li>${typeBadge(d.type)}<span class="mname">${esc(d.name)}</span><span class="pp">PP ${mv.pp}/${d.pp}</span>`
          + `<span class="mstat">POWER ${d.power > 1 ? d.power : '---'} · ACCURACY ${d.accuracy || '---'}</span></li>` : '<li class="none">-</li>';
      }).join('')}</ul>`;
    }
    return `<div class="summary">
      <header><span class="pageTitle">${PAGES[this.page]}</span><span class="dots">${PAGES.map((_, i) => `<i class="${i === this.page ? 'on' : ''}"></i>`).join('')}</span></header>
      <div class="who">
        <div class="nameRow"><span class="lv">Lv${m.level}</span><span class="name">${esc(displayName(this.data, m))}</span>${this.gender(m)}</div>
        ${pic ? `<img class="front" src="${pic.front}" alt="${esc(sp.name)}">` : ''}
        <div class="species">${esc(sp.name)}</div>
      </div>
      <div class="page">${body}</div>
      <footer>◀ ▶ PAGE · ▲ ▼ POKéMON · B BACK</footer>
    </div>`;
  }
}
