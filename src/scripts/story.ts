// The save's story state: flags, variables, the names text can insert, the
// player's trainer ID and their party.

import type { Mon } from '../pokemon/mon';

export type Value = number | string | undefined;

export class Story {
  readonly flags: Set<string>;
  readonly vars: Record<string, Value> = {};
  /** {PLAYER}, {RIVAL}, and the {STR_VAR_n} buffers scripts fill */
  readonly names: Record<string, string> = { PLAYER: 'RED', RIVAL: 'BLUE' };
  /** up to six, in order */
  readonly party: Mon[] = [];

  /** startFlags: flags a new save sets; trainerId: 32 bits (the low 16 show as the ID No.) */
  constructor(startFlags: string[], readonly trainerId = 0) {
    this.flags = new Set(startFlags);
  }

  /** FireRed clears the temporary vars and flags whenever a map loads. */
  clearTemps() {
    for (const k of Object.keys(this.vars)) if (k.startsWith('VAR_TEMP_')) delete this.vars[k];
    for (const fl of [...this.flags]) if (fl.startsWith('FLAG_TEMP_')) this.flags.delete(fl);
  }
}
