import { describe, expect, it } from 'vitest';
import { Battle, statEffect, trainerMon, type BattleEvent } from '../../src/battle/battle';
import {
  applyStage, baseDamage, bGoesFirst, effectiveness, escapes, expGained, finalDamage, gainEvs, hitChance, hits, isCrit,
  noStages, prizeMoney, typeMultipliers, whiteOutLoss, type Fighter,
} from '../../src/battle/rules';
import { buildMon, type Mon } from '../../src/pokemon/mon';
import type { BattleFile, MoveData, PokemonFile, Species } from '../../src/data/types';

// FireRed's own numbers for the early game: base stats, yields and learnsets
// (src/data/pokemon/species_info.h), moves (src/data/battle_moves.h), and the
// type chart entries they meet, in gTypeEffectiveness's order.

const NATURE_NAMES = ['HARDY', 'LONELY', 'BRAVE', 'ADAMANT', 'NAUGHTY', 'BOLD', 'DOCILE', 'RELAXED', 'IMPISH', 'LAX', 'TIMID', 'HASTY', 'SERIOUS', 'JOLLY', 'NAIVE', 'MODEST', 'MILD', 'QUIET', 'BASHFUL', 'RASH', 'CALM', 'GENTLE', 'SASSY', 'CAREFUL', 'QUIRKY'];
const natures = NATURE_NAMES.map((name, i) => {
  const mods = [0, 0, 0, 0, 0];
  if (Math.floor(i / 5) !== i % 5) { mods[Math.floor(i / 5)] = 1; mods[i % 5] = -1; }
  return { name, mods };
});
const ev0 = { hp: 0, atk: 0, def: 0, spe: 0, spa: 0, spd: 0 };
const species = (s: Partial<Species> & Pick<Species, 'name' | 'base' | 'types' | 'learnset'>): Species => ({
  abilities: [], growth: 'GROWTH_MEDIUM_SLOW', genderRatio: 31, catchRate: 45, expYield: 64, evYield: ev0, friendship: 70, dex: 0, ...s,
});
const move = (name: string, type: string, power: number, accuracy: number, pp: number, effect = 'EFFECT_HIT', extra: Partial<MoveData> = {}): MoveData => ({
  name, type, power, accuracy, pp, effect, effectChance: 0, target: 'MOVE_TARGET_SELECTED', priority: 0, contact: power > 0, ...extra,
});

const pokemon: PokemonFile = {
  format: { name: 'pokered3d-pokemon', version: 1 },
  species: {
    SPECIES_BULBASAUR: species({
      name: 'BULBASAUR', base: { hp: 45, atk: 49, def: 49, spe: 45, spa: 65, spd: 65 }, types: ['TYPE_GRASS', 'TYPE_POISON'],
      abilities: ['ABILITY_OVERGROW'], expYield: 64, evYield: { ...ev0, spa: 1 },
      learnset: [[1, 'MOVE_TACKLE'], [4, 'MOVE_GROWL'], [7, 'MOVE_LEECH_SEED'], [10, 'MOVE_VINE_WHIP']],
    }),
    SPECIES_SQUIRTLE: species({
      name: 'SQUIRTLE', base: { hp: 44, atk: 48, def: 65, spe: 43, spa: 50, spd: 64 }, types: ['TYPE_WATER'],
      abilities: ['ABILITY_TORRENT'], expYield: 66, evYield: { ...ev0, def: 1 },
      learnset: [[1, 'MOVE_TACKLE'], [4, 'MOVE_TAIL_WHIP'], [7, 'MOVE_BUBBLE']],
    }),
    SPECIES_PIDGEY: species({
      name: 'PIDGEY', base: { hp: 40, atk: 45, def: 40, spe: 56, spa: 35, spd: 35 }, types: ['TYPE_NORMAL', 'TYPE_FLYING'],
      abilities: ['ABILITY_KEEN_EYE'], expYield: 55, evYield: { ...ev0, spe: 1 },
      learnset: [[1, 'MOVE_TACKLE'], [5, 'MOVE_SAND_ATTACK'], [9, 'MOVE_GUST']],
    }),
  },
  moves: {
    MOVE_TACKLE: move('TACKLE', 'TYPE_NORMAL', 35, 95, 35),
    MOVE_POUND: move('POUND', 'TYPE_NORMAL', 40, 100, 35),
    MOVE_GROWL: move('GROWL', 'TYPE_NORMAL', 0, 100, 40, 'EFFECT_ATTACK_DOWN'),
    MOVE_TAIL_WHIP: move('TAIL WHIP', 'TYPE_NORMAL', 0, 100, 30, 'EFFECT_DEFENSE_DOWN'),
    MOVE_SAND_ATTACK: move('SAND-ATTACK', 'TYPE_GROUND', 0, 100, 15, 'EFFECT_ACCURACY_DOWN'),
    MOVE_VINE_WHIP: move('VINE WHIP', 'TYPE_GRASS', 35, 100, 10),
    MOVE_BUBBLE: move('BUBBLE', 'TYPE_WATER', 20, 100, 30, 'EFFECT_SPEED_DOWN_HIT', { effectChance: 10 }),
    MOVE_EMBER: move('EMBER', 'TYPE_FIRE', 40, 100, 25, 'EFFECT_BURN_HIT', { effectChance: 10 }),
    MOVE_LEECH_SEED: move('LEECH SEED', 'TYPE_GRASS', 0, 90, 10, 'EFFECT_LEECH_SEED'),
    MOVE_POISON_POWDER: move('POISONPOWDER', 'TYPE_POISON', 0, 75, 35, 'EFFECT_POISON'),
    MOVE_GUST: move('GUST', 'TYPE_FLYING', 40, 100, 35, 'EFFECT_GUST'),
    MOVE_STRUGGLE: move('STRUGGLE', 'TYPE_NORMAL', 50, 100, 1, 'EFFECT_RECOIL'),
  },
  natures, abilities: {}, pics: {},
};

const battleData: BattleFile = {
  format: { name: 'pokered3d-battle', version: 1 },
  types: {
    chart: [
      ['TYPE_FIRE', 'TYPE_WATER', 5], ['TYPE_FIRE', 'TYPE_GRASS', 20],
      ['TYPE_WATER', 'TYPE_FIRE', 20], ['TYPE_WATER', 'TYPE_WATER', 5], ['TYPE_WATER', 'TYPE_GRASS', 5],
      ['TYPE_GRASS', 'TYPE_FIRE', 5], ['TYPE_GRASS', 'TYPE_WATER', 20], ['TYPE_GRASS', 'TYPE_GRASS', 5], ['TYPE_GRASS', 'TYPE_POISON', 5], ['TYPE_GRASS', 'TYPE_FLYING', 5],
      ['TYPE_POISON', 'TYPE_GRASS', 20], ['TYPE_POISON', 'TYPE_POISON', 5],
      ['TYPE_GROUND', 'TYPE_GRASS', 5], ['TYPE_GROUND', 'TYPE_FLYING', 0],
    ],
    foresight: [['TYPE_NORMAL', 'TYPE_GHOST', 0], ['TYPE_FIGHTING', 'TYPE_GHOST', 0]],
    names: {},
    physical: ['TYPE_NORMAL', 'TYPE_FIGHTING', 'TYPE_FLYING', 'TYPE_POISON', 'TYPE_GROUND', 'TYPE_ROCK', 'TYPE_BUG', 'TYPE_GHOST', 'TYPE_STEEL'],
  },
  wild: { slotRates: { land: [], water: [], rockSmash: [], fishing: [] }, rodGroups: {}, maps: {} },
  trainers: {
    TRAINER_RIVAL_OAKS_LAB_SQUIRTLE: {
      name: 'TERRY', class: 'TRAINER_CLASS_RIVAL_EARLY', className: 'RIVAL', female: false, double: false, items: [], ai: [],
      // The personality the baker works out from "TERRY" and "SQUIRTLE" in the GBA's encoding.
      party: [{ iv: 0, level: 5, species: 'SPECIES_SQUIRTLE', personality: 672136 }],
      money: 4, pic: 'TRAINER_PIC_RIVAL_EARLY', music: { encounter: '', battle: '', victory: '' },
    },
  },
  trainerPics: {}, playerPics: {}, terrains: {}, music: { wild: '', wildVictory: '', caughtIntro: '', caught: '' }, text: {}, statNames: [],
};

const PLAYER = { id: 0x12345678, name: 'RED' };
const perfect = { hp: 31, atk: 31, def: 31, spe: 31, spa: 31, spd: 31 };
/** A level 5 Bulbasaur with perfect IVs and a neutral nature (HARDY): 21 HP, 11 Atk/Def/Spe, 13 Sp. Atk/Def. */
const bulbasaur = (level = 5) => buildMon(pokemon, 'SPECIES_BULBASAUR', level, 0, perfect, PLAYER);
/** A random-number stream that gives these 16-bit values, then repeats the last. */
const rolls = (...values: number[]) => { let i = 0; return () => (values[Math.min(i++, values.length - 1)] + 0.5) / 0x10000; };
const fighter = (m: Mon, over: Partial<Fighter> = {}): Fighter => ({
  species: m.species, level: m.level, hp: m.hp, stats: m.stats, stages: noStages(),
  types: pokemon.species[m.species].types, ability: pokemon.species[m.species].abilities[0] ?? '', status: null, ...over,
});

describe("Blue's Squirtle", () => {
  it('is built as CreateNPCTrainerParty builds it', () => {
    const sq = trainerMon(pokemon, battleData.trainers.TRAINER_RIVAL_OAKS_LAB_SQUIRTLE.party[0], 0);
    // IV 0. Personality 672136 % 25 = 11, HASTY: Speed up, Defense down.
    // HP (88 * 5 / 100 = 4) + 5 + 10 = 19. Atk 96 * 5 / 100 = 4, + 5 = 9. Def 130 * 5 / 100 = 6, + 5 = 11, x0.9 = 9.
    // Spe 86 * 5 / 100 = 4, + 5 = 9, x1.1 = 9. Sp. Atk 100 * 5 / 100 = 5, + 5 = 10. Sp. Def 128 * 5 / 100 = 6, + 5 = 11.
    expect(sq.stats).toEqual({ hp: 19, atk: 9, def: 9, spe: 9, spa: 10, spd: 11 });
    expect(sq.moves.map((m) => m.move)).toEqual(['MOVE_TACKLE', 'MOVE_TAIL_WHIP']);
  });
});

describe('damage', () => {
  const sq = trainerMon(pokemon, battleData.trainers.TRAINER_RIVAL_OAKS_LAB_SQUIRTLE.party[0], 0);
  const b = bulbasaur();

  it('follows CalculateBaseDamage for a physical move', () => {
    // Tackle: 11 Atk x 35 x (2 x 5 / 5 + 2 = 4) / 9 Def = 171, / 50 = 3, + 2 = 5.
    expect(baseDamage(battleData, fighter(b), fighter(sq), pokemon.moves.MOVE_TACKLE, false)).toBe(5);
  });
  it('uses Sp. Atk and Sp. Def for a special type', () => {
    // Vine Whip: 13 x 35 x 4 / 11 = 165, / 50 = 3, + 2 = 5.
    expect(baseDamage(battleData, fighter(b), fighter(sq), pokemon.moves.MOVE_VINE_WHIP, false)).toBe(5);
  });
  it('applies stat stages, and a critical hit ignores the ones against the attacker', () => {
    // Growled twice: 11 x 10 / 20 = 5 Atk. 5 x 35 x 4 / 9 = 77, / 50 = 1, + 2 = 3.
    const growled = fighter(b, { stages: { ...noStages(), atk: -2 } });
    expect(baseDamage(battleData, growled, fighter(sq), pokemon.moves.MOVE_TACKLE, false)).toBe(3);
    expect(baseDamage(battleData, growled, fighter(sq), pokemon.moves.MOVE_TACKLE, true)).toBe(5);
    expect(applyStage(11, 1)).toBe(16);
    expect(applyStage(11, -1)).toBe(7);
  });
  it('halves a burned attacker', () => {
    // 171 / 50 = 3, burned 1, + 2 = 3.
    expect(baseDamage(battleData, fighter(b, { status: { kind: 'burn' } }), fighter(sq), pokemon.moves.MOVE_TACKLE, false)).toBe(3);
  });
  it('boosts Overgrow at a third of max HP', () => {
    // 21 max HP: at 7 HP, Vine Whip's 35 power becomes 52. 13 x 52 x 4 / 11 = 245, / 50 = 4, + 2 = 6.
    expect(baseDamage(battleData, fighter(b, { hp: 7 }), fighter(sq), pokemon.moves.MOVE_VINE_WHIP, false)).toBe(6);
    expect(baseDamage(battleData, fighter(b, { hp: 8 }), fighter(sq), pokemon.moves.MOVE_VINE_WHIP, false)).toBe(5);
  });
  it('then applies crit, STAB, type and the random factor, rounding down at each step', () => {
    // Vine Whip on Squirtle: 5, STAB 7, x2 14, random 100% 14, 85% 11.
    const m = typeMultipliers(battleData, 'TYPE_GRASS', ['TYPE_WATER']);
    expect(m).toEqual([20]);
    expect(finalDamage(5, { crit: false, stab: true, multipliers: m, roll: 0 })).toBe(14);
    expect(finalDamage(5, { crit: false, stab: true, multipliers: m, roll: 15 })).toBe(11);
    // A critical hit doubles first: 10, 15, 30.
    expect(finalDamage(5, { crit: true, stab: true, multipliers: m, roll: 0 })).toBe(30);
    // Tackle 5 at 85%: 4.
    expect(finalDamage(5, { crit: false, stab: false, multipliers: [], roll: 15 })).toBe(4);
  });
  it('keeps at least 1 through each not-very-effective step', () => {
    // 2 x 0.5 = 1, x 0.5 = 0 -> 1.
    expect(finalDamage(2, { crit: false, stab: false, multipliers: [5, 5], roll: 0 })).toBe(1);
    expect(finalDamage(9, { crit: false, stab: false, multipliers: [0], roll: 0 })).toBe(0);
  });
});

describe('types', () => {
  it('reads both of a two-type Pokémon, in the chart\'s order', () => {
    expect(typeMultipliers(battleData, 'TYPE_GRASS', ['TYPE_GRASS', 'TYPE_POISON'])).toEqual([5, 5]);
    expect(effectiveness([5, 5])).toBe('not-very');
    expect(effectiveness([20, 5])).toBe('normal');
    expect(effectiveness([20])).toBe('super');
    expect(effectiveness([])).toBe('normal');
  });
  it('makes Ground miss Flying, and Normal miss Ghost until Foresight', () => {
    expect(effectiveness(typeMultipliers(battleData, 'TYPE_GROUND', ['TYPE_NORMAL', 'TYPE_FLYING']))).toBe('none');
    expect(typeMultipliers(battleData, 'TYPE_NORMAL', ['TYPE_GHOST'])).toEqual([0]);
    expect(typeMultipliers(battleData, 'TYPE_NORMAL', ['TYPE_GHOST'], true)).toEqual([]);
  });
});

describe('accuracy, crits and turn order', () => {
  const b = bulbasaur();
  it('scales accuracy by the stage difference', () => {
    // Tackle 95%; after a Sand-Attack, 75 / 100 of it: 71.
    expect(hitChance(pokemon.moves.MOVE_TACKLE, fighter(b), fighter(b), battleData)).toBe(95);
    const sanded = fighter(b, { stages: { ...noStages(), acc: -1 } });
    expect(hitChance(pokemon.moves.MOVE_TACKLE, sanded, fighter(b), battleData)).toBe(71);
    // It hits when Random() % 100 + 1 is 71 or less.
    expect(hits(71, 70)).toBe(true);
    expect(hits(71, 71)).toBe(false);
    expect(hits(null, 99)).toBe(true);
  });
  it('lands a critical hit one time in 16', () => {
    expect(isCrit(0, fighter(b), 32)).toBe(true);
    expect(isCrit(0, fighter(b), 33)).toBe(false);
    expect(isCrit(0, fighter(b, { ability: 'ABILITY_SHELL_ARMOR' }), 32)).toBe(false);
  });
  it('orders by priority, then speed, then a coin flip', () => {
    expect(bGoesFirst({ speed: 11, priority: 0 }, { speed: 9, priority: 0 }, 0)).toBe(false);
    expect(bGoesFirst({ speed: 11, priority: 0 }, { speed: 9, priority: 1 }, 0)).toBe(true);
    expect(bGoesFirst({ speed: 9, priority: 0 }, { speed: 9, priority: 0 }, 1)).toBe(true);
    expect(bGoesFirst({ speed: 9, priority: 0 }, { speed: 9, priority: 0 }, 2)).toBe(false);
  });
});

describe('after the battle', () => {
  it('gives experience as Cmd_getexp does', () => {
    // A wild level 3 Pidgey: 55 x 3 / 7 = 23. Blue's level 5 Squirtle: 66 x 5 / 7 = 47, x1.5 = 70.
    expect(expGained(55, 3, 1, { trainer: false, traded: false })).toBe(23);
    expect(expGained(66, 5, 1, { trainer: true, traded: false })).toBe(70);
    expect(expGained(66, 5, 2, { trainer: true, traded: true })).toBe(51); // 23, x1.5 = 34, x1.5 = 51
  });
  it('gives effort values up to the limits', () => {
    expect(gainEvs(ev0, { ...ev0, spe: 1 })).toEqual({ ...ev0, spe: 1 });
    expect(gainEvs({ ...ev0, spe: 255 }, { ...ev0, spe: 2 }).spe).toBe(255);
    expect(gainEvs({ ...ev0, hp: 255, atk: 254 }, { ...ev0, atk: 3, def: 3 })).toEqual({ ...ev0, hp: 255, atk: 255, def: 0 });
  });
  it('lets you run by speed', () => {
    // 9 against 11: 9 x 128 / 11 = 104, which must beat the random byte.
    expect(escapes(9, 11, 0, 103)).toBe(true);
    expect(escapes(9, 11, 0, 104)).toBe(false);
    expect(escapes(9, 11, 1, 133)).toBe(true); // + 30 for the second try
    expect(escapes(11, 11, 0, 255)).toBe(true);
  });
  it('pays and charges money', () => {
    expect(prizeMoney(5, 4, false)).toBe(80);
    expect(whiteOutLoss(6, 0, 3000)).toBe(48);
    expect(whiteOutLoss(6, 0, 20)).toBe(20);
  });
});

describe('move effects', () => {
  it('reads stat effects from their names', () => {
    expect(statEffect('EFFECT_ATTACK_DOWN')).toEqual({ stat: 'atk', change: -1, hit: false });
    expect(statEffect('EFFECT_SPEED_DOWN_HIT')).toEqual({ stat: 'spe', change: -1, hit: true });
    expect(statEffect('EFFECT_SPECIAL_DEFENSE_UP_2')).toEqual({ stat: 'spd', change: 2, hit: false });
    expect(statEffect('EFFECT_HIT')).toBeNull();
  });
});

const types = (ev: BattleEvent[]) => ev.map((e) => e.type);

describe('a battle', () => {
  it("beats Blue's Squirtle with Tackle", () => {
    // Every roll 1: moves hit (1 % 100 + 1 = 2), no crits (1 % 16), 99% damage, and Blue picks his second move.
    const party = [bulbasaur()];
    const battle = new Battle({ pokemon, battle: battleData, party, playerId: PLAYER.id, foe: { trainer: 'TRAINER_RIVAL_OAKS_LAB_SQUIRTLE' }, rng: rolls(1) });
    expect(battle.start()).toEqual([{ type: 'send-out', side: 'foe', party: 0 }, { type: 'send-out', side: 'player', party: 0 }]);
    // Bulbasaur (11 Speed) moves first. Tackle: 5 x 99% = 4. Squirtle uses Tail Whip.
    const first = battle.turn({ type: 'move', slot: 0 });
    expect(first).toEqual([
      { type: 'move', side: 'player', move: 'MOVE_TACKLE' },
      { type: 'damage', side: 'foe', amount: 4, hp: 15, crit: false, effectiveness: 'normal' },
      { type: 'move', side: 'foe', move: 'MOVE_TAIL_WHIP' },
      { type: 'stat', side: 'player', stat: 'def', change: -1 },
    ]);
    expect(party[0].moves[0].pp).toBe(34);
    let ev: BattleEvent[] = [];
    for (let i = 0; i < 4; i++) ev = battle.turn({ type: 'move', slot: 0 });
    // 19 HP takes five hits. 70 experience takes 135 to 205: level 6 (179).
    expect(types(ev)).toEqual(['move', 'damage', 'faint', 'exp', 'level-up', 'end']);
    expect(ev.find((e) => e.type === 'exp')).toEqual({ type: 'exp', party: 0, amount: 70 });
    expect(ev.at(-1)).toEqual({ type: 'end', outcome: 'won', money: 80 });
    expect(party[0].level).toBe(6);
    // Level 6 with perfect IVs: 23 max HP, up by 2, so 21 HP becomes 23.
    expect(party[0].stats.hp).toBe(23);
    expect(party[0].hp).toBe(23);
    expect(party[0].evs.def).toBe(1);
    expect(battle.phase).toBe('over');
  });

  it("won't run from a trainer, and runs from a wild Pokémon by speed", () => {
    const trainer = new Battle({ pokemon, battle: battleData, party: [bulbasaur()], playerId: PLAYER.id, foe: { trainer: 'TRAINER_RIVAL_OAKS_LAB_SQUIRTLE' }, rng: rolls(1) });
    expect(trainer.turn({ type: 'run' })).toEqual([{ type: 'run', ok: false, reason: 'trainer' }]);
    expect(trainer.phase).toBe('action');
    // A level 3 Pidgey (Speed 56 x 2 x 3 / 100 = 3, + 5 = 8 with no IVs) is slower: always away.
    const pidgey = buildMon(pokemon, 'SPECIES_PIDGEY', 3, 0, ev0, { id: 1, name: '' });
    const wild = new Battle({ pokemon, battle: battleData, party: [bulbasaur()], playerId: PLAYER.id, foe: { wild: pidgey }, rng: rolls(1) });
    expect(wild.turn({ type: 'run' })).toEqual([{ type: 'run', ok: true }, { type: 'end', outcome: 'ran' }]);
  });

  it('poisons, and poison hurts at the end of each turn', () => {
    const b = bulbasaur();
    b.moves.push({ move: 'MOVE_POISON_POWDER', pp: 35 });
    const pidgey = buildMon(pokemon, 'SPECIES_PIDGEY', 3, 0, ev0, { id: 1, name: '' });
    const battle = new Battle({ pokemon, battle: battleData, party: [b], playerId: PLAYER.id, foe: { wild: pidgey }, rng: rolls(1) });
    const ev = battle.turn({ type: 'move', slot: 2 });
    expect(ev).toContainEqual({ type: 'status', side: 'foe', status: 'poison' });
    // Pidgey: 80 x 3 / 100 = 2, + 3 + 10 = 15 max HP; 15 / 8 = 1 a turn.
    expect(ev.at(-1)).toEqual({ type: 'status-damage', side: 'foe', cause: 'poison', amount: 1, hp: pidgey.hp });
    expect(pidgey.status).toEqual({ kind: 'poison' });
    // Poison Powder again: already poisoned.
    expect(battle.turn({ type: 'move', slot: 2 })).toContainEqual({ type: 'already', side: 'foe', status: 'poison' });
  });

  it('drains with Leech Seed, and Keen Eye keeps its accuracy', () => {
    const pidgey = buildMon(pokemon, 'SPECIES_PIDGEY', 6, 0, ev0, { id: 1, name: '' });
    pidgey.moves = [{ move: 'MOVE_SAND_ATTACK', pp: 15 }];
    const b = bulbasaur(7);
    b.hp -= 5;
    b.moves = [{ move: 'MOVE_LEECH_SEED', pp: 10 }, { move: 'MOVE_SAND_ATTACK', pp: 15 }];
    const battle = new Battle({ pokemon, battle: battleData, party: [b], playerId: PLAYER.id, foe: { wild: pidgey }, rng: rolls(1) });
    // Bulbasaur (level 7: 121 x 7 / 100 = 8, + 5 = 13 Speed) goes before Pidgey (112 x 6 / 100 = 6, + 5 = 11).
    const ev = battle.turn({ type: 'move', slot: 0 });
    expect(ev).toContainEqual({ type: 'seeded', side: 'foe' });
    expect(ev).toContainEqual({ type: 'stat', side: 'player', stat: 'acc', change: -1 });
    // Pidgey: 80 x 6 / 100 = 4, + 6 + 10 = 20 max HP; Leech Seed takes 20 / 8 = 2 and gives it to Bulbasaur.
    expect(ev.slice(-2)).toEqual([
      { type: 'status-damage', side: 'foe', cause: 'leech-seed', amount: 2, hp: 18 },
      { type: 'heal', side: 'player', amount: 2, hp: b.hp },
    ]);
    // Sand-Attack on Pidgey fails: Keen Eye.
    expect(battle.turn({ type: 'move', slot: 1 })).toContainEqual({ type: 'fail' });
  });

  it('asks what to forget when a fifth move comes', () => {
    const b = bulbasaur(6);
    b.moves = ['MOVE_TACKLE', 'MOVE_GROWL', 'MOVE_POUND', 'MOVE_VINE_WHIP'].map((move) => ({ move, pp: 10 }));
    b.exp = 235; // one short of level 7 (236)
    const pidgey = buildMon(pokemon, 'SPECIES_PIDGEY', 2, 0, ev0, { id: 1, name: '' });
    pidgey.hp = 1;
    const battle = new Battle({ pokemon, battle: battleData, party: [b], playerId: PLAYER.id, foe: { wild: pidgey }, rng: rolls(1) });
    const ev = battle.turn({ type: 'move', slot: 0 });
    expect(ev).toContainEqual({ type: 'learn-prompt', party: 0, move: 'MOVE_LEECH_SEED' });
    expect(battle.pendingMoves).toEqual([{ party: 0, move: 'MOVE_LEECH_SEED' }]);
    expect(battle.learnMove(2)).toEqual([{ type: 'learn', party: 0, move: 'MOVE_LEECH_SEED' }]);
    expect(b.moves.map((m) => m.move)).toEqual(['MOVE_TACKLE', 'MOVE_GROWL', 'MOVE_LEECH_SEED', 'MOVE_VINE_WHIP']);
  });

  it('needs another Pokémon when one faints, and is lost when none are left', () => {
    const first = bulbasaur(), second = bulbasaur();
    first.hp = 1;
    const battle = new Battle({ pokemon, battle: battleData, party: [first, second], playerId: PLAYER.id, foe: { trainer: 'TRAINER_RIVAL_OAKS_LAB_SQUIRTLE' }, rng: rolls(0) });
    // Roll 0: Blue picks Tackle, and it hits. Bulbasaur Growls; Tackle knocks out the one at 1 HP.
    const ev = battle.turn({ type: 'move', slot: 1 });
    expect(types(ev).slice(-2)).toEqual(['faint', 'need-switch']);
    expect(battle.phase).toBe('switch');
    expect(() => battle.turn({ type: 'move', slot: 0 })).toThrow();
    expect(battle.switchIn(1)).toEqual([{ type: 'send-out', side: 'player', party: 1 }]);
    second.hp = 1;
    const last = battle.turn({ type: 'move', slot: 1 });
    expect(last.at(-1)).toEqual({ type: 'end', outcome: 'lost' });
  });

  it('uses Struggle when no move has PP, and takes recoil', () => {
    const b = bulbasaur();
    b.moves.forEach((m) => { m.pp = 0; });
    const pidgey = buildMon(pokemon, 'SPECIES_PIDGEY', 3, 0, ev0, { id: 1, name: '' });
    const battle = new Battle({ pokemon, battle: battleData, party: [b], playerId: PLAYER.id, foe: { wild: pidgey }, rng: rolls(1) });
    const ev = battle.turn({ type: 'move', slot: 0 });
    expect(ev[0]).toEqual({ type: 'move', side: 'player', move: 'MOVE_STRUGGLE' });
    expect(types(ev)).toContain('recoil');
  });
});

describe('the first battle', () => {
  it("can't miss or crit before the first damage, and Oak speaks up once", () => {
    // Every roll 96: 96 % 100 + 1 = 97 misses Tackle's 95, and 96 % 16 = 0 is a critical hit.
    const party = [bulbasaur()];
    const battle = new Battle({ pokemon, battle: battleData, party, playerId: PLAYER.id, foe: { trainer: 'TRAINER_RIVAL_OAKS_LAB_SQUIRTLE' }, rng: rolls(96), firstBattle: true });
    const first = battle.turn({ type: 'move', slot: 0 });
    // Bulbasaur's Tackle hits anyway, without the crit (5 at 100%); Blue's Tackle misses as usual.
    expect(first.slice(0, 3)).toEqual([
      { type: 'move', side: 'player', move: 'MOVE_TACKLE' },
      { type: 'damage', side: 'foe', amount: 5, hp: 14, crit: false, effectiveness: 'normal' },
      { type: 'oak', line: 'damage' },
    ]);
    expect(first).toContainEqual({ type: 'miss', side: 'foe' });
    // After that, the usual rules: the same roll misses.
    expect(battle.turn({ type: 'move', slot: 0 })).toContainEqual({ type: 'miss', side: 'player' });
    expect(types(battle.turn({ type: 'move', slot: 1 }))).toContain('oak');
  });
});
