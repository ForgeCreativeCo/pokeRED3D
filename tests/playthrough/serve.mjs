// Where a play-through runs: a game build, served for the duration.
//
//   dev     the Vite dev server (the default)
//   dist    the production build in dist/ (run `npm run build` first)
//   single  the single-file page dist-single/index.html, from disk (`npm run build:single`)
//   http…   a game that's already running (or file:// a page on disk)

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer, preview } from 'vite';

const ROOT = path.resolve(import.meta.dirname, '../..');

/** Start the target; resolves { url, close }. */
export async function serve(target = 'dev') {
  if (/^(https?|file):/.test(target)) return { url: target, close: async () => {} };
  const quiet = { root: ROOT, logLevel: 'silent' };
  if (target === 'dev') {
    const server = await createServer({ ...quiet, server: { port: 0, strictPort: false } });
    await server.listen();
    return { url: server.resolvedUrls.local[0], close: () => server.close() };
  }
  if (target === 'dist') {
    need('dist/index.html', 'npm run build');
    const server = await preview({ ...quiet, preview: { port: 0, strictPort: false } });
    return { url: server.resolvedUrls.local[0], close: () => server.close() };
  }
  if (target === 'single') {
    need('dist-single/index.html', 'npm run build:single');
    return { url: pathToFileURL(path.join(ROOT, 'dist-single/index.html')).href, close: async () => {} };
  }
  throw new Error(`Unknown target ${target}: use dev, dist, single or a URL`);
}

function need(file, command) {
  if (!fs.existsSync(path.join(ROOT, file))) throw new Error(`${file} is missing; run \`${command}\` first`);
}
