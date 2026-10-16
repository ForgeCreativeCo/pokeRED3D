// The save's story state: flags, variables, and the names text can insert.

export type Value = number | string | undefined;

export class Story {
  readonly flags: Set<string>;
  readonly vars: Record<string, Value> = {};
  /** {PLAYER}, {RIVAL}, and the {STR_VAR_n} buffers scripts fill */
  readonly names: Record<string, string> = { PLAYER: 'RED', RIVAL: 'BLUE' };

  constructor(startFlags: string[]) {
    this.flags = new Set(startFlags);
  }

  /** FireRed clears the temporary vars and flags whenever a map loads. */
  clearTemps() {
    for (const k of Object.keys(this.vars)) if (k.startsWith('VAR_TEMP_')) delete this.vars[k];
    for (const fl of [...this.flags]) if (fl.startsWith('FLAG_TEMP_')) this.flags.delete(fl);
  }
}
