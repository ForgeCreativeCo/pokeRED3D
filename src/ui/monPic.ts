// The window showmonpic opens: a Pokémon's front picture in a framed box
// above the text box (Oak showing you the starter you're looking at).

import type { PokemonFile } from '../data/types';

export class MonPic {
  private box: HTMLElement;
  private img: HTMLImageElement;

  constructor(private data: PokemonFile, doc: Document) {
    this.box = doc.getElementById('monPic')!;
    this.img = this.box.querySelector('img')!;
  }

  show(species: string) {
    const pic = this.data.pics[species];
    if (!pic) return; // not baked: the scene goes on without it
    this.img.src = pic.front;
    this.img.alt = this.data.species[species]?.name ?? '';
    this.box.hidden = false;
  }

  hide() {
    this.box.hidden = true;
  }

  /** The species shown ('' when hidden), for tests. */
  get shown() {
    return this.box.hidden ? '' : this.img.alt;
  }
}
