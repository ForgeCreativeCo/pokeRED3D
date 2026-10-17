// Loads the baked data: the world layout, every map in it with its atlas,
// the scripts, the music and the Pokémon. They're fetched from build/, or come embedded
// in the page in the single-file build.

import embedded from 'virtual:baked-data';
import type { MapFile, MusicFile, PokemonFile, ScriptsFile, WorldFile } from './types';

export interface LoadedMap {
  data: MapFile;
  area: number;
  /** offset in world tiles */
  ox: number;
  oy: number;
  atlas: HTMLImageElement;
}

export interface GameData {
  world: WorldFile;
  maps: LoadedMap[];
  scripts: ScriptsFile;
  music: MusicFile;
  pokemon: PokemonFile;
}

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load ${url} (${res.status}). Has it been baked?`);
  return res.json() as Promise<T>;
}

function image(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Couldn't load ${url}`));
    img.src = url;
  });
}

export async function loadGame(base = import.meta.env.BASE_URL): Promise<GameData> {
  const e = embedded;
  if (e) {
    const { world, scripts, music, pokemon } = e;
    const maps = await Promise.all(world.maps.map(async ({ map, area, ox, oy }) => (
      { data: e.maps[map].data, area, ox, oy, atlas: await image(e.maps[map].atlas) }
    )));
    return { world, maps, scripts, music, pokemon };
  }
  const [world, scripts, music, pokemon] = await Promise.all([
    json<WorldFile>(`${base}data/world.json`),
    json<ScriptsFile>(`${base}data/scripts.json`),
    json<MusicFile>(`${base}data/music.json`),
    json<PokemonFile>(`${base}data/pokemon.json`),
  ]);
  const maps = await Promise.all(world.maps.map(async ({ map, area, ox, oy }) => {
    const data = await json<MapFile>(`${base}maps/${map}/map.json`);
    const atlas = await image(`${base}maps/${map}/${data.atlas.file}`);
    return { data, area, ox, oy, atlas };
  }));
  return { world, maps, scripts, music, pokemon };
}
