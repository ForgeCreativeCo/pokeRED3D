// A Pokémon as FireRed keeps it: species, level and experience, personality
// (which decides nature, gender and ability), IVs and EVs, moves with PP, and
// the stats calculated from all of that. The formulas are the game's own
// (src/pokemon.c in the decomp).

import type { PokemonFile, Species, StatKey, Stats } from '../data/types';

/**
 * A lasting status (status1 in the decomp): it stays after battle. Sleep
 * counts down the turns left; badly poisoned (toxic) worsens each turn in battle.
 */
export type MajorStatus =
  | { kind: 'sleep'; turns: number }
  | { kind: 'poison' }
  | { kind: 'toxic' }
  | { kind: 'burn' }
  | { kind: 'freeze' }
  | { kind: 'paralysis' };

export interface MonMove {
  move: string;
  pp: number;
}

export interface Mon {
  species: string;
  /** null: use the species name */
  nickname: string | null;
  level: number;
  exp: number;
  /** 32-bit; nature, gender and ability come from it */
  personality: number;
  /** the original trainer's 32-bit id (the low 16 bits are shown as the ID No.) */
  otId: number;
  otName: string;
  ivs: Stats;
  evs: Stats;
  moves: MonMove[];
  hp: number;
  stats: Stats;
  friendship: number;
  metLevel: number;
  /** absent when healthy */
  status?: MajorStatus;
}

export const STAT_KEYS: StatKey[] = ['hp', 'atk', 'def', 'spe', 'spa', 'spd'];
/** the order natures list their +1 / -1 mods in */
const NATURE_STATS: StatKey[] = ['atk', 'def', 'spe', 'spa', 'spd'];
const zeroStats = (): Stats => ({ hp: 0, atk: 0, def: 0, spe: 0, spa: 0, spd: 0 });

/** Total experience at a level (src/data/pokemon/experience_tables.h). */
export function expForLevel(growth: string, n: number): number {
  if (n <= 1) return 0;
  const cube = n * n * n;
  switch (growth) {
    case 'GROWTH_FAST': return Math.floor((4 * cube) / 5);
    case 'GROWTH_MEDIUM_FAST': return cube;
    case 'GROWTH_MEDIUM_SLOW': return Math.floor((6 * cube) / 5) - 15 * n * n + 100 * n - 140;
    case 'GROWTH_SLOW': return Math.floor((5 * cube) / 4);
    case 'GROWTH_ERRATIC':
      if (n <= 50) return Math.floor(((100 - n) * cube) / 50);
      if (n <= 68) return Math.floor(((150 - n) * cube) / 100);
      if (n <= 98) return Math.floor((Math.floor((1911 - 10 * n) / 3) * cube) / 500);
      return Math.floor(((160 - n) * cube) / 100);
    case 'GROWTH_FLUCTUATING':
      if (n <= 15) return Math.floor(((Math.floor((n + 1) / 3) + 24) * cube) / 50);
      if (n <= 36) return Math.floor(((n + 14) * cube) / 50);
      return Math.floor(((Math.floor(n / 2) + 32) * cube) / 50);
    default: return cube;
  }
}

/** The level an amount of experience reaches (1-100). */
export function levelForExp(growth: string, exp: number): number {
  let level = 1;
  while (level < 100 && expForLevel(growth, level + 1) <= exp) level++;
  return level;
}

export const natureIndex = (m: Pick<Mon, 'personality'>) => (m.personality >>> 0) % 25;

/** 'male', 'female' or null (genderless), from the personality's low byte. */
export function genderOf(species: Species, personality: number): 'male' | 'female' | null {
  const r = species.genderRatio;
  if (r === 255) return null;
  if (r === 254) return 'female';
  if (r === 0) return 'male';
  return (personality & 0xff) >= r ? 'male' : 'female';
}

/** The ability slot the personality picks (its lowest bit), falling back to the first. */
export const abilityOf = (species: Species, personality: number) => species.abilities[personality & 1] ?? species.abilities[0];

/** CalculateMonStats: HP and the five others, with the nature's +10% / -10%. */
export function calcStats(data: PokemonFile, m: Pick<Mon, 'species' | 'level' | 'ivs' | 'evs' | 'personality'>): Stats {
  const base = data.species[m.species].base;
  const out = zeroStats();
  out.hp = Math.floor(((2 * base.hp + m.ivs.hp + Math.floor(m.evs.hp / 4)) * m.level) / 100) + m.level + 10;
  const mods = data.natures[natureIndex(m)].mods;
  NATURE_STATS.forEach((k, i) => {
    const n = Math.floor(((2 * base[k] + m.ivs[k] + Math.floor(m.evs[k] / 4)) * m.level) / 100) + 5;
    out[k] = mods[i] > 0 ? Math.floor((n * 110) / 100) : mods[i] < 0 ? Math.floor((n * 90) / 100) : n;
  });
  return out;
}

/** GiveMonInitialMoveset: every move learned up to the level, keeping the last four. */
export function initialMoves(data: PokemonFile, species: string, level: number): MonMove[] {
  const moves: MonMove[] = [];
  for (const [lvl, move] of data.species[species].learnset) {
    if (lvl > level) break;
    if (moves.some((m) => m.move === move) || !data.moves[move]) continue;
    if (moves.length === 4) moves.shift();
    moves.push({ move, pp: data.moves[move].pp });
  }
  return moves;
}

/** A 16-bit roll, as the game's Random() gives. */
const roll16 = (rng: () => number) => Math.floor(rng() * 0x10000);

/**
 * CreateMon: a new Pokémon at a level, with a random personality and IVs.
 * `rng` returns numbers in [0, 1).
 */
export function createMon(data: PokemonFile, species: string, level: number, rng: () => number, ot: { id: number; name: string }): Mon {
  if (!data.species[species]) throw new Error(`No species ${species}`);
  const personality = ((roll16(rng) << 16) | roll16(rng)) >>> 0;
  // IVs come from two 16-bit rolls, five bits each.
  const a = roll16(rng), b = roll16(rng);
  const ivs: Stats = { hp: a & 31, atk: (a >> 5) & 31, def: (a >> 10) & 31, spe: b & 31, spa: (b >> 5) & 31, spd: (b >> 10) & 31 };
  return buildMon(data, species, level, personality, ivs, ot);
}

/** A Pokémon with a given personality and IVs, as CreateMon makes it once those are chosen. */
export function buildMon(data: PokemonFile, species: string, level: number, personality: number, ivs: Stats, ot: { id: number; name: string }): Mon {
  const sp = data.species[species];
  if (!sp) throw new Error(`No species ${species}`);
  const mon: Mon = {
    species, nickname: null, level, exp: expForLevel(sp.growth, level), personality,
    otId: ot.id >>> 0, otName: ot.name, ivs, evs: zeroStats(),
    moves: initialMoves(data, species, level), hp: 0, stats: zeroStats(), friendship: sp.friendship, metLevel: level,
  };
  mon.stats = calcStats(data, mon);
  mon.hp = mon.stats.hp;
  return mon;
}

/** What to call it: the nickname, or the species name. */
export const displayName = (data: PokemonFile, m: Mon) => m.nickname ?? data.species[m.species].name;
