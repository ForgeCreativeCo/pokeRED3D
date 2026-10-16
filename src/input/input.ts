// Keyboard, the on-screen d-pad and A button. Directions are held; A and B
// also latch a press, taken once by whatever is waiting for one.

import type { Dir } from '../data/types';

const keyDirs: Record<string, Dir> = { w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right' };
const aKeys = new Set(['z', 'enter', ' ', 'e']);
const bKeys = new Set(['x', 'backspace', 'escape', 'q']);

export class Input {
  /** held directions, most recent last */
  readonly held = new Set<Dir>();
  readonly buttons = { a: false, b: false, aPressed: false, bPressed: false };

  /** True once per press (A or B: both advance text, as in FireRed). */
  takeA = () => {
    const p = this.buttons.aPressed || this.buttons.bPressed;
    this.buttons.aPressed = this.buttons.bPressed = false;
    return p;
  };

  clearHeld() {
    this.held.clear();
  }

  /** The direction to walk: the last one pressed of those held. */
  get direction(): Dir | undefined {
    return [...this.held].pop();
  }

  attach(doc: Document) {
    const buttons = this.buttons;
    addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if ((e.target as Element | null)?.closest?.('input, button')) return;
      if (aKeys.has(k)) { if (!buttons.a) buttons.aPressed = true; buttons.a = true; e.preventDefault(); }
      if (bKeys.has(k)) { if (!buttons.b) buttons.bPressed = true; buttons.b = true; }
    });
    addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      if (aKeys.has(k)) buttons.a = false;
      if (bKeys.has(k)) buttons.b = false;
    });
    const aBtn = doc.getElementById('aBtn')!;
    aBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); buttons.aPressed = true; buttons.a = true; aBtn.classList.add('held'); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) aBtn.addEventListener(ev, () => { buttons.a = false; aBtn.classList.remove('held'); });

    addEventListener('keydown', (e) => {
      const dir = keyDirs[e.key.toLowerCase()];
      if (!dir || (e.target as Element | null)?.closest?.('input')) return;
      this.held.add(dir);
      e.preventDefault();
    });
    addEventListener('keyup', (e) => { const dir = keyDirs[e.key.toLowerCase()]; if (dir) this.held.delete(dir); });
    addEventListener('blur', () => this.held.clear());
    for (const b of doc.querySelectorAll<HTMLButtonElement>('#dpad button')) {
      const dir = b.dataset.dir as Dir;
      const on = (e: PointerEvent) => { e.preventDefault(); this.held.add(dir); b.classList.add('held'); b.setPointerCapture?.(e.pointerId); };
      const off = () => { this.held.delete(dir); b.classList.remove('held'); };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('lostpointercapture', off);
    }
  }
}
