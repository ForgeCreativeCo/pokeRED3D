// The tuning panel: where the player is standing, camera sliders for
// camera.yaml, and view toggles. Folded on small screens.

import type { CameraRig } from '../render/camera';
import type { Cell } from '../world/world';
import type { Dir } from '../data/types';

/** PalletTown_PlayersHouse_1F -> Pallet Town Players House 1F */
export const pretty = (name: string) => name.replace(/_/g, ' ').replace(/([a-z])([A-Z0-9])/g, '$1 $2');

const SLIDERS = ['pitch', 'fov', 'view'] as const;

export class Panel {
  private $: (id: string) => HTMLElement;

  constructor(doc: Document, private rig: CameraRig, on: { lit(lit: boolean): void; orbit(on: boolean): void }) {
    const $ = (this.$ = (id: string) => doc.getElementById(id)!);
    const input = (id: string) => $(id) as HTMLInputElement;
    for (const k of SLIDERS) {
      input(k).addEventListener('input', () => { rig.settings[k] = +input(k).value; $(k + 'Out').textContent = String(rig.settings[k]); });
    }
    this.syncSliders();
    $('reset').onclick = () => { rig.reset(); this.syncSliders(); };
    $('copy').onclick = () => {
      const s = rig.settings;
      const line = `  ${rig.preset}: { pitch: ${s.pitch}, fov: ${s.fov}, view: ${s.view} }`;
      const showFallback = () => { const y = input('yaml'); y.value = line.trim(); y.hidden = false; y.select(); $('copied').textContent = 'Select and copy this line'; };
      try {
        navigator.clipboard.writeText(line).then(() => { $('copied').textContent = 'Copied'; $('yaml').hidden = true; }, showFallback);
      } catch { showFallback(); }
    };
    $('orbit').onchange = () => on.orbit(input('orbit').checked);
    $('shade').onchange = () => on.lit(input('shade').checked);
    // Small screens start with the panel folded so the map is visible.
    if (matchMedia('(max-width: 600px)').matches) this.fold();
  }

  syncSliders() {
    for (const k of SLIDERS) {
      (this.$(k) as HTMLInputElement).value = String(this.rig.settings[k]);
      this.$(k + 'Out').textContent = String(this.rig.settings[k]);
    }
  }

  fold() {
    (this.$('panel') as HTMLDetailsElement).open = false;
  }

  setLegend(preset: string) {
    this.$('legendCam').textContent = `Camera · ${preset}`;
  }

  setTitle(mapName: string) {
    this.$('title').textContent = pretty(mapName);
  }

  setFoot(text: string) {
    this.$('foot').textContent = text;
  }

  readout(c: Cell, facing: Dir) {
    const G = c.m.data.grid;
    this.$('rCell').textContent = `${c.x}, ${c.y}  (elevation ${G.elevation[c.i]}, facing ${facing})`;
    this.$('rClass').textContent = G.class[c.i];
    this.$('rBehavior').textContent = G.behavior[c.i];
    this.$('rHeight').textContent = String(G.height[c.i]);
  }
}
