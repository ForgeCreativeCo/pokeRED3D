import { describe, expect, it } from 'vitest';
import { applySave, formatTime, makeSave, readSave, SAVE_KEY, SAVE_VERSION, writeSave } from '../../src/save/save';
import { Story } from '../../src/scripts/story';
import type { ItemData } from '../../src/data/types';
import type { Mon } from '../../src/pokemon/mon';

const items: Record<string, ItemData> = { ITEM_POTION: { name: 'POTION', price: 300, pocket: 'ITEMS', description: '', param: 20, fieldUse: null, important: false } };
const mon = { species: 'SPECIES_BULBASAUR', nickname: null, level: 5, exp: 135, personality: 23, otId: 20826, otName: 'RED', ivs: { hp: 1, atk: 2, def: 3, spe: 4, spa: 5, spd: 6 }, evs: { hp: 0, atk: 0, def: 0, spe: 0, spa: 0, spd: 0 }, moves: [{ move: 'MOVE_TACKLE', pp: 35 }], hp: 20, stats: { hp: 20, atk: 9, def: 10, spe: 11, spa: 10, spd: 13 }, friendship: 70, metLevel: 5 } as Mon;

/** A story partway through: a starter, a Potion, some flags and vars. */
function played() {
  const s = new Story(['FLAG_HIDE_OAK_IN_PALLET_TOWN'], 0x1234abcd, items, 3000);
  s.flags.add('FLAG_SYS_POKEMON_GET');
  s.vars.VAR_MAP_SCENE_PALLET_TOWN_OAK = 1;
  s.vars.VAR_TEMP_1 = 7; // map-local: not saved
  s.party.push(structuredClone(mon));
  s.bag.add('ITEM_POTION');
  s.register('SPECIES_BULBASAUR', true);
  s.register('SPECIES_CHARMANDER', false);
  s.money = 3500;
  s.playTime = 3725.6;
  s.options.textSpeed = 'FAST';
  return s;
}

/** A Map-backed stand-in for localStorage. */
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m }; };

describe('saving', () => {
  it('keeps the story and where the player stands, through JSON and back', () => {
    const store = memory();
    expect(writeSave(makeSave(played(), { map: 'PalletTown', x: 12, y: 8, facing: 'up' }, 1000), store)).toBe(true);
    const save = readSave(store)!;
    expect(save.location).toEqual({ map: 'PalletTown', x: 12, y: 8, facing: 'up' });

    const fresh = new Story([], 0, items, 3000);
    applySave(fresh, save);
    expect(fresh.trainerId).toBe(0x1234abcd);
    expect([...fresh.flags].sort()).toEqual(['FLAG_HIDE_OAK_IN_PALLET_TOWN', 'FLAG_SYS_POKEMON_GET']);
    expect(fresh.vars).toEqual({ VAR_MAP_SCENE_PALLET_TOWN_OAK: 1 });
    expect(fresh.party).toEqual([mon]);
    expect(fresh.bag.count('ITEM_POTION')).toBe(1);
    expect(fresh.money).toBe(3500);
    expect([...fresh.dex.seen].sort()).toEqual(['SPECIES_BULBASAUR', 'SPECIES_CHARMANDER']);
    expect([...fresh.dex.caught]).toEqual(['SPECIES_BULBASAUR']);
    expect(fresh.playTime).toBe(3725);
    expect(fresh.options.textSpeed).toBe('FAST');
  });

  it('copies the party, so later changes in the game don\'t reach the save', () => {
    const s = played();
    const save = makeSave(s, { map: 'PalletTown', x: 0, y: 0, facing: 'down' });
    s.party[0].hp = 1;
    expect(save.story.party[0].hp).toBe(20);
  });

  it('ignores a missing, broken or older save', () => {
    const store = memory();
    expect(readSave(store)).toBe(null);
    store.m.set(SAVE_KEY, '{not json');
    expect(readSave(store)).toBe(null);
    store.m.set(SAVE_KEY, JSON.stringify({ version: SAVE_VERSION + 1, location: {}, story: {} }));
    expect(readSave(store)).toBe(null);
    expect(readSave(null)).toBe(null);
  });

  it('reports a write the browser refuses', () => {
    const refusing = { setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(writeSave(makeSave(played(), { map: 'PalletTown', x: 0, y: 0, facing: 'down' }), refusing)).toBe(false);
    expect(writeSave(makeSave(played(), { map: 'PalletTown', x: 0, y: 0, facing: 'down' }), null)).toBe(false);
  });

  it('shows play time as hours and minutes', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(3725)).toBe('1:02');
    expect(formatTime(1e9)).toBe('999:46');
  });
});
