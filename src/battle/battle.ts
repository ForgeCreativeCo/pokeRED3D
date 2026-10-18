// A single battle, as FireRed runs one: the player's party against a wild
// Pokémon or a trainer's party. It's pure logic, with no page or three.js:
// each call takes the player's choice and returns what happened as events,
// which the battle screen turns into text, HP bars and animations.
//
// The order of a turn follows the decomp: running and switching first, then
// moves by priority and speed (GetWhoStrikesFirst), each move through the
// attack cancellers (sleep, freeze, flinch, confusion, paralysis), accuracy,
// critical hit, damage, type and random factor, then its effect; then the end
// of the turn (Leech Seed, poison, burn) for each battler in turn order. A
// defeated foe gives experience to the Pokémon that fought it.
//
// Not in yet: double battles, held items, weather, the Bag in battle,
// catching, trainer AI beyond picking a move at random, and move effects
// beyond the ones the early game uses (see EFFECTS).

import type { BattleFile, ItemData, MoveData, PokemonFile, TrainerMon } from '../data/types';
import { abilityOf, buildMon, calcStats, expForLevel, initialMoves, type MajorStatus, type Mon } from '../pokemon/mon';
import {
  ballBonus, ballShakes, baseDamage, battleSpeed, catchOdds, bGoesFirst, critStage, effectiveness, escapes, expGained, finalDamage, gainEvs, hitChance, hits,
  isCrit, noStages, prizeMoney, typeMultipliers, type Effectiveness, type Fighter, type StageKey, type Stages,
} from './rules';

export type Side = 'player' | 'foe';
export const other = (s: Side): Side => (s === 'player' ? 'foe' : 'player');

export type Outcome = 'won' | 'lost' | 'ran' | 'caught';

export type Action =
  | { type: 'move'; slot: number }
  | { type: 'switch'; party: number }
  | { type: 'run' }
  /** a Bag item: a ball at the foe, or medicine for a party slot */
  | { type: 'item'; item: string; party?: number };

export type BattleEvent =
  /** a Pokémon comes out: wild ones appear, trainers send theirs, the player says "Go!" */
  | { type: 'send-out'; side: Side; party: number }
  | { type: 'withdraw'; side: Side; party: number }
  | { type: 'move'; side: Side; move: string }
  | { type: 'miss'; side: Side }
  | { type: 'no-effect'; side: Side }
  | { type: 'damage'; side: Side; amount: number; hp: number; crit: boolean; effectiveness: Effectiveness }
  | { type: 'stat'; side: Side; stat: StageKey; change: number }
  /** a stat that can't go higher or lower */
  | { type: 'stat-limit'; side: Side; stat: StageKey; up: boolean }
  | { type: 'status'; side: Side; status: MajorStatus['kind'] }
  | { type: 'already'; side: Side; status: MajorStatus['kind'] }
  /** woke up, thawed out */
  | { type: 'status-end'; side: Side; status: 'sleep' | 'freeze' }
  /** couldn't move: fast asleep, frozen solid, fully paralysed, flinched */
  | { type: 'cant-move'; side: Side; reason: 'sleep' | 'freeze' | 'paralysis' | 'flinch' }
  /** is confused (before it tries to move) */
  | { type: 'confused'; side: Side }
  /** became confused */
  | { type: 'confusion-start'; side: Side }
  | { type: 'confusion-hurt'; side: Side; amount: number; hp: number }
  | { type: 'confusion-end'; side: Side }
  | { type: 'seeded'; side: Side }
  | { type: 'focus-energy'; side: Side }
  /** poison, burn and Leech Seed at the end of a turn */
  | { type: 'status-damage'; side: Side; cause: 'poison' | 'burn' | 'leech-seed'; amount: number; hp: number }
  | { type: 'heal'; side: Side; amount: number; hp: number }
  | { type: 'recoil'; side: Side; amount: number; hp: number }
  | { type: 'fail' }
  | { type: 'faint'; side: Side; party: number }
  | { type: 'exp'; party: number; amount: number }
  | { type: 'level-up'; party: number; level: number; before: Mon['stats']; after: Mon['stats'] }
  | { type: 'learn'; party: number; move: string }
  /** the moveset is full: the player picks one to forget, or not (learnMove) */
  | { type: 'learn-prompt'; party: number; move: string }
  | { type: 'run'; ok: boolean; reason?: 'trainer' }
  /** the player must send out another Pokémon (switchIn) */
  | { type: 'need-switch' }
  /** "RED used POKé BALL!" */
  | { type: 'item'; item: string }
  /** a ball thrown: blocked by a trainer, or how many times it shook (4 is a catch) */
  | { type: 'ball'; item: string; blocked?: boolean; shakes: number }
  /** medicine restored a party Pokémon's HP */
  | { type: 'restore'; party: number; amount: number; hp: number }
  | { type: 'end'; outcome: Outcome; money?: number }
  /**
   * The first battle's tutorial (BATTLE_TYPE_FIRST_BATTLE): Oak's comment the
   * first time the foe takes damage, and the first time the player lowers one
   * of its stats.
   */
  | { type: 'oak'; line: 'damage' | 'stats' };

/**
 * The move effects handled so far, from data/battle_scripts_1.s. A damaging
 * move with an effect not listed here still hits, without its extra; a status
 * move not listed fails.
 */
export const EFFECTS = new Set([
  'EFFECT_HIT', 'EFFECT_QUICK_ATTACK', 'EFFECT_HIGH_CRITICAL', 'EFFECT_ALWAYS_HIT', 'EFFECT_VITAL_THROW',
  // Gust doubles against a Pokémon in the air (Fly, Bounce); until those exist it's a plain hit.
  'EFFECT_GUST',
  'EFFECT_ABSORB', 'EFFECT_RECOIL', 'EFFECT_DOUBLE_EDGE',
  'EFFECT_POISON_HIT', 'EFFECT_BURN_HIT', 'EFFECT_FREEZE_HIT', 'EFFECT_PARALYZE_HIT', 'EFFECT_CONFUSE_HIT', 'EFFECT_FLINCH_HIT',
  'EFFECT_BLAZE_KICK', 'EFFECT_POISON_TAIL', 'EFFECT_THAW_HIT',
  'EFFECT_SLEEP', 'EFFECT_POISON', 'EFFECT_TOXIC', 'EFFECT_PARALYZE', 'EFFECT_WILL_O_WISP', 'EFFECT_CONFUSE',
  'EFFECT_LEECH_SEED', 'EFFECT_FOCUS_ENERGY',
]);

const STAT_EFFECT_NAMES: Record<string, StageKey> = {
  ATTACK: 'atk', DEFENSE: 'def', SPEED: 'spe', SPECIAL_ATTACK: 'spa', SPECIAL_DEFENSE: 'spd', ACCURACY: 'acc', EVASION: 'eva',
};
/** EFFECT_ATTACK_DOWN, EFFECT_SPEED_UP_2, EFFECT_DEFENSE_DOWN_HIT, … */
export function statEffect(effect: string): { stat: StageKey; change: number; hit: boolean } | null {
  const m = effect.match(/^EFFECT_(ATTACK|DEFENSE|SPEED|SPECIAL_ATTACK|SPECIAL_DEFENSE|ACCURACY|EVASION)_(UP|DOWN)(_2)?(_HIT)?$/);
  if (!m) return null;
  return { stat: STAT_EFFECT_NAMES[m[1]], change: (m[2] === 'UP' ? 1 : -1) * (m[3] ? 2 : 1), hit: !!m[4] };
}
export const isHandled = (effect: string) => EFFECTS.has(effect) || statEffect(effect) !== null;

/** The status a damaging move's effect may cause. */
const SECONDARY_STATUS: Record<string, MajorStatus['kind'] | 'confusion' | 'flinch'> = {
  EFFECT_POISON_HIT: 'poison', EFFECT_POISON_TAIL: 'poison', EFFECT_BURN_HIT: 'burn', EFFECT_BLAZE_KICK: 'burn', EFFECT_THAW_HIT: 'burn',
  EFFECT_FREEZE_HIT: 'freeze', EFFECT_PARALYZE_HIT: 'paralysis', EFFECT_CONFUSE_HIT: 'confusion', EFFECT_FLINCH_HIT: 'flinch',
};

/** A Pokémon out on the field, with what lasts only while it's out. */
interface Battler {
  side: Side;
  party: number;
  stages: Stages;
  /** confusion turns left */
  confusion: number;
  flinched: boolean;
  /** seeded by Leech Seed: the side whose Pokémon drains it */
  seededBy: Side | null;
  focusEnergy: boolean;
  /** turns of bad poison so far */
  toxic: number;
  fainted: boolean;
}

export interface BattleSetup {
  pokemon: PokemonFile;
  battle: BattleFile;
  /** the player's party; the battle changes it in place (HP, PP, status, experience) */
  party: Mon[];
  playerId: number;
  /** a wild Pokémon, or a trainer by TRAINER_… id */
  foe: { wild: Mon } | { trainer: string };
  /** [0, 1), the battle's own stream */
  rng: () => number;
  /**
   * The first battle (trainerbattle_earlyrival with RIVAL_BATTLE_TUTORIAL):
   * the player's damaging moves can't miss until the foe first takes damage,
   * their stat moves can't miss until a foe's stat first falls, and there are
   * no critical hits until that first damage (Cmd_accuracycheck, Cmd_critcalc).
   */
  firstBattle?: boolean;
  /** the items, for what they do in battle */
  items?: Record<string, ItemData>;
  /** whether the player has caught a species before (the Repeat Ball) */
  caughtBefore?: (species: string) => boolean;
  /** the battle is underwater (the Dive Ball) */
  underwater?: boolean;
}

export class Battle {
  readonly pokemon: PokemonFile;
  readonly data: BattleFile;
  readonly parties: Record<Side, Mon[]>;
  readonly trainer: string | null;
  readonly active: Record<Side, Battler>;
  /** 'action': waiting for the player's choice; 'switch': for a Pokémon to send out; 'over' */
  phase: 'action' | 'switch' | 'over' = 'action';
  outcome: Outcome | null = null;
  /** moves waiting for the player to decide what to forget (learnMove) */
  readonly pendingMoves: { party: number; move: string }[] = [];
  private readonly playerId: number;
  private readonly rng: () => number;
  private runTries = 0;
  readonly firstBattle: boolean;
  /** turns so far (gBattleResults.battleTurnCounter, for the Timer Ball) */
  turns = 0;
  private setup: BattleSetup;
  /** the tutorial's flags: the foe has taken damage; a foe's stat has fallen */
  private tutorial = { damaged: false, lowered: false };
  /** player party slots that have faced the foe that's out */
  private fought = new Set<number>();

  constructor(setup: BattleSetup) {
    this.pokemon = setup.pokemon;
    this.data = setup.battle;
    this.rng = setup.rng;
    this.firstBattle = !!setup.firstBattle;
    this.setup = setup;
    this.playerId = setup.playerId;
    if ('wild' in setup.foe) {
      this.trainer = null;
      this.parties = { player: setup.party, foe: [setup.foe.wild] };
    } else {
      const t = setup.battle.trainers[setup.foe.trainer];
      if (!t) throw new Error(`No trainer ${setup.foe.trainer}`);
      this.trainer = setup.foe.trainer;
      this.parties = { player: setup.party, foe: t.party.map((m) => trainerMon(setup.pokemon, m, ((this.r16() << 16) | this.r16()) >>> 0)) };
    }
    const first = this.parties.player.findIndex((m) => m.hp > 0);
    if (first < 0) throw new Error('No Pokémon that can battle');
    this.active = { player: newBattler('player', first), foe: newBattler('foe', 0) };
    this.fought.add(first);
  }

  /** The opening: the foe appears (or is sent out), then the player's Pokémon. */
  start(): BattleEvent[] {
    return [{ type: 'send-out', side: 'foe', party: 0 }, { type: 'send-out', side: 'player', party: this.active.player.party }];
  }

  mon(side: Side): Mon { return this.parties[side][this.active[side].party]; }

  /** One turn: the player's choice, the foe's, then both carried out. */
  turn(action: Action): BattleEvent[] {
    if (this.phase !== 'action') throw new Error(`Not choosing an action (${this.phase})`);
    if (this.pendingMoves.length) throw new Error('A move is waiting to be learned');
    const ev: BattleEvent[] = [];
    // Running and switching come before any move.
    if (action.type === 'run') {
      if (this.trainer) return [{ type: 'run', ok: false, reason: 'trainer' }];
      if (this.tryRun(ev)) return ev;
    }
    if (action.type === 'switch') this.switchTo('player', action.party, ev);
    // Items too, before any move; a caught Pokémon ends the battle.
    if (action.type === 'item') { this.useItem(action.item, action.party, ev); if (this.outcome === 'caught') return ev; }

    const foeSlot = this.chooseMove('foe');
    const playerSlot = action.type === 'move' ? this.checkSlot(action.slot) : null;
    // Whoever chose a move; one sent out mid-turn to replace them doesn't act.
    const chose = { player: this.active.player.party, foe: this.active.foe.party };
    const order = this.order(playerSlot, foeSlot);
    for (const side of order) {
      if (this.phase !== 'action') break;
      const slot = side === 'player' ? playerSlot : foeSlot;
      if (slot === null || this.active[side].party !== chose[side] || this.mon(side).hp === 0 || this.mon(other(side)).hp === 0) continue;
      this.useMove(side, slot, ev);
      this.afterFaints(ev);
    }
    if (this.phase === 'action' && this.mon('player').hp > 0 && this.mon('foe').hp > 0) this.endTurn(order, ev);
    for (const side of ['player', 'foe'] as Side[]) this.active[side].flinched = false;
    this.turns++;
    return ev;
  }

  /**
   * A Bag item. A ball (BattleUseFunc_PokeBallEtc) goes at the foe: a trainer
   * blocks it; otherwise Cmd_handleballthrow decides the shakes, and four is
   * a catch. Medicine restores a party Pokémon's HP by the item's amount
   * (255: all of it). The item is used up either way; taking it from the Bag
   * is the screen's job.
   */
  private useItem(item: string, party: number | undefined, ev: BattleEvent[]) {
    const data = this.setup.items?.[item];
    ev.push({ type: 'item', item });
    if (data?.battleUse === 'BattleUseFunc_PokeBallEtc') {
      if (this.trainer) { ev.push({ type: 'ball', item, blocked: true, shakes: 0 }); return; }
      const foe = this.mon('foe'), sp = this.pokemon.species[foe.species];
      const bonus = ballBonus(item, { types: sp.types, level: foe.level }, {
        caughtBefore: !!this.setup.caughtBefore?.(foe.species), turns: this.turns, underwater: !!this.setup.underwater,
      });
      const odds = catchOdds(sp.catchRate, bonus, foe.stats.hp, foe.hp, foe.status ?? null);
      const shakes = item === 'ITEM_MASTER_BALL' ? 4 : ballShakes(odds, this.r16);
      ev.push({ type: 'ball', item, shakes });
      if (shakes === 4) this.finish('caught', ev);
      return;
    }
    const mon = this.parties.player[party ?? this.active.player.party];
    if (data && data.param > 0 && mon && mon.hp > 0) {
      const amount = Math.min(mon.stats.hp - mon.hp, data.param === 255 ? mon.stats.hp : data.param);
      mon.hp += amount;
      ev.push({ type: 'restore', party: party ?? this.active.player.party, amount, hp: mon.hp });
    }
  }

  /** After the player's Pokémon fainted: send out another. */
  switchIn(party: number): BattleEvent[] {
    if (this.phase !== 'switch') throw new Error('Nothing to switch in for');
    const ev: BattleEvent[] = [];
    this.phase = 'action';
    this.switchTo('player', party, ev, false);
    if (this.foeWaiting) {
      this.foeWaiting = false;
      this.switchTo('foe', this.parties.foe.findIndex((m) => m.hp > 0), ev, false);
    }
    return ev;
  }

  /**
   * "Use next POKéMON?" NO, in a wild battle: try to run, with the fainted
   * Pokémon's speed as TryRunFromBattle would read it. Failing, the player
   * still has to send one out.
   */
  flee(): BattleEvent[] {
    if (this.phase !== 'switch' || this.trainer) throw new Error("Can't flee now");
    const ev: BattleEvent[] = [];
    if (!this.tryRun(ev)) ev.push({ type: 'need-switch' });
    return ev;
  }

  /**
   * Answer a learn-prompt: forget the move in `forget` (0-3) for the new one,
   * or null to give up on learning it.
   */
  learnMove(forget: number | null): BattleEvent[] {
    const p = this.pendingMoves.shift();
    if (!p) throw new Error('No move to learn');
    if (forget === null) return [];
    this.parties.player[p.party].moves[forget] = { move: p.move, pp: this.pokemon.moves[p.move].pp };
    return [{ type: 'learn', party: p.party, move: p.move }];
  }

  // ---- the turn ----

  private r16 = () => Math.floor(this.rng() * 0x10000);

  fighter(side: Side): Fighter {
    const m = this.mon(side), b = this.active[side], sp = this.pokemon.species[m.species];
    return { species: m.species, level: m.level, hp: m.hp, stats: m.stats, stages: b.stages, types: sp.types, ability: abilityOf(sp, m.personality), status: m.status ?? null };
  }

  /** Which order the two sides move in this turn. */
  private order(playerSlot: number | null, foeSlot: number | null): Side[] {
    const prio = (side: Side, slot: number | null) => (slot === null ? 0 : this.pokemon.moves[this.moveAt(side, slot)].priority);
    const a = { speed: battleSpeed(this.fighter('player')), priority: prio('player', playerSlot) };
    const b = { speed: battleSpeed(this.fighter('foe')), priority: prio('foe', foeSlot) };
    const roll = a.speed === b.speed && a.priority === b.priority ? this.r16() : 0;
    return bGoesFirst(a, b, roll) ? ['foe', 'player'] : ['player', 'foe'];
  }

  /** The move in a slot, or Struggle when nothing has PP left. */
  private moveAt(side: Side, slot: number): string {
    return slot < 0 ? 'MOVE_STRUGGLE' : this.mon(side).moves[slot].move;
  }

  /** A chosen move slot, or Struggle (-1) when no move has PP left. */
  private checkSlot(slot: number): number {
    const moves = this.mon('player').moves;
    if (moves.every((m) => m.pp === 0)) return -1;
    if (!moves[slot] || moves[slot].pp === 0) throw new Error(`No PP left for move slot ${slot}`);
    return slot;
  }

  /** Wild Pokémon (and, for now, trainers) pick a move with PP at random; -1 is Struggle. */
  private chooseMove(side: Side): number {
    const usable = this.mon(side).moves.map((m, i) => (m.pp > 0 ? i : -1)).filter((i) => i >= 0);
    if (!usable.length) return -1;
    return usable[this.r16() % usable.length];
  }

  private tryRun(ev: BattleEvent[]): boolean {
    const p = this.mon('player'), f = this.mon('foe');
    const ok = abilityOf(this.pokemon.species[p.species], p.personality) === 'ABILITY_RUN_AWAY' || escapes(p.stats.spe, f.stats.spe, this.runTries, this.r16());
    this.runTries++;
    ev.push({ type: 'run', ok });
    if (ok) this.finish('ran', ev);
    return ok;
  }

  private switchTo(side: Side, party: number, ev: BattleEvent[], withdraw = true) {
    const mon = this.parties[side][party];
    if (!mon || mon.hp === 0 || (party === this.active[side].party && this.mon(side).hp > 0)) throw new Error(`Can't send out party slot ${party}`);
    if (withdraw) ev.push({ type: 'withdraw', side, party: this.active[side].party });
    // Leech Seed on the foe keeps draining for whoever comes in.
    this.active[side] = newBattler(side, party);
    if (side === 'player') this.fought.add(party);
    else this.fought = new Set([this.active.player.party]);
    ev.push({ type: 'send-out', side, party });
  }

  /** One Pokémon using one move: cancellers, then the move. */
  private useMove(side: Side, slot: number, ev: BattleEvent[]) {
    const mon = this.mon(side);
    if (!this.canMove(side, ev)) return;
    const moveId = this.moveAt(side, slot);
    const move = this.pokemon.moves[moveId];
    ev.push({ type: 'move', side, move: moveId });
    if (slot >= 0) mon.moves[slot].pp = Math.max(0, mon.moves[slot].pp - 1);
    // A frozen Pokémon using a move that thaws it (Flame Wheel) thaws out.
    if (move.effect === 'EFFECT_THAW_HIT' && mon.status?.kind === 'freeze') { mon.status = undefined; ev.push({ type: 'status-end', side, status: 'freeze' }); }
    if (move.power > 0) this.damagingMove(side, move, moveId === 'MOVE_STRUGGLE', ev);
    else this.statusMove(side, move, ev);
  }

  /** The attack cancellers (AtkCanceller_UnableToUseMove), in the decomp's order. */
  private canMove(side: Side, ev: BattleEvent[]): boolean {
    const mon = this.mon(side), b = this.active[side];
    if (mon.status?.kind === 'sleep') {
      const turns = mon.status.turns - (this.fighter(side).ability === 'ABILITY_EARLY_BIRD' ? 2 : 1);
      if (turns > 0) { mon.status = { kind: 'sleep', turns }; ev.push({ type: 'cant-move', side, reason: 'sleep' }); return false; }
      mon.status = undefined;
      ev.push({ type: 'status-end', side, status: 'sleep' });
    }
    if (mon.status?.kind === 'freeze') {
      if (this.r16() % 5) { ev.push({ type: 'cant-move', side, reason: 'freeze' }); return false; }
      mon.status = undefined;
      ev.push({ type: 'status-end', side, status: 'freeze' });
    }
    if (b.flinched) { b.flinched = false; ev.push({ type: 'cant-move', side, reason: 'flinch' }); return false; }
    if (b.confusion > 0) {
      b.confusion--;
      if (b.confusion > 0) {
        ev.push({ type: 'confused', side });
        if (!(this.r16() & 1)) {
          // It hurts itself: a 40-power typeless physical hit on itself, no random factor.
          const self = this.fighter(side);
          const amount = Math.min(mon.hp, baseDamage(this.data, self, self, this.pokemon.moves.MOVE_POUND, false, 40));
          mon.hp -= amount;
          ev.push({ type: 'confusion-hurt', side, amount, hp: mon.hp });
          return false;
        }
      } else ev.push({ type: 'confusion-end', side });
    }
    if (mon.status?.kind === 'paralysis' && this.r16() % 4 === 0) { ev.push({ type: 'cant-move', side, reason: 'paralysis' }); return false; }
    return true;
  }

  private damagingMove(side: Side, move: MoveData, struggle: boolean, ev: BattleEvent[]) {
    const foe = other(side), target = this.mon(foe), user = this.mon(side);
    const att = this.fighter(side), def = this.fighter(foe);
    const sure = this.firstBattle && side === 'player' && !this.tutorial.damaged;
    if (!sure && !hits(hitChance(move, att, def, this.data), this.r16())) { ev.push({ type: 'miss', side }); return; }
    // The crit roll happens either way; the first battle has none before the first damage.
    const crit = isCrit(critStage(move, this.active[side].focusEnergy), def, this.r16()) && !(this.firstBattle && !this.tutorial.damaged);
    const multipliers = struggle ? [] : def.ability === 'ABILITY_LEVITATE' && move.type === 'TYPE_GROUND' ? [0] : typeMultipliers(this.data, move.type, def.types);
    const eff = struggle ? 'normal' : effectiveness(multipliers);
    if (eff === 'none') { ev.push({ type: 'no-effect', side: foe }); return; }
    const damage = finalDamage(baseDamage(this.data, att, def, move, crit), { crit, stab: att.types.includes(move.type), multipliers, roll: this.r16(), struggle });
    const dealt = Math.min(target.hp, damage);
    target.hp -= dealt;
    ev.push({ type: 'damage', side: foe, amount: dealt, hp: target.hp, crit, effectiveness: eff });
    if (this.firstBattle && foe === 'foe' && !this.tutorial.damaged) { this.tutorial.damaged = true; ev.push({ type: 'oak', line: 'damage' }); }

    // What comes with the hit.
    if (move.effect === 'EFFECT_ABSORB') this.heal(side, Math.max(1, Math.floor(dealt / 2)), ev);
    // Struggle and Take Down: a quarter of the damage back (MOVE_EFFECT_RECOIL_25); Double-Edge a third.
    const recoilShare = struggle || move.effect === 'EFFECT_RECOIL' ? 4 : move.effect === 'EFFECT_DOUBLE_EDGE' ? 3 : 0;
    if (recoilShare) {
      const amount = Math.min(user.hp, Math.max(1, Math.floor(dealt / recoilShare)));
      user.hp -= amount;
      ev.push({ type: 'recoil', side, amount, hp: user.hp });
    }
    if (target.hp === 0 || def.ability === 'ABILITY_SHIELD_DUST') return;
    const stat = statEffect(move.effect);
    const secondary = SECONDARY_STATUS[move.effect];
    if (!stat?.hit && !secondary) return;
    // Cmd_seteffectwithchance: Random() % 100 <= chance (x2 with Serene Grace).
    const chance = move.effectChance * (att.ability === 'ABILITY_SERENE_GRACE' ? 2 : 1);
    if (this.r16() % 100 > chance) return;
    if (stat) this.changeStat(stat.change > 0 ? side : foe, stat.stat, stat.change, ev, true, side);
    else if (secondary === 'flinch') { if (def.ability !== 'ABILITY_INNER_FOCUS') this.active[foe].flinched = true; }
    else if (secondary === 'confusion') this.confuse(foe, ev, true);
    else if (secondary) this.inflict(foe, secondary, ev, true);
  }

  private statusMove(side: Side, move: MoveData, ev: BattleEvent[]) {
    const foe = other(side), att = this.fighter(side), def = this.fighter(foe);
    const stat = statEffect(move.effect);
    const targetsFoe = stat ? stat.change < 0 : !['EFFECT_FOCUS_ENERGY'].includes(move.effect);
    if (!stat && !EFFECTS.has(move.effect)) { ev.push({ type: 'fail' }); return; }
    const sure = this.firstBattle && side === 'player' && !this.tutorial.lowered;
    if (targetsFoe && !sure && !hits(hitChance(move, att, def, this.data), this.r16())) { ev.push({ type: 'miss', side }); return; }
    if (stat) { this.changeStat(stat.change > 0 ? side : foe, stat.stat, stat.change, ev, false, side); return; }
    switch (move.effect) {
      case 'EFFECT_SLEEP': this.inflict(foe, 'sleep', ev, false); break;
      case 'EFFECT_POISON': this.inflict(foe, 'poison', ev, false); break;
      case 'EFFECT_TOXIC': this.inflict(foe, 'toxic', ev, false); break;
      case 'EFFECT_WILL_O_WISP': this.inflict(foe, 'burn', ev, false); break;
      case 'EFFECT_PARALYZE':
        // Thunder Wave goes through the type chart: Ground is immune.
        if (effectiveness(typeMultipliers(this.data, move.type, def.types)) === 'none') { ev.push({ type: 'no-effect', side: foe }); break; }
        this.inflict(foe, 'paralysis', ev, false); break;
      case 'EFFECT_CONFUSE': this.confuse(foe, ev, false); break;
      case 'EFFECT_LEECH_SEED':
        if (def.types.includes('TYPE_GRASS')) { ev.push({ type: 'no-effect', side: foe }); break; }
        if (this.active[foe].seededBy) { ev.push({ type: 'fail' }); break; }
        this.active[foe].seededBy = side;
        ev.push({ type: 'seeded', side: foe });
        break;
      case 'EFFECT_FOCUS_ENERGY':
        if (this.active[side].focusEnergy) { ev.push({ type: 'fail' }); break; }
        this.active[side].focusEnergy = true;
        ev.push({ type: 'focus-energy', side });
        break;
    }
  }

  /** Cmd_statbuffchange: abilities that block drops, and the -6 / +6 limits. */
  private changeStat(side: Side, stat: StageKey, change: number, ev: BattleEvent[], secondary: boolean, by: Side) {
    const b = this.active[side], ability = this.fighter(side).ability;
    if (change < 0 && side !== by) {
      const blocked = ability === 'ABILITY_CLEAR_BODY' || ability === 'ABILITY_WHITE_SMOKE'
        || (stat === 'acc' && ability === 'ABILITY_KEEN_EYE') || (stat === 'atk' && ability === 'ABILITY_HYPER_CUTTER');
      if (blocked) { if (!secondary) ev.push({ type: 'fail' }); return; }
    }
    const next = Math.max(-6, Math.min(6, b.stages[stat] + change));
    if (next === b.stages[stat]) { if (!secondary) ev.push({ type: 'stat-limit', side, stat, up: change > 0 }); return; }
    ev.push({ type: 'stat', side, stat, change: next - b.stages[stat] });
    b.stages[stat] = next;
    if (this.firstBattle && side === 'foe' && by === 'player' && change < 0 && !this.tutorial.lowered) { this.tutorial.lowered = true; ev.push({ type: 'oak', line: 'stats' }); }
  }

  /** SetMoveEffect for a lasting status: type and ability immunities, and one status at a time. */
  private inflict(side: Side, status: MajorStatus['kind'], ev: BattleEvent[], secondary: boolean) {
    const mon = this.mon(side), f = this.fighter(side);
    const immune =
      (status === 'sleep' && (f.ability === 'ABILITY_INSOMNIA' || f.ability === 'ABILITY_VITAL_SPIRIT'))
      || ((status === 'poison' || status === 'toxic') && (f.types.includes('TYPE_POISON') || f.types.includes('TYPE_STEEL') || f.ability === 'ABILITY_IMMUNITY'))
      || (status === 'burn' && (f.types.includes('TYPE_FIRE') || f.ability === 'ABILITY_WATER_VEIL'))
      || (status === 'freeze' && (f.types.includes('TYPE_ICE') || f.ability === 'ABILITY_MAGMA_ARMOR'))
      || (status === 'paralysis' && f.ability === 'ABILITY_LIMBER');
    if (mon.status) {
      if (!secondary) ev.push(mon.status.kind === status ? { type: 'already', side, status } : { type: 'fail' });
      return;
    }
    if (immune) { if (!secondary) ev.push({ type: 'fail' }); return; }
    // Sleep lasts 2-5 turns: (Random() & 3) + 2, counted down before each move.
    mon.status = status === 'sleep' ? { kind: 'sleep', turns: (this.r16() & 3) + 2 } : ({ kind: status } as MajorStatus);
    if (status === 'toxic') this.active[side].toxic = 0;
    ev.push({ type: 'status', side, status });
  }

  /** Confusion lasts 2-5 turns: (Random() & 3) + 2. */
  private confuse(side: Side, ev: BattleEvent[], secondary: boolean) {
    const b = this.active[side];
    if (this.fighter(side).ability === 'ABILITY_OWN_TEMPO' || b.confusion > 0) { if (!secondary) ev.push({ type: 'fail' }); return; }
    b.confusion = (this.r16() & 3) + 2;
    ev.push({ type: 'confusion-start', side });
  }

  private heal(side: Side, amount: number, ev: BattleEvent[]) {
    const mon = this.mon(side);
    const healed = Math.min(amount, mon.stats.hp - mon.hp);
    mon.hp += healed;
    ev.push({ type: 'heal', side, amount: healed, hp: mon.hp });
  }

  /** The end of the turn, battler by battler in turn order: Leech Seed, poison, bad poison, burn. */
  private endTurn(order: Side[], ev: BattleEvent[]) {
    for (const side of order) {
      const mon = this.mon(side), b = this.active[side];
      const hurt = (cause: 'poison' | 'burn' | 'leech-seed', amount: number) => {
        const dealt = Math.min(mon.hp, Math.max(1, amount));
        mon.hp -= dealt;
        ev.push({ type: 'status-damage', side, cause, amount: dealt, hp: mon.hp });
        return dealt;
      };
      if (mon.hp > 0 && b.seededBy && this.mon(b.seededBy).hp > 0) {
        const drained = hurt('leech-seed', Math.floor(mon.stats.hp / 8));
        this.heal(b.seededBy, drained, ev);
      }
      if (mon.hp > 0 && mon.status?.kind === 'poison') hurt('poison', Math.floor(mon.stats.hp / 8));
      if (mon.hp > 0 && mon.status?.kind === 'toxic') { b.toxic = Math.min(15, b.toxic + 1); hurt('poison', Math.floor(mon.stats.hp / 16) * b.toxic); }
      if (mon.hp > 0 && mon.status?.kind === 'burn') hurt('burn', Math.floor(mon.stats.hp / 8));
      this.afterFaints(ev);
      if (this.phase !== 'action') return;
    }
  }

  // ---- fainting, experience, the end ----

  /** Faint whoever is at 0 HP; give experience; bring out the next foe or end the battle. */
  private afterFaints(ev: BattleEvent[]) {
    if (this.phase !== 'action') return;
    const foe = this.mon('foe'), player = this.mon('player');
    if (foe.hp === 0 && !this.active.foe.fainted) {
      this.active.foe.fainted = true;
      ev.push({ type: 'faint', side: 'foe', party: this.active.foe.party });
      foe.status = undefined;
      this.giveExp(foe, ev);
    }
    if (player.hp === 0 && !this.active.player.fainted) {
      this.active.player.fainted = true;
      ev.push({ type: 'faint', side: 'player', party: this.active.player.party });
      player.status = undefined;
      this.fought.delete(this.active.player.party);
    }
    if (foe.hp === 0) {
      const next = this.parties.foe.findIndex((m) => m.hp > 0);
      if (next < 0) {
        const party = this.parties.foe, t = this.trainer ? this.data.trainers[this.trainer] : null;
        this.finish('won', ev, t ? prizeMoney(party[party.length - 1].level, t.money, t.double) : undefined);
        return;
      }
      if (player.hp > 0) this.switchTo('foe', next, ev, false);
    }
    if (player.hp === 0) {
      if (!this.parties.player.some((m) => m.hp > 0)) { this.finish('lost', ev); return; }
      this.phase = 'switch';
      ev.push({ type: 'need-switch' });
      // The foe's next Pokémon comes out once the player has picked theirs.
      if (foe.hp === 0) this.foeWaiting = true;
    }
  }

  private foeWaiting = false;

  private finish(outcome: Outcome, ev: BattleEvent[], money?: number) {
    this.phase = 'over';
    this.outcome = outcome;
    ev.push(money === undefined ? { type: 'end', outcome } : { type: 'end', outcome, money });
  }

  /** Cmd_getexp: the Pokémon that fought it, and are still standing, share the experience. */
  private giveExp(defeated: Mon, ev: BattleEvent[]) {
    const sp = this.pokemon.species[defeated.species];
    const getters = [...this.fought].filter((i) => this.parties.player[i]?.hp > 0).sort((a, b) => a - b);
    for (const i of getters) {
      const mon = this.parties.player[i];
      if (mon.level >= 100) continue;
      const amount = expGained(sp.expYield, defeated.level, getters.length, { trainer: !!this.trainer, traded: mon.otId !== this.playerId });
      ev.push({ type: 'exp', party: i, amount });
      mon.evs = gainEvs(mon.evs, sp.evYield);
      mon.exp += amount;
      this.levelUps(i, ev);
    }
  }

  /** Each level gained: new stats (HP goes up by as much as max HP), and the moves learned at that level. */
  private levelUps(party: number, ev: BattleEvent[]) {
    const mon = this.parties.player[party], sp = this.pokemon.species[mon.species];
    while (mon.level < 100 && mon.exp >= expForLevel(sp.growth, mon.level + 1)) {
      const before = mon.stats;
      mon.level++;
      mon.stats = calcStats(this.pokemon, mon);
      if (mon.hp > 0) mon.hp = Math.min(mon.stats.hp, mon.hp + mon.stats.hp - before.hp);
      ev.push({ type: 'level-up', party, level: mon.level, before, after: mon.stats });
      for (const [lvl, move] of sp.learnset) {
        if (lvl !== mon.level || !this.pokemon.moves[move] || mon.moves.some((m) => m.move === move)) continue;
        if (mon.moves.length < 4) {
          mon.moves.push({ move, pp: this.pokemon.moves[move].pp });
          ev.push({ type: 'learn', party, move });
        } else {
          this.pendingMoves.push({ party, move });
          ev.push({ type: 'learn-prompt', party, move });
        }
      }
    }
  }
}

function newBattler(side: Side, party: number): Battler {
  return { side, party, stages: noStages(), confusion: 0, flinched: false, seededBy: null, focusEnergy: false, toxic: 0, fainted: false };
}

/**
 * CreateNPCTrainerParty: the trainer's Pokémon with its fixed personality,
 * every IV at iv x 31 / 255, and its custom moves or the ones its level gives.
 * The original trainer's id is random.
 */
export function trainerMon(data: PokemonFile, t: TrainerMon, otId: number): Mon {
  const iv = Math.floor((t.iv * 31) / 255);
  const ivs = { hp: iv, atk: iv, def: iv, spe: iv, spa: iv, spd: iv };
  const mon = buildMon(data, t.species, t.level, t.personality, ivs, { id: otId, name: '' });
  if (t.moves) mon.moves = t.moves.filter((m) => data.moves[m]).map((move) => ({ move, pp: data.moves[move].pp }));
  else mon.moves = initialMoves(data, t.species, t.level);
  return mon;
}

