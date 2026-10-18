import { describe, expect, it } from 'vitest';
import { WildEncounters, baseCooldown, chooseSlot, createWildMon, wildLevel } from '../../src/battle/wild';
import type { BattleFile, PokemonFile } from '../../src/data/types';

// Route 1's FireRed table: rate 21, Pidgey and Rattata.
const LAND = [20, 20, 10, 10, 10, 10, 5, 5, 4, 4, 1, 1];
const route1 = {
  rate: 21,
  mons: [
    ['SPECIES_PIDGEY', 3, 3], ['SPECIES_RATTATA', 3, 3], ['SPECIES_PIDGEY', 3, 3], ['SPECIES_RATTATA', 3, 3],
    ['SPECIES_PIDGEY', 2, 2], ['SPECIES_RATTATA', 2, 2], ['SPECIES_PIDGEY', 3, 3], ['SPECIES_RATTATA', 3, 3],
    ['SPECIES_PIDGEY', 4, 4], ['SPECIES_RATTATA', 4, 4], ['SPECIES_PIDGEY', 5, 5], ['SPECIES_RATTATA', 4, 4],
  ].map(([species, min, max]) => ({ species: species as string, min: min as number, max: max as number })),
};
const battle = { wild: { slotRates: { land: LAND, water: [60, 30, 5, 4, 1], rockSmash: [], fishing: [] }, rodGroups: {}, maps: { MAP_ROUTE1: { land: route1 } } } } as unknown as BattleFile;
const grass = { encounter: 1, behavior: 'MB_TALL_GRASS' };
/** A 16-bit roll stream giving these values, then repeating the last. */
const rolls = (...v: number[]) => { let i = 0; return () => v[Math.min(i++, v.length - 1)]; };

describe('wild encounter rules', () => {
  it('waits a cooldown that shrinks as the rate rises', () => {
    expect(baseCooldown(21)).toBe(6); // 8 - 21 / 10
    expect(baseCooldown(80)).toBe(0);
    expect(baseCooldown(5)).toBe(8);
  });
  it("picks a slot by FireRed's weights", () => {
    expect(chooseSlot(LAND, 19)).toBe(0);
    expect(chooseSlot(LAND, 20)).toBe(1);
    expect(chooseSlot(LAND, 40)).toBe(2);
    expect(chooseSlot(LAND, 97)).toBe(9);
    expect(chooseSlot(LAND, 98)).toBe(10);
    expect(chooseSlot(LAND, 199)).toBe(11); // 199 % 100 = 99
  });
  it('rolls a level within the range', () => {
    expect(wildLevel(2, 4, 5)).toBe(4); // 2 + 5 % 3
    expect(wildLevel(4, 2, 0)).toBe(2);
  });
});

describe('a step into tall grass', () => {
  it('meets a Pokémon when every roll passes', () => {
    const w = new WildEncounters(battle);
    // Cooldown: 4 % 100 < 5. New tile: 59 % 100 < 60. Rate: 21 x 16 = 336, and 335 % 1600 < 336.
    // Slot: 20 is the second slot (Rattata, 3). Level: 3 + 0.
    expect(w.step(grass, 'MAP_ROUTE1', '', rolls(4, 59, 335, 20, 0))).toEqual({ species: 'SPECIES_RATTATA', level: 3 });
  });
  it('stops at the cooldown, the new-tile roll, and the rate', () => {
    expect(new WildEncounters(battle).step(grass, 'MAP_ROUTE1', '', rolls(5))).toBeNull();
    expect(new WildEncounters(battle).step(grass, 'MAP_ROUTE1', '', rolls(4, 60))).toBeNull();
    expect(new WildEncounters(battle).step(grass, 'MAP_ROUTE1', '', rolls(4, 59, 336))).toBeNull();
  });
  it('raises the rate a little after each miss', () => {
    const w = new WildEncounters(battle);
    expect(w.step(grass, 'MAP_ROUTE1', '', rolls(4, 59, 336))).toBeNull();
    // Same tile now (no 60% roll), and the buff of 21 adds 21 x 16 / 200 = 1: 337.
    expect(w.step(grass, 'MAP_ROUTE1', '', rolls(4, 336, 0, 0))).toEqual({ species: 'SPECIES_PIDGEY', level: 3 });
  });
  it('lets Stench halve the chance', () => {
    // Cooldown 12 steps, 2% a step; rate 168.
    expect(new WildEncounters(battle).step(grass, 'MAP_ROUTE1', 'ABILITY_STENCH', rolls(2))).toBeNull();
    expect(new WildEncounters(battle).step(grass, 'MAP_ROUTE1', 'ABILITY_STENCH', rolls(1, 0, 168))).toBeNull();
    expect(new WildEncounters(battle).step(grass, 'MAP_ROUTE1', 'ABILITY_STENCH', rolls(1, 0, 167, 0, 0))).not.toBeNull();
  });
  it('finds nothing off encounter tiles or on maps without a table', () => {
    expect(new WildEncounters(battle).step({ encounter: 0, behavior: 'MB_NORMAL' }, 'MAP_ROUTE1', '', rolls(0))).toBeNull();
    expect(new WildEncounters(battle).step(grass, 'MAP_PALLET_TOWN', '', rolls(0))).toBeNull();
  });
});

describe('a wild Pokémon', () => {
  it('has the nature rolled first, as CreateMonWithNature makes it', () => {
    const species = { name: 'PIDGEY', base: { hp: 40, atk: 45, def: 40, spe: 56, spa: 35, spd: 35 }, types: ['TYPE_NORMAL', 'TYPE_FLYING'], abilities: ['ABILITY_KEEN_EYE'], growth: 'GROWTH_MEDIUM_SLOW', genderRatio: 127, catchRate: 255, expYield: 55, evYield: { hp: 0, atk: 0, def: 0, spe: 1, spa: 0, spd: 0 }, friendship: 70, dex: 16, learnset: [] };
    const data = { species: { SPECIES_PIDGEY: species }, moves: {}, natures: Array.from({ length: 25 }, () => ({ name: '', mods: [0, 0, 0, 0, 0] })), abilities: {}, pics: {} } as unknown as PokemonFile;
    // Nature 3 (ADAMANT); personality 0x00000000 is nature 0, so rerolled; 0x00000003 is nature 3.
    const mon = createWildMon(data, 'SPECIES_PIDGEY', 3, rolls(3, 0, 0, 0, 3, 0x7fff, 0x0421), { id: 7, name: 'RED' });
    expect(mon.personality).toBe(3);
    expect(mon.ivs).toEqual({ hp: 31, atk: 31, def: 31, spe: 1, spa: 1, spd: 1 });
    expect(mon.otId).toBe(7);
  });
});
