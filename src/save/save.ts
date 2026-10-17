// Saving and loading: the story (flags, variables, party, Bag, money,
// Pokédex, time, options) and where the player stands, as JSON in the
// browser's storage. Storage can be missing or refuse writes (a private
// window, blocked site data), so every access is guarded and reports whether
// it worked.

import type { Dir } from '../data/types';
import type { Mon } from '../pokemon/mon';
import type { Pocket } from '../data/types';
import type { Stack } from '../items/bag';
import { defaultOptions, type Options, type Story, type Value } from '../scripts/story';

export const SAVE_KEY = 'pokered3d-save';
export const SAVE_VERSION = 1;

export interface SaveFile {
  version: number;
  /** when it was written (ms since 1970) */
  savedAt: number;
  /** map folder name and the cell in that map */
  location: { map: string; x: number; y: number; facing: Dir };
  story: {
    trainerId: number;
    names: Record<string, string>;
    flags: string[];
    vars: Record<string, Value>;
    party: Mon[];
    bag: Partial<Record<Pocket, Stack[]>>;
    money: number;
    dex: { seen: string[]; caught: string[] };
    playTime: number;
    options: Options;
  };
}

/** Everything a save keeps, from the story and where the player stands. */
export function makeSave(story: Story, location: SaveFile['location'], now = Date.now()): SaveFile {
  return {
    version: SAVE_VERSION,
    savedAt: now,
    location,
    story: {
      trainerId: story.trainerId,
      names: { ...story.names },
      flags: [...story.flags].sort(),
      // Temporary vars belong to the map you're on and are cleared on load anyway.
      vars: Object.fromEntries(Object.entries(story.vars).filter(([k]) => !k.startsWith('VAR_TEMP_'))),
      party: structuredClone(story.party),
      bag: structuredClone(story.bag.toJSON()),
      money: story.money,
      dex: { seen: [...story.dex.seen].sort(), caught: [...story.dex.caught].sort() },
      playTime: Math.floor(story.playTime),
      options: { ...story.options },
    },
  };
}

/** Load a save into a story, replacing all of it (every system keeps the same Story object). */
export function applySave(story: Story, save: SaveFile) {
  const s = save.story;
  story.trainerId = s.trainerId;
  story.flags.clear();
  for (const f of s.flags) story.flags.add(f);
  for (const k of Object.keys(story.vars)) delete story.vars[k];
  Object.assign(story.vars, s.vars);
  Object.assign(story.names, s.names);
  story.party.splice(0, story.party.length, ...structuredClone(s.party));
  story.bag.load(s.bag);
  story.money = s.money;
  story.dex.seen.clear(); story.dex.caught.clear();
  for (const sp of s.dex.seen) story.dex.seen.add(sp);
  for (const sp of s.dex.caught) story.dex.caught.add(sp);
  story.playTime = s.playTime;
  story.options = { ...defaultOptions(), ...s.options };
}

/** The save in storage, if there's a readable one of this version. */
export function readSave(storage: Pick<Storage, 'getItem'> | null = safeStorage()): SaveFile | null {
  try {
    const raw = storage?.getItem(SAVE_KEY);
    if (!raw) return null;
    const save = JSON.parse(raw) as SaveFile;
    return save?.version === SAVE_VERSION && save.location && save.story ? save : null;
  } catch {
    return null;
  }
}

/** Write a save; false if storage refused it. */
export function writeSave(save: SaveFile, storage: Pick<Storage, 'setItem'> | null = safeStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(SAVE_KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

/** localStorage, or null where the page isn't allowed it. */
function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Play time as FireRed shows it: hours and minutes. */
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${Math.min(999, Math.floor(m / 60))}:${String(m % 60).padStart(2, '0')}`;
}
