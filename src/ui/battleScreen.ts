// The battle screen, laid out like FireRed's: the background for where the
// battle started, the foe on its platform top right and your Pokémon from
// behind bottom left, an HP box for each, and the message window along the
// bottom with FIGHT / BAG / POKéMON / RUN and the move list.
//
// Everything is placed in the GBA's own 240x160 pixels (sBattlerCoords and
// the pictures' baked offsets), scaled to the window. The battle itself is the
// engine in src/battle/; this plays its events in order: FireRed's text from
// src/battle_message.c, HP bars draining, Pokémon fainting and coming out.

import type { Clock } from '../core/clock';
import type { Input } from '../input/input';
import type { Story } from '../scripts/story';
import type { Music } from '../audio/music';
import type { BattleFile, PokemonFile } from '../data/types';
import { Battle, type BattleEvent, type Side } from '../battle/battle';
import { displayName, expForLevel, genderOf, type Mon } from '../pokemon/mon';
import { TextBox } from './textbox';

export interface BattleStart {
  foe: { wild: Mon } | { trainer: string };
  /** BATTLE_TERRAIN_…, from where the battle started (battleTerrain) */
  terrain: string;
  /** the battle's random stream */
  rng: () => number;
  /** what the trainer says on losing (from the trainerbattle command), after "Player defeated …" */
  loseText?: string;
}

export type BattleOutcome = 'won' | 'lost' | 'ran';

type Mode = 'text' | 'actions' | 'moves' | 'party' | 'forget' | 'yesno';

const ACTIONS = ['FIGHT', 'BAG', 'POKéMON', 'RUN'];
const STAT_INDEX: Record<string, number> = { atk: 1, def: 2, spe: 3, spa: 4, spd: 5, acc: 6, eva: 7 };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const hpClass = (hp: number, max: number) => (hp / max > 0.5 ? 'high' : hp / max > 0.2 ? 'mid' : 'low');

/** Battle text's own codes the text box doesn't use: pauses, sounds, colours. */
const stripCodes = (t: string) => t.replace(/\{(PAUSE|PLAY_SE|PLAY_BGM|WAIT_SE|PALETTE|COLOR_HIGHLIGHT_SHADOW|CLEAR_TO|HIGHLIGHT|PAUSE_UNTIL_PRESS)[^}]*\}/g, '');

export class BattleScreen {
  open = false;
  battle: Battle | null = null;
  private mode: Mode = 'text';
  private sel = 0;
  private root: HTMLElement;
  private tb: TextBox;
  private start: BattleStart | null = null;
  /** HP as the boxes show it while a bar drains */
  private shownHp: Record<Side, number> = { player: 0, foe: 0 };

  constructor(
    private clock: Clock, private input: Input, private story: Story, doc: Document,
    private pokemon: PokemonFile, private data: BattleFile, private music: Music,
    /** the menus' own lines (scripts.json text): Choose a POKéMON., … */
    private ui: Record<string, string>,
  ) {
    this.root = doc.getElementById('battle')!;
    this.root.innerHTML = `
      <div class="bstage">
        <img class="bterrain" alt="">
        <div class="bmon foe"><img alt=""></div>
        <div class="bmon player"><img alt=""></div>
        <div class="btrainer foe"><img alt=""></div>
        <div class="btrainer player"></div>
        <div class="hpbox foe"></div>
        <div class="hpbox player"></div>
        <div class="bmsg" role="status" aria-live="polite"><p></p><p></p><span class="more" hidden aria-hidden="true">▼</span></div>
        <ul class="bmenu" hidden></ul>
        <div class="bmoves" hidden><ul></ul><div class="binfo"></div></div>
        <div class="bparty" hidden></div>
      </div>`;
    const q = (s: string) => this.root.querySelector<HTMLElement>(s)!;
    const msg = q('.bmsg');
    this.tb = new TextBox(clock, input, story, doc, { box: msg, line1: msg.children[0] as HTMLElement, line2: msg.children[1] as HTMLElement, more: q('.bmsg .more') });
  }

  private q<T extends HTMLElement = HTMLElement>(s: string) { return this.root.querySelector<T>(s)!; }

  /** Play a whole battle; resolves with how it ended. The party changes in place. */
  async run(start: BattleStart): Promise<BattleOutcome> {
    this.start = start;
    const battle = (this.battle = new Battle({
      pokemon: this.pokemon, battle: this.data, party: this.story.party, playerId: this.story.trainerId, foe: start.foe, rng: start.rng,
    }));
    const trainer = battle.trainer ? this.data.trainers[battle.trainer] : null;
    const before = this.music.current;
    this.music.play(trainer ? trainer.music.battle : this.data.music.wild);
    this.open = true;
    this.input.clearHeld();
    this.tb.speed = { SLOW: 20, MID: 40, FAST: 80 }[this.story.options.textSpeed];
    this.root.hidden = false;
    this.root.ownerDocument.body.classList.add('battling');
    this.setScene(start.terrain, trainer?.pic ?? null);

    // The opening: the trainer (or wild Pokémon) first, then yours.
    if (trainer) await this.say(this.line('sText_Trainer1WantsToBattle', 'foe'));
    for (const e of battle.start()) await this.play(e);

    while (battle.phase !== 'over') {
      if (battle.phase === 'switch') { await this.forcedSwitch(); continue; }
      const action = await this.chooseAction();
      if (!action) continue;
      await this.playAll(battle.turn(action));
    }
    await this.clock.delayFrames(20);
    this.close();
    this.music.play(before);
    return battle.outcome!;
  }

  private close() {
    this.open = false;
    this.root.hidden = true;
    this.root.ownerDocument.body.classList.remove('battling');
    this.tb.close();
  }

  /** What's on screen, for tests: the menu and its cursor, or the text. */
  get state(): string {
    if (!this.open) return 'closed';
    const b = this.battle!;
    if (this.mode === 'actions') return `battle menu ${ACTIONS[this.sel]}`;
    if (this.mode === 'moves') return `battle moves ${this.moveName(b.mon('player').moves[this.sel]?.move)}`;
    if (this.mode === 'party') return `battle party ${displayName(this.pokemon, b.parties.player[this.sel])}`;
    if (this.mode === 'forget') return `battle forget ${this.sel}`;
    return `battle text ${this.tb.shown}`;
  }

  /** What the message window shows, for tests. */
  get text() { return this.tb.shown; }

  /** The two Pokémon's HP as the boxes show them, for tests. */
  get hp() {
    const b = this.battle;
    return b ? `${b.mon('player').hp}/${b.mon('player').stats.hp} vs ${b.mon('foe').hp}/${b.mon('foe').stats.hp}` : '';
  }

  // ---- text ----

  private name(side: Side): string {
    const b = this.battle!, m = b.mon(side), n = displayName(this.pokemon, m);
    if (side === 'player') return n;
    return (b.trainer ? this.data.text.sText_FoePkmnPrefix : this.data.text.sText_WildPkmnPrefix) + n;
  }

  private trainerName(): string {
    const t = this.data.trainers[this.battle!.trainer!];
    // Rival classes use the rival's name, as GetTrainerName does.
    return /RIVAL|CHAMPION/.test(t.class) ? this.story.names.RIVAL : t.name;
  }

  private moveName(move: string | undefined) {
    return move ? this.pokemon.moves[move]?.name ?? move : '-';
  }

  /** A battle string with its placeholders filled for `side` (the Pokémon it's about). */
  private line(key: string, side: Side, buffs: Record<string, string | number> = {}): string {
    const b = this.battle!;
    const t = this.data.text[key];
    if (t === undefined) return key;
    const trainer = b.trainer ? this.data.trainers[b.trainer] : null;
    return t.replace(/\{(B_\w+)\}/g, (all, k: string) => {
      if (/_NAME_WITH_PREFIX$/.test(k)) return this.name(side);
      switch (k) {
        case 'B_OPPONENT_MON1_NAME': return displayName(this.pokemon, b.mon('foe'));
        case 'B_PLAYER_MON1_NAME': return displayName(this.pokemon, b.mon('player'));
        case 'B_PLAYER_NAME': return this.story.names.PLAYER;
        case 'B_TRAINER1_CLASS': return trainer?.className ?? '';
        case 'B_TRAINER1_NAME': return trainer ? this.trainerName() : '';
        case 'B_BUFF1': case 'B_BUFF2': case 'B_BUFF3': return String(buffs[k.slice(2)] ?? '');
        default: return all;
      }
    });
  }

  /**
   * Show a battle message. One that ends in \p waits for A; others stay up a
   * moment and move on, as battle messages do.
   */
  private async say(text: string) {
    const waits = /\\p$/.test(text) || text.includes('{PAUSE_UNTIL_PRESS}');
    this.mode = 'text';
    await this.tb.say(stripCodes(text).replace(/\\p$/, ''), { wait: waits });
    if (!waits) await this.clock.delayFrames(48);
  }

  // ---- the scene ----

  private setScene(terrain: string, trainerPic: string | null) {
    const bg = this.data.terrains[terrain] ?? this.data.terrains.BATTLE_TERRAIN_PLAIN;
    this.q<HTMLImageElement>('.bterrain').src = bg ?? '';
    const tr = this.q('.btrainer.foe');
    tr.hidden = !trainerPic;
    if (trainerPic) {
      const p = this.data.trainerPics[trainerPic];
      const img = tr.querySelector('img')!;
      img.src = p?.pic ?? '';
      tr.style.setProperty('--y', String(p?.y ?? 0));
      tr.classList.remove('gone');
    }
    const red = this.data.playerPics.RED;
    const me = this.q('.btrainer.player');
    me.style.backgroundImage = red ? `url(${red.pic})` : '';
    me.style.setProperty('--frames', String(red?.frames ?? 1));
    me.classList.remove('gone');
    me.hidden = false;
    for (const side of ['foe', 'player'] as Side[]) {
      this.q(`.bmon.${side}`).classList.add('out');
      this.q(`.hpbox.${side}`).hidden = true;
    }
  }

  /** Put a side's Pokémon on the field (its picture and HP box). */
  private sendOut(side: Side) {
    const b = this.battle!, m = b.mon(side), pic = this.pokemon.pics[m.species];
    const el = this.q(`.bmon.${side}`), img = el.querySelector('img')!;
    img.src = (side === 'foe' ? pic?.front : pic?.back) ?? '';
    img.alt = displayName(this.pokemon, m);
    // Center at sBattlerCoords, moved down by the picture's offset (and up by a foe's elevation).
    el.style.setProperty('--y', String(side === 'foe' ? (pic?.frontY ?? 0) - (pic?.elevation ?? 0) : pic?.backY ?? 0));
    el.classList.remove('out', 'fainted', 'hit');
    this.shownHp[side] = m.hp;
    this.q(`.hpbox.${side}`).hidden = false;
    this.renderHpBox(side);
  }

  private renderHpBox(side: Side, expFrom?: number) {
    const b = this.battle!, m = b.mon(side), sp = this.pokemon.species[m.species];
    const hp = this.shownHp[side], max = m.stats.hp;
    const g = genderOf(sp, m.personality);
    const gender = g === 'male' ? '<span class="male">♂</span>' : g === 'female' ? '<span class="female">♀</span>' : '';
    const status = m.status ? `<span class="bstatus ${m.status.kind}">${{ sleep: 'SLP', poison: 'PSN', toxic: 'PSN', burn: 'BRN', freeze: 'FRZ', paralysis: 'PAR' }[m.status.kind]}</span>` : '';
    let html = `<div class="row1"><span class="name">${esc(displayName(this.pokemon, m))}</span>${gender}<span class="lv">Lv${m.level}</span></div>`
      + `<div class="row2">${status}<span class="hpbar"><b>HP</b><span class="track"><span class="fill ${hpClass(hp, max)}" style="width:${Math.max(0, (hp / max) * 100)}%"></span></span></span></div>`;
    if (side === 'player') {
      const lo = expForLevel(sp.growth, m.level), hi = expForLevel(sp.growth, m.level + 1);
      const exp = expFrom ?? m.exp;
      const pct = m.level >= 100 ? 0 : Math.max(0, Math.min(100, ((exp - lo) / (hi - lo)) * 100));
      html += `<div class="row3"><span class="hpnum">${hp}/ ${max}</span></div><div class="expbar"><b>EXP</b><span class="track"><span class="fill" style="width:${pct}%"></span></span></div>`;
    }
    this.q(`.hpbox.${side}`).innerHTML = html;
  }

  /** Drain (or fill) a side's HP bar to its real HP, about as fast as FireRed's. */
  private async animateHp(side: Side) {
    const target = this.battle!.mon(side).hp;
    const from = this.shownHp[side];
    if (from === target) { this.renderHpBox(side); return; }
    const frames = Math.min(60, Math.max(12, Math.abs(target - from) * 2));
    for (let f = 1; f <= frames; f++) {
      this.shownHp[side] = Math.round(from + ((target - from) * f) / frames);
      this.renderHpBox(side);
      await this.clock.delayFrames(1);
    }
  }

  private async flash(side: Side) {
    const el = this.q(`.bmon.${side}`);
    el.classList.add('hit');
    await this.clock.delayFrames(30);
    el.classList.remove('hit');
  }

  // ---- playing events ----

  private async playAll(events: BattleEvent[]) {
    for (let i = 0; i < events.length; i++) await this.play(events[i], events[i - 1]);
  }

  private async play(e: BattleEvent, prev?: BattleEvent) {
    const b = this.battle!, T = this.data.text;
    switch (e.type) {
      case 'send-out':
        if (e.side === 'foe') {
          if (b.trainer) {
            this.q('.btrainer.foe').classList.add('gone');
            this.sendOut('foe');
            await this.say(this.line('sText_Trainer1SentOutPkmn', 'foe'));
          } else {
            this.sendOut('foe');
            await this.say(this.line('sText_WildPkmnAppeared', 'foe'));
          }
          this.story.register(b.mon('foe').species, false);
        } else {
          this.q('.btrainer.player').classList.add('gone');
          await this.clock.delayFrames(10);
          this.q('.btrainer.player').hidden = true;
          this.sendOut('player');
          await this.say(this.line('sText_GoPkmn', 'player'));
        }
        break;
      case 'withdraw':
        await this.say(this.line('sText_PkmnComeBack', e.side, { BUFF1: displayName(this.pokemon, b.parties[e.side][e.party]) }));
        this.q(`.bmon.${e.side}`).classList.add('out');
        this.q(`.hpbox.${e.side}`).hidden = true;
        break;
      case 'move':
        await this.say(this.line('sText_AttackerUsedX', e.side, { BUFF2: this.moveName(e.move) }) + T.sText_ExclamationMark);
        break;
      case 'miss': await this.say(this.line('sText_AttackMissed', e.side)); break;
      case 'no-effect': await this.say(this.line('sText_ItDoesntAffect', e.side)); break;
      case 'damage':
        await this.flash(e.side);
        await this.animateHp(e.side);
        if (e.crit) await this.say(T.sText_CriticalHit);
        if (e.effectiveness === 'super') await this.say(T.sText_SuperEffective);
        if (e.effectiveness === 'not-very') await this.say(T.sText_NotVeryEffective);
        break;
      case 'stat': {
        const how = (Math.abs(e.change) >= 2 ? (e.change > 0 ? T.sText_StatSharply : T.sText_StatHarshly) : '') + (e.change > 0 ? T.gBattleText_Rose : T.sText_StatFell);
        await this.say(this.line('sText_DefendersStatFell', e.side, { BUFF1: this.data.statNames[STAT_INDEX[e.stat]], BUFF2: how }));
        break;
      }
      case 'stat-limit':
        await this.say(this.line(e.up ? 'sText_StatsWontIncrease' : 'sText_StatsWontDecrease', e.side, { BUFF1: this.data.statNames[STAT_INDEX[e.stat]] }));
        break;
      case 'status': {
        const key = { sleep: 'sText_PkmnFellAsleep', poison: 'sText_PkmnWasPoisoned', toxic: 'sText_PkmnBadlyPoisoned', burn: 'sText_PkmnWasBurned', freeze: 'sText_PkmnWasFrozen', paralysis: 'sText_PkmnWasParalyzed' }[e.status];
        this.renderHpBox(e.side);
        await this.say(this.line(key, e.side));
        break;
      }
      case 'already': {
        const key = { sleep: 'sText_PkmnAlreadyAsleep', poison: 'sText_PkmnAlreadyPoisoned', toxic: 'sText_PkmnAlreadyPoisoned', burn: 'sText_PkmnAlreadyHasBurn', paralysis: 'sText_PkmnIsAlreadyParalyzed', freeze: 'sText_ButItFailed' }[e.status];
        await this.say(this.line(key, e.side));
        break;
      }
      case 'status-end':
        this.renderHpBox(e.side);
        await this.say(this.line(e.status === 'sleep' ? 'sText_PkmnWokeUp' : 'sText_PkmnWasDefrosted2', e.side));
        break;
      case 'cant-move':
        await this.say(this.line({ sleep: 'sText_PkmnFastAsleep', freeze: 'sText_PkmnIsFrozen', paralysis: 'sText_PkmnIsParalyzed', flinch: 'sText_PkmnFlinched' }[e.reason], e.side));
        break;
      case 'confused': await this.say(this.line('sText_PkmnIsConfused', e.side)); break;
      case 'confusion-start': await this.say(this.line('sText_PkmnWasConfused', e.side)); break;
      case 'confusion-hurt':
        await this.say(T.sText_ItHurtConfusion);
        await this.flash(e.side);
        await this.animateHp(e.side);
        break;
      case 'confusion-end': await this.say(this.line('sText_PkmnHealedConfusion', e.side)); break;
      case 'seeded': await this.say(this.line('sText_PkmnSeeded', e.side)); break;
      case 'focus-energy': await this.say(this.line('gBattleText_GetPumped', e.side)); break;
      case 'status-damage':
        await this.say(this.line({ poison: 'sText_PkmnHurtByPoison', burn: 'sText_PkmnHurtByBurn', 'leech-seed': 'sText_PkmnSappedByLeechSeed' }[e.cause], e.side));
        await this.flash(e.side);
        await this.animateHp(e.side);
        break;
      case 'heal':
        await this.animateHp(e.side);
        // Draining moves: the one hit "had its energy drained" (Leech Seed's healing is silent).
        if (prev?.type === 'damage') await this.say(this.line('sText_PkmnEnergyDrained', prev.side));
        break;
      case 'recoil':
        await this.animateHp(e.side);
        await this.say(this.line('sText_PkmnHitWithRecoil', e.side));
        break;
      case 'fail': await this.say(T.sText_ButItFailed); break;
      case 'faint': {
        const el = this.q(`.bmon.${e.side}`);
        el.classList.add('fainted');
        await this.clock.delayFrames(24);
        this.q(`.hpbox.${e.side}`).hidden = true;
        // In the wild, beating the Pokémon starts the victory song (Cmd_getexp).
        if (e.side === 'foe' && !b.trainer && b.mon('player').hp > 0) this.music.play(this.data.music.wildVictory);
        await this.say(this.line('sText_AttackerFainted', e.side));
        break;
      }
      case 'exp': {
        const m = b.parties.player[e.party];
        const boosted = m.otId !== this.story.trainerId ? T.sText_ABoosted : '';
        await this.say(this.line('sText_PkmnGainedEXP', 'player', { BUFF1: displayName(this.pokemon, m), BUFF2: boosted, BUFF3: e.amount }));
        if (e.party === b.active.player.party) this.renderHpBox('player');
        break;
      }
      case 'level-up': {
        const m = b.parties.player[e.party];
        if (e.party === b.active.player.party) { this.shownHp.player = m.hp; this.renderHpBox('player'); }
        await this.say(this.line('sText_PkmnGrewToLv', 'player', { BUFF1: displayName(this.pokemon, m), BUFF2: e.level }));
        break;
      }
      case 'learn': {
        const m = b.parties.player[e.party];
        await this.say(this.line('sText_PkmnLearnedMove', 'player', { BUFF1: displayName(this.pokemon, m), BUFF2: this.moveName(e.move) }));
        break;
      }
      case 'learn-prompt': await this.learnPrompt(e.party, e.move); break;
      case 'run':
        if (e.reason === 'trainer') await this.say(T.sText_NoRunningFromTrainers);
        else await this.say(e.ok ? T.sText_GotAwaySafely : T.sText_CantEscape);
        break;
      case 'need-switch': break;
      case 'end': await this.ending(e.outcome, e.money); break;
    }
  }

  private async ending(outcome: BattleOutcome, money?: number) {
    const b = this.battle!;
    if (outcome === 'won' && b.trainer) {
      this.music.play(this.data.trainers[b.trainer].music.victory);
      const tr = this.q('.btrainer.foe');
      tr.classList.remove('gone');
      await this.say(this.line('sText_PlayerDefeatedLinkTrainerTrainer1', 'foe'));
      if (this.start?.loseText) await this.say(this.start.loseText + '\\p');
      if (money) {
        this.story.money = Math.min(999999, this.story.money + money);
        await this.say(this.line('sText_PlayerGotMoney', 'player', { BUFF1: money }));
      }
    }
    if (outcome === 'lost') {
      await this.say(this.line(b.trainer ? 'sText_PlayerWhiteoutAgainstTrainer' : 'sText_PlayerWhiteout', 'player'));
      await this.say(this.line('sText_PlayerWhiteout2', 'player') + '\\p');
    }
  }

  // ---- choosing ----

  /** The action menu and what it leads to; null when the choice was backed out of. */
  private async chooseAction(): Promise<Parameters<Battle['turn']>[0] | null> {
    const b = this.battle!;
    // "What will BULBASAUR do?" stays up beside the menu.
    await this.tb.say(stripCodes(this.line('gText_WhatWillPkmnDo', 'player')), { wait: false });
    const pick = await this.menu('actions', ACTIONS.length, 0);
    if (pick === null) return null;
    const action = ACTIONS[pick];
    if (action === 'FIGHT') {
      const moves = b.mon('player').moves;
      if (moves.every((m) => m.pp === 0)) {
        await this.say(this.line('sText_PkmnHasNoMovesLeft', 'player'));
        return { type: 'move', slot: 0 }; // Struggle
      }
      const slot = await this.menu('moves', moves.length, 0);
      if (slot === null) return null;
      if (moves[slot].pp === 0) { await this.say(this.data.text.sText_NoPPLeft); return null; }
      return { type: 'move', slot };
    }
    if (action === 'BAG') { await this.say(this.data.text.sText_ItemsCantBeUsedNow); return null; }
    if (action === 'POKéMON') {
      const party = await this.pickPartyMon(true);
      return party === null ? null : { type: 'switch', party };
    }
    return { type: 'run' };
  }

  /** After your Pokémon faints: in the wild, "Use next POKéMON?" first; then pick one. */
  private async forcedSwitch() {
    const b = this.battle!;
    if (!b.trainer) {
      await this.tb.say(stripCodes(this.data.text.sText_UseNextPkmn), { wait: false });
      if (!(await this.tb.yesNo())) {
        await this.playAll(b.flee());
        return;
      }
    }
    const party = await this.pickPartyMon(false);
    if (party !== null) await this.playAll(b.switchIn(party));
  }

  /** The party list; resolves the slot to send out, or null (B, when allowed). */
  private async pickPartyMon(canCancel: boolean): Promise<number | null> {
    const b = this.battle!;
    for (;;) {
      const slot = await this.menu('party', b.parties.player.length, b.active.player.party, canCancel);
      if (slot === null) return null;
      const m = b.parties.player[slot];
      this.story.names.STR_VAR_1 = displayName(this.pokemon, m);
      if (m.hp === 0) { await this.say(this.ui.gText_PkmnHasNoEnergy); continue; }
      if (slot === b.active.player.party && b.mon('player').hp > 0) { await this.say(this.ui.gText_PkmnAlreadyInBattle); continue; }
      return slot;
    }
  }

  /** "X is trying to learn Y…": pick a move to forget, or give up on Y. */
  private async learnPrompt(party: number, move: string) {
    const b = this.battle!, m = b.parties.player[party];
    const buffs = { BUFF1: displayName(this.pokemon, m), BUFF2: this.moveName(move) };
    for (;;) {
      await this.say(this.line('sText_TryToLearnMove1', 'player', buffs));
      await this.say(this.line('sText_TryToLearnMove2', 'player', buffs));
      await this.tb.say(stripCodes(this.line('sText_TryToLearnMove3', 'player', buffs)), { wait: false });
      if (await this.tb.yesNo()) {
        const slot = await this.menu('forget', 4, 0, true, party, move);
        if (slot !== null) {
          const forgotten = this.moveName(m.moves[slot].move);
          await this.say(this.data.text.sText_123Poof);
          await this.say(this.line('sText_PkmnForgotMove', 'player', { BUFF1: buffs.BUFF1, BUFF2: forgotten }));
          await this.say(this.data.text.sText_AndEllipsis);
          for (const ev of b.learnMove(slot)) await this.play(ev);
          return;
        }
      }
      await this.tb.say(stripCodes(this.line('sText_StopLearningMove', 'player', buffs)), { wait: false });
      if (await this.tb.yesNo()) {
        b.learnMove(null);
        await this.say(this.line('sText_DidNotLearnMove', 'player', buffs));
        return;
      }
    }
  }

  /**
   * A menu: the cursor moves with the d-pad, A picks, B backs out (when
   * allowed). The action and move menus are two columns, as in FireRed.
   */
  private menu(mode: Mode, count: number, start: number, canCancel = true, forParty = 0, newMove = ''): Promise<number | null> {
    this.mode = mode;
    this.sel = start;
    const cols = mode === 'actions' || mode === 'moves' ? 2 : 1;
    const total = mode === 'forget' ? 5 : count;
    this.renderMenu(forParty, newMove);
    this.input.takeA();
    return new Promise((resolve) => {
      this.clock.until(() => {
        const key = this.input.taken();
        if (!key) return false;
        const done = (v: number | null) => { this.hideMenus(); this.mode = 'text'; resolve(v); return true; };
        if (key === 'b' && canCancel) return done(null);
        // The new move itself (the fifth line) means not learning it.
        if (key === 'a') return done(mode === 'forget' && this.sel === 4 ? null : this.sel);
        const r = Math.floor(this.sel / cols), c = this.sel % cols, rows = Math.ceil(total / cols);
        let next = this.sel;
        if (key === 'up') next = cols === 1 ? (this.sel + total - 1) % total : ((r + rows - 1) % rows) * cols + c;
        if (key === 'down') next = cols === 1 ? (this.sel + 1) % total : ((r + 1) % rows) * cols + c;
        if (key === 'left' && cols === 2) next = r * cols + ((c + 1) % 2);
        if (key === 'right' && cols === 2) next = r * cols + ((c + 1) % 2);
        if (next < total) this.sel = next;
        this.renderMenu(forParty, newMove);
        return false;
      });
    });
  }

  private hideMenus() {
    this.q('.bmenu').hidden = true;
    this.q('.bmoves').hidden = true;
    this.q('.bparty').hidden = true;
  }

  private renderMenu(forParty: number, newMove: string) {
    const b = this.battle!;
    this.hideMenus();
    if (this.mode === 'text') return;
    const sel = (i: number) => (i === this.sel ? ' class="sel"' : '');
    if (this.mode === 'actions') {
      const el = this.q('.bmenu');
      el.innerHTML = ACTIONS.map((a, i) => `<li${sel(i)}>${a}</li>`).join('');
      el.hidden = false;
    } else if (this.mode === 'moves') {
      const moves = b.mon('player').moves, el = this.q('.bmoves');
      el.querySelector('ul')!.innerHTML = [0, 1, 2, 3].map((i) => `<li${sel(i)}>${moves[i] ? esc(this.moveName(moves[i].move)) : '-'}</li>`).join('');
      const m = moves[this.sel], data = m && this.pokemon.moves[m.move];
      const low = m && m.pp <= Math.floor((data?.pp ?? 0) / 4) ? (m.pp === 0 ? ' none' : ' low') : '';
      el.querySelector('.binfo')!.innerHTML = m
        ? `<span class="pp${low}">${this.data.text.gText_MoveInterfacePP ?? 'PP '}${m.pp}/${data?.pp ?? 0}</span><span>${this.data.text.gText_MoveInterfaceType ?? 'TYPE/'}${this.data.types.names[data?.type ?? ''] ?? ''}</span>` : '';
      el.hidden = false;
      this.tb.close();
    } else if (this.mode === 'party' || this.mode === 'forget') {
      const el = this.q('.bparty');
      el.classList.toggle('forget', this.mode === 'forget');
      if (this.mode === 'party') {
        el.innerHTML = `<p class="bprompt">${esc(stripCodes(this.ui.gText_ChoosePokemon))}</p><ul>${b.parties.player.map((m, i) => `<li${sel(i)}>`
          + `<span class="name">${esc(displayName(this.pokemon, m))}</span><span class="lv">Lv${m.level}</span>`
          + `<span class="hpbar"><b>HP</b><span class="track"><span class="fill ${hpClass(m.hp, m.stats.hp)}" style="width:${(m.hp / m.stats.hp) * 100}%"></span></span></span>`
          + `<span class="hpnum">${m.hp}/ ${m.stats.hp}</span></li>`).join('')}</ul>`;
      } else {
        const m = b.parties.player[forParty];
        const rows = [...m.moves.map((x) => x.move), newMove];
        el.innerHTML = `<p class="bprompt">${esc(stripCodes(this.ui.gText_WhichMoveToForget))}</p><ul>${rows.map((mv, i) => {
          const d = this.pokemon.moves[mv];
          return `<li${sel(i)}${i === 4 ? ' data-new' : ''}><span class="name">${esc(this.moveName(mv))}</span><span class="lv">${this.data.types.names[d?.type ?? ''] ?? ''}</span><span class="hpnum">PP ${d?.pp ?? 0}</span></li>`;
        }).join('')}</ul>`;
      }
      el.hidden = false;
    }
  }

}
