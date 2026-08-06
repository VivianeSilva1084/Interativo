// Assembles the viscarekids.com deployment: vendas.html (+ the legal pages
// it links to) copied into an output dir, with vendas.html renamed to
// index.html so the domain's root serves the sales page instead of
// colliding with the main game project's index.html. Run as this Vercel
// project's Build Command - vendas.html itself stays the single source of
// truth, this just repackages it on every deploy.
//
// Images stay on the main game deployment rather than being duplicated
// here (some are multiple MB, not worth doubling storage/bandwidth for) -
// local references are rewritten to absolute URLs pointing at it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repoRoot, 'dist-vendas');
const GAME_ORIGIN = 'https://interativo-pi.vercel.app';

const localImageRefs = [
  'icons/icon-32.png',
  'Kapi.png',
  'kapi-meditando.jpg',
  'aventura-das-letras-icon.png',
  'assets/cartoonPT.png',
  'assets/cartonnIT.png',
];

function toAbsoluteImageUrls(html) {
  let out = html;
  for (const ref of localImageRefs) {
    out = out.split(`"${ref}"`).join(`"${GAME_ORIGIN}/${ref}"`);
    out = out.split(`'${ref}'`).join(`'${GAME_ORIGIN}/${ref}'`);
  }
  return out;
}

const pages = [
  ['vendas.html', 'index.html'],
  ['termos-de-uso.html', 'termos-de-uso.html'],
  ['politica-privacidade.html', 'politica-privacidade.html'],
];

for (const [src, dest] of pages) {
  const html = readFileSync(join(repoRoot, src), 'utf8');
  const destPath = join(outDir, dest);
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, toAbsoluteImageUrls(html));
}

console.log(`vendas.html site assembled in ${outDir} (${pages.length} pages, images pointed at ${GAME_ORIGIN})`);
