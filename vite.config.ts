import { defineConfig } from 'vite';

// The baker's output (build/) is served and shipped as static files: the game
// fetches build/data/*.json and build/maps/<Map>/* at runtime.
export default defineConfig({
  publicDir: 'build',
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist', target: 'es2022' },
});
