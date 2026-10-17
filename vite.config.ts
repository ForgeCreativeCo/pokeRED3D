import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const BUILD = path.resolve(import.meta.dirname, 'build');

/**
 * virtual:baked-data: in the single-file build, every baked file the game
 * loads (world, scripts, music, Pokémon, items, each map and its atlas) embedded in the page;
 * otherwise null, and the game fetches them from build/.
 */
function bakedData(embed: boolean): Plugin {
  const id = 'virtual:baked-data';
  return {
    name: 'baked-data',
    resolveId: (source) => (source === id ? '\0' + id : null),
    load(resolved) {
      if (resolved !== '\0' + id) return null;
      if (!embed) return 'export default null;';
      const read = (file: string) => fs.readFileSync(path.join(BUILD, file));
      const world = JSON.parse(read('data/world.json').toString());
      const maps: Record<string, { data: unknown; atlas: string }> = {};
      for (const { map } of world.maps) {
        const data = JSON.parse(read(`maps/${map}/map.json`).toString());
        maps[map] = { data, atlas: `data:image/png;base64,${read(`maps/${map}/${data.atlas.file}`).toString('base64')}` };
      }
      return `export default ${JSON.stringify({ world, maps, scripts: JSON.parse(read('data/scripts.json').toString()), music: JSON.parse(read('data/music.json').toString()), pokemon: JSON.parse(read('data/pokemon.json').toString()), items: JSON.parse(read('data/items.json').toString()) })};`;
    },
  };
}

// The baker's output (build/) is served and shipped as static files: the game
// fetches build/data/*.json and build/maps/<Map>/* at runtime.
// `vite build --mode single` instead makes one self-contained page,
// dist-single/index.html, that opens straight from disk.
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    publicDir: single ? false : 'build',
    server: { port: 5173, strictPort: true },
    plugins: [bakedData(single), ...(single ? [viteSingleFile()] : [])],
    build: {
      outDir: single ? 'dist-single' : 'dist',
      target: 'es2022',
      // three.js alone is ~450 kB; the single-file page also carries the baked data.
      chunkSizeWarningLimit: single ? 20000 : 1000,
    },
  };
});
