// Game time, and promises that resolve on a later game frame. Scripts wait
// on these, so a scene runs exactly as fast as the frames that drive it.

export class Clock {
  /** seconds of game time so far */
  elapsed = 0;
  /** length of the current frame, in seconds */
  dt = 1 / 60;
  private waiters: { cond: () => boolean; resolve: () => void }[] = [];

  /** Resolves once cond() is true, checked every game frame. */
  until(cond: () => boolean): Promise<void> {
    return new Promise((resolve) => this.waiters.push({ cond, resolve }));
  }

  /** Resolves after n frames of FireRed's 60 per second. */
  delayFrames(n: number): Promise<void> {
    const end = this.elapsed + n / 60;
    return this.until(() => this.elapsed >= end);
  }

  /** Advance game time and wake anything whose wait is over. */
  tick(dt: number) {
    this.elapsed += dt;
    this.dt = dt;
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      if (this.waiters[i].cond()) this.waiters.splice(i, 1)[0].resolve();
    }
  }
}
