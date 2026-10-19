// The save's story state: flags, variables, the names text can insert, the
// player's trainer ID, their party and Bag, money, Pokédex, play time and
// options. Everything here is what a save file keeps (see save/save.ts).

import type { ItemData } from '../data/types';
import type { Mon } from '../pokemon/mon';
import { Bag } from '../items/bag';

export type Value = number | string | undefined;

/** FireRed's OPTION screen (TEXT SPEED changes how fast the text box types). */
export interface Options {
  textSpeed: 'SLOW' | 'MID' | 'FAST';
  battleScene: 'ON' | 'OFF';
  battleStyle: 'SHIFT' | 'SET';
  sound: 'MONO' | 'STEREO';
}

export const defaultOptions = (): Options => ({ textSpeed: 'MID', battleScene: 'ON', battleStyle: 'SHIFT', sound: 'MONO' });

export class Story {
  readonly flags: Set<string>;
  readonly vars: Record<string, Value> = {};
  /** {PLAYER}, {RIVAL}, and the {STR_VAR_n} buffers scripts fill */
  readonly names: Record<string, string> = { PLAYER: 'RED', RIVAL: 'BLUE' };
  /** up to six, in order */
  readonly party: Mon[] = [];
  /** caught with a full party: sent to the PC (one box for now) */
  readonly box: Mon[] = [];
  readonly bag: Bag;
  money = 0;
  /** species seen and caught, for the Pokédex */
  readonly dex = { seen: new Set<string>(), caught: new Set<string>() };
  /** the last heal point (setrespawn): where whiting out wakes you */
  respawn = 'HEAL_LOCATION_PALLET_TOWN';
  /** seconds played */
  playTime = 0;
  options: Options = defaultOptions();

  /** startFlags: flags a new save sets; trainerId: 32 bits (the low 16 show as the ID No.) */
  constructor(startFlags: string[], public trainerId = 0, items: Record<string, ItemData> = {}, money = 0) {
    this.flags = new Set(startFlags);
    this.bag = new Bag(items);
    this.money = money;
  }

  /** FireRed clears the temporary vars and flags whenever a map loads. */
  clearTemps() {
    for (const k of Object.keys(this.vars)) if (k.startsWith('VAR_TEMP_')) delete this.vars[k];
    for (const fl of [...this.flags]) if (fl.startsWith('FLAG_TEMP_')) this.flags.delete(fl);
  }

  /** A Pokémon joins (or is met): the Pokédex marks it. */
  register(species: string, caught: boolean) {
    this.dex.seen.add(species);
    if (caught) this.dex.caught.add(species);
  }
}
