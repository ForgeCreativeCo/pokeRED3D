// The "!" and "?" bubbles a script shows above someone.

import type { Clock } from '../core/clock';
import type { Actor } from '../characters/actor';

export class Emote {
  private el: HTMLElement;
  private actor: Actor | null = null;

  constructor(private clock: Clock, doc: Document) {
    this.el = doc.getElementById('emote')!;
  }

  async show(actor: Actor, mark: string) {
    this.el.textContent = mark;
    this.el.hidden = false;
    this.actor = actor;
    await this.clock.delayFrames(40);
    this.el.hidden = true;
    this.actor = null;
  }

  /** Keep the bubble over its person; project gives page coordinates for the spot above their head. */
  place(project: (a: Actor) => { left: number; top: number }) {
    if (this.el.hidden || !this.actor) return;
    const { left, top } = project(this.actor);
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
  }
}
