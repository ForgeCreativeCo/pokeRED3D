// Shapes the single-file build for publishing as a claude.ai Artifact:
//   dist-single/index.html  ->  dist-single/pokered3d.html
//
// The Artifact host wraps the page in its own document skeleton, so this
// drops the build's <html>/<head>/<body> wrappers and the charset and
// viewport metas, and puts the title first, then the styles, the page's
// markup and finally its script.
//
// Usage: npm run build:artifact

import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(import.meta.dirname, '../dist-single');
const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');

const one = (re, what) => {
  const m = html.match(re);
  if (!m) throw new Error(`No ${what} in dist-single/index.html; is it a fresh build:single?`);
  return m[0];
};
const all = (re) => html.match(re) ?? [];

const head = one(/<head>[\s\S]*<\/head>/i, '<head>');
const body = one(/<body>[\s\S]*<\/body>/i, '<body>').replace(/^<body>|<\/body>$/gi, '').trim();
const title = one(/<title>[\s\S]*?<\/title>/i, '<title>');
const links = all(/<link [^>]*>/gi).filter((l) => head.includes(l));
const styles = head.match(/<style[^>]*>[\s\S]*?<\/style>/gi) ?? [];
const scripts = head.match(/<script[^>]*>[\s\S]*?<\/script>/gi) ?? [];
if (!scripts.length) throw new Error('No inlined script in dist-single/index.html');

const page = [
  title,
  '<meta name="claude:viewport-fit-sides" content="cover">',
  ...links,
  ...styles,
  body,
  ...scripts,
].join('\n') + '\n';

const out = path.join(DIR, 'pokered3d.html');
fs.writeFileSync(out, page);
console.log(`Artifact page: ${path.relative(process.cwd(), out)} (${(page.length / 1e6).toFixed(1)} MB)`);
