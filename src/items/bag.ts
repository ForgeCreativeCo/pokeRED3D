// The Bag: FireRed's five pockets, each a list of item stacks. A stack holds
// up to 999; each pocket has its own number of slots (include/constants/global.h).

import type { ItemData, Pocket } from '../data/types';

export const POCKETS: Pocket[] = ['ITEMS', 'KEY_ITEMS', 'POKE_BALLS', 'TM_CASE', 'BERRY_POUCH'];
export const POCKET_SLOTS: Record<Pocket, number> = { ITEMS: 42, KEY_ITEMS: 30, POKE_BALLS: 13, TM_CASE: 58, BERRY_POUCH: 43 };
export const MAX_STACK = 999;

export interface Stack {
  item: string;
  count: number;
}

export class Bag {
  readonly pockets: Record<Pocket, Stack[]> = { ITEMS: [], KEY_ITEMS: [], POKE_BALLS: [], TM_CASE: [], BERRY_POUCH: [] };

  constructor(private items: Record<string, ItemData>) {}

  private pocketOf(item: string): Stack[] | null {
    const data = this.items[item];
    return data ? this.pockets[data.pocket] : null;
  }

  /** How many of an item the Bag holds. */
  count(item: string): number {
    return this.pocketOf(item)?.find((s) => s.item === item)?.count ?? 0;
  }

  /** CheckBagHasSpace: whether n more fit (in the existing stack, or a free slot). */
  hasSpace(item: string, n = 1): boolean {
    const pocket = this.pocketOf(item);
    if (!pocket) return false;
    const data = this.items[item];
    const stack = pocket.find((s) => s.item === item);
    if (stack) return stack.count + n <= MAX_STACK;
    return pocket.length < POCKET_SLOTS[data.pocket] && n <= MAX_STACK;
  }

  /** AddBagItem: false (and nothing added) when they don't fit. */
  add(item: string, n = 1): boolean {
    if (n <= 0 || !this.hasSpace(item, n)) return false;
    const pocket = this.pocketOf(item)!;
    const stack = pocket.find((s) => s.item === item);
    if (stack) stack.count += n;
    else pocket.push({ item, count: n });
    return true;
  }

  /** RemoveBagItem: false (and nothing removed) when there aren't that many. */
  remove(item: string, n = 1): boolean {
    const pocket = this.pocketOf(item);
    const stack = pocket?.find((s) => s.item === item);
    if (!stack || stack.count < n || n <= 0) return false;
    stack.count -= n;
    if (!stack.count) pocket!.splice(pocket!.indexOf(stack), 1);
    return true;
  }

  /** Every stack, for saving. */
  toJSON(): Record<Pocket, Stack[]> {
    return this.pockets;
  }

  /** Put back what toJSON saved (unknown items are dropped). */
  load(saved: Partial<Record<Pocket, Stack[]>>) {
    for (const p of POCKETS) {
      this.pockets[p].length = 0;
      for (const s of saved[p] ?? []) if (this.items[s.item]) this.pockets[p].push({ item: s.item, count: s.count });
    }
  }
}
