// The FireRed text box: two lines, typed out, scrolling and paging like the
// game, and the YES / NO choice.

import type { Clock } from '../core/clock';
import type { Input } from '../input/input';
import type { Story } from '../scripts/story';

export type BoxStyle = 'normal' | 'sign';
export type TextColor = 'male' | 'female' | 'neutral';

export class TextBox {
  /** characters per second */
  speed = 40;
  private box: HTMLElement;
  private line1: HTMLElement;
  private line2: HTMLElement;
  private more: HTMLElement;
  private choice: HTMLElement;
  private yes: HTMLElement;
  private no: HTMLElement;

  /** `els`: a box of its own (the battle screen's), instead of the page's #textbox */
  constructor(private clock: Clock, private input: Input, private story: Story, doc: Document, els?: { box: HTMLElement; line1: HTMLElement; line2: HTMLElement; more: HTMLElement }) {
    const $ = (id: string) => doc.getElementById(id)!;
    this.box = els?.box ?? $('textbox'); this.line1 = els?.line1 ?? $('tb1'); this.line2 = els?.line2 ?? $('tb2'); this.more = els?.more ?? $('tbMore');
    this.choice = $('yesno'); this.yes = $('yes'); this.no = $('no');
  }

  format(t: string) {
    return t.replace(/\{(\w+)\}/g, (_, k: string) => this.story.names[k] ?? '');
  }

  open(style: BoxStyle, color: TextColor) {
    this.box.hidden = false;
    this.box.dataset.style = style;
    this.box.dataset.color = color;
  }

  close() {
    this.box.hidden = true;
    this.line1.textContent = this.line2.textContent = '';
  }

  /** What the box shows right now ('' when closed), for tests. */
  get shown() {
    return this.box.hidden ? '' : `[${this.box.dataset.style}/${this.box.dataset.color}] ${this.line1.textContent} / ${this.line2.textContent}`;
  }

  /** Type out one string; resolves after the reader dismisses its last line (unless wait is false). */
  async say(raw: string, { style = 'normal' as BoxStyle, color = 'neutral' as TextColor, wait = true } = {}) {
    const { clock, input } = this;
    this.open(style, color);
    const pages = this.format(raw).split('\\p');
    for (let pi = 0; pi < pages.length; pi++) {
      const lines = pages[pi].split(/\\[nl]/);
      this.line1.textContent = this.line2.textContent = '';
      for (let li = 0; li < lines.length; li++) {
        let el = li === 0 ? this.line1 : this.line2;
        if (li >= 2) {
          // Scroll: wait, move line 2 up, type the next line below it.
          this.more.hidden = false;
          await clock.until(input.takeA);
          this.more.hidden = true;
          this.line1.textContent = this.line2.textContent;
          this.line2.textContent = '';
          el = this.line2;
        }
        const line = lines[li];
        let shown = 0;
        input.takeA();
        await clock.until(() => {
          const fast = input.buttons.a || input.buttons.b;
          shown = Math.min(line.length, shown + (fast ? 3 : 1) * this.speed * clock.dt);
          el.textContent = line.slice(0, Math.floor(shown));
          if (input.takeA()) shown = line.length; // a press finishes the line
          el.textContent = line.slice(0, Math.floor(shown));
          return shown >= line.length;
        });
      }
      if (wait || pi < pages.length - 1) {
        this.more.hidden = false;
        await clock.until(input.takeA);
        this.more.hidden = true;
      }
    }
  }

  /** YES / NO in the corner; resolves 1 or 0. B picks NO. */
  async yesNo(): Promise<number> {
    const { input } = this;
    let choice = 1;
    const render = () => { this.yes.classList.toggle('on', choice === 1); this.no.classList.toggle('on', choice === 0); };
    this.choice.hidden = false; render();
    input.takeA();
    await this.clock.until(() => {
      if (input.held.has('up')) choice = 1;
      if (input.held.has('down')) choice = 0;
      render();
      if (input.buttons.bPressed) { input.buttons.bPressed = false; choice = 0; return true; }
      if (input.buttons.aPressed) { input.buttons.aPressed = false; return true; }
      return false;
    });
    this.choice.hidden = true;
    return choice;
  }

  hideChoice() {
    this.choice.hidden = true;
  }
}
