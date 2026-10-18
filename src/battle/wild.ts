// Wild Pokémon, as src/wild_encounter.c finds them: after each step onto an
// encounter tile, a cooldown that grows more likely to let one through with
// every step, a 60% roll when the tile's behavior changed, then the map's
// encounter rate out of 1600 (raised a little after every miss), the slot by
// FireRed's weights, and a level within the slot's range. The Pokémon itself
// is made as CreateMonWithNature makes it.
//
// Rolls take a `r16` that gives 16-bit numbers, like the game's Random().

import type { BattleFile, PokemonFile, Stats, WildKind, WildTable } from '../data/types';
import { buildMon, type Mon } from '../pokemon/mon';

/** MAX_ENCOUNTER_RATE */
const MAX_ENCOUNTER_RATE = 1600;
/** TILE_ENCOUNTER_LAND / TILE_ENCOUNTER_WATER */
export const ENCOUNTER_KIND: Record<number, WildKind> = { 1: 'land', 2: 'water' };

/**
 * GetMapBaseEncounterCooldown: steps that always pass between encounters, by
 * the table's rate (none at 80 or more, 8 below 10).
 */
export function baseCooldown(rate: number): number {
  if (rate >= 80) return 0;
  if (rate < 10) return 8;
  return 8 - Math.floor(rate / 10);
}

/** The slot a weighted roll lands in (ChooseWildMonIndex_Land / _WaterRock): `roll` % the total weight. */
export function chooseSlot(weights: number[], roll: number): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = roll % total;
  for (let i = 0; i < weights.length; i++) {
    if (r < weights[i]) return i;
    r -= weights[i];
  }
  return weights.length - 1;
}

/** ChooseWildMonLevel: anywhere in the slot's range, `roll` % its size. */
export function wildLevel(min: number, max: number, roll: number): number {
  const lo = Math.min(min, max), hi = Math.max(min, max);
  return lo + (roll % (hi - lo + 1));
}

/**
 * CreateMonWithNature: a nature first (Random() % 25), then personalities
 * until one has that nature; random IVs; the player as original trainer.
 */
export function createWildMon(data: PokemonFile, species: string, level: number, r16: () => number, ot: { id: number; name: string }): Mon {
  const nature = r16() % 25;
  let personality: number;
  do personality = ((r16() << 16) | r16()) >>> 0;
  while (personality % 25 !== nature);
  const a = r16(), b = r16();
  const ivs: Stats = { hp: a & 31, atk: (a >> 5) & 31, def: (a >> 10) & 31, spe: b & 31, spa: (b >> 5) & 31, spd: (b >> 10) & 31 };
  return buildMon(data, species, level, personality, ivs, ot);
}

/**
 * The encounter state FireRed keeps between steps (sWildEncounterData): the
 * rate buff that grows with each miss, steps since the last encounter, and the
 * behavior of the tile stepped from.
 */
export class WildEncounters {
  private buff = 0;
  private steps = 0;
  private prevBehavior = '';

  constructor(private battle: BattleFile) {}

  /** ResetEncounterRateModifiers */
  reset() {
    this.buff = 0;
    this.steps = 0;
  }

  /**
   * TryStandardWildEncounter after a step onto a tile: the wild Pokémon met,
   * as { species, level }, or null. `leadAbility` is the first party
   * Pokémon's (Stench halves the chance, Illuminate doubles it).
   */
  step(tile: { encounter: number; behavior: string }, mapId: string, leadAbility: string, r16: () => number): { species: string; level: number } | null {
    const kind = ENCOUNTER_KIND[tile.encounter];
    const table: WildTable | undefined = kind ? this.battle.wild.maps[mapId]?.[kind] : undefined;
    const prev = this.prevBehavior;
    this.prevBehavior = tile.behavior;
    if (!kind || !table) return null;
    const effect = leadAbility === 'ABILITY_STENCH' ? 1 : leadAbility === 'ABILITY_ILLUMINATE' ? 2 : 0;

    // HandleWildEncounterCooldown: past the cooldown, or a 5% chance a step (halved / doubled by the ability).
    let minSteps = baseCooldown(table.rate) * 256, encRate = 5 * 256;
    if (effect === 1) { minSteps *= 2; encRate = Math.floor(encRate / 2); }
    if (effect === 2) { minSteps = Math.floor(minSteps / 2); encRate *= 2; }
    minSteps = Math.floor(minSteps / 256);
    encRate = Math.floor(encRate / 256);
    if (this.steps < minSteps) {
      this.steps++;
      if (r16() % 100 >= encRate) return null;
    }

    // StandardWildEncounter: 60% when the tile's behavior changed, then the rate test.
    if (prev !== tile.behavior && r16() % 100 >= 60) return null;
    let rate = table.rate * 16 + Math.floor((this.buff * 16) / 200);
    if (effect === 1) rate = Math.floor(rate / 2);
    if (effect === 2) rate *= 2;
    rate = Math.min(rate, MAX_ENCOUNTER_RATE);
    if (r16() % MAX_ENCOUNTER_RATE >= rate) {
      this.buff += table.rate; // AddToWildEncounterRateBuff (no Repel yet)
      return null;
    }
    const slot = table.mons[chooseSlot(this.battle.wild.slotRates[kind], r16())];
    this.reset();
    return { species: slot.species, level: wildLevel(slot.min, slot.max, r16()) };
  }
}
