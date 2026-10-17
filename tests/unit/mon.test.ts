import { describe, expect, it } from 'vitest';
import { abilityOf, calcStats, createMon, expForLevel, genderOf, initialMoves, levelForExp, natureIndex, type Mon } from '../../src/pokemon/mon';
import type { PokemonFile, Species } from '../../src/data/types';

// FireRed's natures: index i raises stat floor(i / 5) and lowers stat i % 5
// (over Attack, Defense, Speed, Sp. Atk, Sp. Def); equal means neutral.
const NATURE_NAMES = ['HARDY', 'LONELY', 'BRAVE', 'ADAMANT', 'NAUGHTY', 'BOLD', 'DOCILE', 'RELAXED', 'IMPISH', 'LAX', 'TIMID', 'HASTY', 'SERIOUS', 'JOLLY', 'NAIVE', 'MODEST', 'MILD', 'QUIET', 'BASHFUL', 'RASH', 'CALM', 'GENTLE', 'SASSY', 'CAREFUL', 'QUIRKY'];
const natures = NATURE_NAMES.map((name, i) => {
  const mods = [0, 0, 0, 0, 0];
  if (Math.floor(i / 5) !== i % 5) { mods[Math.floor(i / 5)] = 1; mods[i % 5] = -1; }
  return { name, mods };
});

const bulbasaur: Species = {
  name: 'BULBASAUR', base: { hp: 45, atk: 49, def: 49, spe: 45, spa: 65, spd: 65 },
  types: ['TYPE_GRASS', 'TYPE_POISON'], abilities: ['ABILITY_OVERGROW'], growth: 'GROWTH_MEDIUM_SLOW',
  genderRatio: 31, catchRate: 45, expYield: 64, friendship: 70, dex: 1,
  learnset: [[1, 'MOVE_TACKLE'], [4, 'MOVE_GROWL'], [7, 'MOVE_LEECH_SEED'], [10, 'MOVE_VINE_WHIP'], [15, 'MOVE_POISON_POWDER'], [15, 'MOVE_SLEEP_POWDER']],
};
const move = (name: string, pp: number) => ({ name, type: 'TYPE_NORMAL', power: 0, accuracy: 100, pp, effect: 'EFFECT_HIT', effectChance: 0, target: 'MOVE_TARGET_SELECTED', priority: 0, contact: false });
const data: PokemonFile = {
  format: { name: 'pokered3d-pokemon', version: 1 },
  species: { SPECIES_BULBASAUR: bulbasaur, SPECIES_MAGNEMITE: { ...bulbasaur, name: 'MAGNEMITE', genderRatio: 255, abilities: ['ABILITY_MAGNET_PULL', 'ABILITY_STURDY'] } },
  moves: { MOVE_TACKLE: move('TACKLE', 35), MOVE_GROWL: move('GROWL', 40), MOVE_LEECH_SEED: move('LEECH SEED', 10), MOVE_VINE_WHIP: move('VINE WHIP', 10), MOVE_POISON_POWDER: move('POISONPOWDER', 35), MOVE_SLEEP_POWDER: move('SLEEP POWDER', 15) },
  natures, abilities: {}, pics: {},
};
const perfect = { hp: 31, atk: 31, def: 31, spe: 31, spa: 31, spd: 31 };
const none = { hp: 0, atk: 0, def: 0, spe: 0, spa: 0, spd: 0 };

describe('experience', () => {
  it('follows each growth rate', () => {
    expect(expForLevel('GROWTH_MEDIUM_SLOW', 5)).toBe(135);
    expect(expForLevel('GROWTH_MEDIUM_FAST', 5)).toBe(125);
    expect(expForLevel('GROWTH_FAST', 100)).toBe(800000);
    expect(expForLevel('GROWTH_SLOW', 100)).toBe(1250000);
    expect(expForLevel('GROWTH_ERRATIC', 100)).toBe(600000);
    expect(expForLevel('GROWTH_FLUCTUATING', 100)).toBe(1640000);
    expect(expForLevel('GROWTH_MEDIUM_SLOW', 1)).toBe(0);
  });
  it('turns experience back into a level', () => {
    expect(levelForExp('GROWTH_MEDIUM_SLOW', 135)).toBe(5);
    expect(levelForExp('GROWTH_MEDIUM_SLOW', 134)).toBe(4);
    expect(levelForExp('GROWTH_FAST', 800000)).toBe(100);
  });
});

describe('stats', () => {
  it('match the game at level 5 with perfect IVs and a neutral nature', () => {
    // HP: (2*45 + 31) * 5 / 100 = 6, + 5 + 10 = 21. Attack: (2*49 + 31) * 5 / 100 = 6, + 5 = 11.
    // Sp. Atk: (2*65 + 31) * 5 / 100 = 8, + 5 = 13.
    const s = calcStats(data, { species: 'SPECIES_BULBASAUR', level: 5, ivs: perfect, evs: none, personality: 0 /* HARDY */ });
    expect(s).toEqual({ hp: 21, atk: 11, def: 11, spe: 11, spa: 13, spd: 13 });
  });
  it('apply the nature (+10% / -10%, rounded down)', () => {
    // MODEST (15): Sp. Atk up, Attack down. At level 50 with no IVs: Attack 54 -> 48, Sp. Atk 70 -> 77.
    const s = calcStats(data, { species: 'SPECIES_BULBASAUR', level: 50, ivs: none, evs: none, personality: 15 });
    expect(s.atk).toBe(48);
    expect(s.spa).toBe(77);
    expect(s.def).toBe(54);
  });
  it('count a quarter of each EV', () => {
    const s = calcStats(data, { species: 'SPECIES_BULBASAUR', level: 100, ivs: none, evs: { ...none, hp: 255 }, personality: 0 });
    expect(s.hp).toBe(2 * 45 + 63 + 100 + 10);
  });
});

describe('personality', () => {
  it('decides nature, gender and ability', () => {
    expect(natureIndex({ personality: 15 })).toBe(15);
    expect(natureIndex({ personality: 0xffffffff })).toBe(0xffffffff % 25);
    expect(genderOf(bulbasaur, 0x1e)).toBe('female'); // low byte 30 < 31
    expect(genderOf(bulbasaur, 0x1f)).toBe('male');
    expect(genderOf(data.species.SPECIES_MAGNEMITE, 0)).toBe(null);
    expect(abilityOf(data.species.SPECIES_MAGNEMITE, 1)).toBe('ABILITY_STURDY');
    expect(abilityOf(bulbasaur, 1)).toBe('ABILITY_OVERGROW'); // only one ability: always it
  });
});

describe('creating a Pokémon', () => {
  it('knows the moves learned up to its level, keeping the last four', () => {
    expect(initialMoves(data, 'SPECIES_BULBASAUR', 5).map((m) => m.move)).toEqual(['MOVE_TACKLE', 'MOVE_GROWL']);
    expect(initialMoves(data, 'SPECIES_BULBASAUR', 15).map((m) => m.move)).toEqual(['MOVE_LEECH_SEED', 'MOVE_VINE_WHIP', 'MOVE_POISON_POWDER', 'MOVE_SLEEP_POWDER']);
    expect(initialMoves(data, 'SPECIES_BULBASAUR', 5)[0].pp).toBe(35);
  });
  it('rolls personality and IVs, and starts at full HP with the level\'s experience', () => {
    const rolls = [0.5, 0.25, 0.999, 0.001];
    let i = 0;
    const mon: Mon = createMon(data, 'SPECIES_BULBASAUR', 5, () => rolls[i++ % rolls.length], { id: 12345, name: 'RED' });
    expect(mon.personality).toBe(((0x8000 << 16) | 0x4000) >>> 0);
    // 0.999 -> 0xffbe: HP 30, Atk 29, Def 31; 0.001 -> 0x0041: Spe 1, SpA 2, SpD 0
    expect(mon.ivs).toEqual({ hp: 30, atk: 29, def: 31, spe: 1, spa: 2, spd: 0 });
    expect(mon.exp).toBe(135);
    expect(mon.hp).toBe(mon.stats.hp);
    expect(mon.otName).toBe('RED');
    expect(mon.moves.map((m) => m.move)).toEqual(['MOVE_TACKLE', 'MOVE_GROWL']);
  });
});
