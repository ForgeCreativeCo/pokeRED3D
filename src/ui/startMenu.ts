// FireRed's start menu: POKéDEX (once you have one), POKéMON (once you have
// one), BAG, your name, SAVE, OPTION and EXIT, down the right side. It opens
// with START and remembers where the cursor was; each entry opens its screen
// on top, and closing that screen comes back here, as in the game.

import type { Input } from '../input/input';
import type { Story } from '../scripts/story';
import type { PartyMenu } from './party';
import type { Screen, Talk } from './screens';

export interface StartMenuParts {
  pokedex: Screen;
  party: PartyMenu;
  bag: Screen;
  card: Screen;
  options: Screen;
  /** the save dialogue; resolves when it's over */
  save(): Promise<void>;
  talk: Talk;
}

export class StartMenu {
  open = false;
  private sel = 0;
  /** the screen open on top, if any */
  private child: Screen | PartyMenu | null = null;
  private saving = false;
  private root: HTMLElement;

  constructor(private story: Story, private input: Input, doc: Document, private parts: StartMenuParts) {
    this.root = doc.getElementById('startMenu')!;
  }

  /** The entries, as FireRed shows them for where the story is. */
  private entries(): string[] {
    const f = this.story.flags;
    return [
      ...(f.has('FLAG_SYS_POKEDEX_GET') ? ['POKéDEX'] : []),
      ...(f.has('FLAG_SYS_POKEMON_GET') && this.story.party.length ? ['POKéMON'] : []),
      'BAG', this.story.names.PLAYER, 'SAVE', 'OPTION', 'EXIT',
    ];
  }

  show() {
    this.open = true;
    this.child = null;
    this.input.clearHeld();
    this.sel = Math.min(this.sel, this.entries().length - 1);
    this.render();
  }

  close() {
    this.open = false;
    this.child = null;
    this.root.hidden = true;
  }

  /** Open the party straight away (the test hook's openParty does this). */
  openParty() {
    if (!this.open) this.show();
    this.sel = this.entries().indexOf('POKéMON');
    this.child = this.parts.party;
    this.parts.party.show();
    this.render();
  }

  /** One frame of input; returns whether the menu (or a screen of it) is open. */
  update(): boolean {
    if (!this.open) return false;
    if (this.saving) return true; // the save dialogue has the text box
    if (this.child) {
      if (!this.child.update()) { this.child = null; this.render(); }
      return true;
    }
    const key = this.input.taken();
    if (!key) return true;
    const items = this.entries();
    if (key === 'b' || key === 'start') { this.close(); return false; }
    if (key === 'up') this.sel = (this.sel + items.length - 1) % items.length;
    else if (key === 'down') this.sel = (this.sel + 1) % items.length;
    else if (key === 'a') this.choose(items[this.sel]);
    if (this.open) this.render();
    return this.open;
  }

  private choose(entry: string) {
    const p = this.parts;
    const screens: Record<string, Screen | PartyMenu> = { 'POKéDEX': p.pokedex, 'POKéMON': p.party, BAG: p.bag, OPTION: p.options, [this.story.names.PLAYER]: p.card };
    if (entry === 'EXIT') { this.close(); return; }
    if (entry === 'SAVE') {
      // FireRed closes the menu around the save dialogue, then closes it for good.
      this.saving = true;
      this.root.hidden = true;
      p.talk(async () => {
        await p.save();
        this.saving = false;
        this.close();
      });
      return;
    }
    this.child = screens[entry];
    this.child.show();
  }

  /** What's on screen, for tests: the screen on top, or the menu and its cursor. */
  get state(): string {
    if (!this.open) return 'closed';
    if (this.saving) return 'saving';
    if (this.child) return this.child.state;
    return `start ${this.entries()[this.sel]}`;
  }

  private render() {
    // The menu hides behind full-screen screens.
    this.root.hidden = !this.open || !!this.child;
    if (this.root.hidden) return;
    this.root.innerHTML = `<ul>${this.entries().map((e, i) => `<li class="${i === this.sel ? 'sel' : ''}">${e}</li>`).join('')}</ul>`;
  }
}
