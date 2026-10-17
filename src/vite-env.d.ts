/// <reference types="vite/client" />

declare module 'virtual:baked-data' {
  /** The baked data embedded in the single-file build; null in other builds. */
  const embedded: {
    world: import('./data/types').WorldFile;
    scripts: import('./data/types').ScriptsFile;
    music: import('./data/types').MusicFile;
    pokemon: import('./data/types').PokemonFile;
    items: import('./data/types').ItemsFile;
    /** by folder name: the map and its atlas as a data URI */
    maps: Record<string, { data: import('./data/types').MapFile; atlas: string }>;
  } | null;
  export default embedded;
}
