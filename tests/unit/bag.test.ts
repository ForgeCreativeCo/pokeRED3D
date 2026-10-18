import { describe, expect, it } from 'vitest';
import { Bag, MAX_STACK, POCKET_SLOTS } from '../../src/items/bag';
import type { ItemData } from '../../src/data/types';

const item = (name: string, pocket: ItemData['pocket'] = 'ITEMS'): ItemData => ({ name, price: 100, pocket, description: '', param: 0, fieldUse: null, battleUse: null, important: pocket === 'KEY_ITEMS' });
const items: Record<string, ItemData> = {
  ITEM_POTION: item('POTION'), ITEM_ANTIDOTE: item('ANTIDOTE'),
  ITEM_POKE_BALL: item('POKé BALL', 'POKE_BALLS'), ITEM_OAKS_PARCEL: item("OAK'S PARCEL", 'KEY_ITEMS'),
};
// Enough distinct items to fill a pocket.
for (let i = 0; i < 50; i++) items[`ITEM_TEST_${i}`] = item(`TEST ${i}`);

describe('the Bag', () => {
  it('stacks an item and files it in its pocket', () => {
    const bag = new Bag(items);
    expect(bag.add('ITEM_POTION')).toBe(true);
    expect(bag.add('ITEM_POTION', 4)).toBe(true);
    expect(bag.add('ITEM_POKE_BALL', 5)).toBe(true);
    expect(bag.add('ITEM_OAKS_PARCEL')).toBe(true);
    expect(bag.count('ITEM_POTION')).toBe(5);
    expect(bag.pockets.ITEMS).toEqual([{ item: 'ITEM_POTION', count: 5 }]);
    expect(bag.pockets.POKE_BALLS).toEqual([{ item: 'ITEM_POKE_BALL', count: 5 }]);
    expect(bag.pockets.KEY_ITEMS).toEqual([{ item: 'ITEM_OAKS_PARCEL', count: 1 }]);
  });

  it(`holds at most ${MAX_STACK} of one item`, () => {
    const bag = new Bag(items);
    expect(bag.add('ITEM_POTION', MAX_STACK)).toBe(true);
    expect(bag.hasSpace('ITEM_POTION')).toBe(false);
    expect(bag.add('ITEM_POTION')).toBe(false);
    expect(bag.count('ITEM_POTION')).toBe(MAX_STACK);
  });

  it(`has ${POCKET_SLOTS.ITEMS} slots in the ITEMS pocket`, () => {
    const bag = new Bag(items);
    for (let i = 0; i < POCKET_SLOTS.ITEMS; i++) expect(bag.add(`ITEM_TEST_${i}`)).toBe(true);
    expect(bag.add('ITEM_POTION')).toBe(false); // a new item needs a free slot
    expect(bag.add('ITEM_TEST_0')).toBe(true); // an existing stack still grows
    expect(bag.add('ITEM_POKE_BALL')).toBe(true); // other pockets are separate
  });

  it('removes items, and drops a stack once it is empty', () => {
    const bag = new Bag(items);
    bag.add('ITEM_POTION', 3);
    bag.add('ITEM_ANTIDOTE');
    expect(bag.remove('ITEM_POTION', 4)).toBe(false); // not that many: nothing changes
    expect(bag.count('ITEM_POTION')).toBe(3);
    expect(bag.remove('ITEM_POTION', 3)).toBe(true);
    expect(bag.pockets.ITEMS).toEqual([{ item: 'ITEM_ANTIDOTE', count: 1 }]);
    expect(bag.remove('ITEM_POTION')).toBe(false);
  });

  it('ignores items it knows nothing about', () => {
    const bag = new Bag(items);
    expect(bag.add('ITEM_NOT_REAL')).toBe(false);
    bag.load({ ITEMS: [{ item: 'ITEM_NOT_REAL', count: 1 }, { item: 'ITEM_POTION', count: 2 }] });
    expect(bag.pockets.ITEMS).toEqual([{ item: 'ITEM_POTION', count: 2 }]);
  });
});
