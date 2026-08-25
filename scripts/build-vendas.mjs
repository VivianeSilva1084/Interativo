// Assembles the viscarekids.com deployment: vendas.html (+ the legal pages
// it links to) copied into an output dir, with vendas.html renamed to
// index.html so the domain's root serves the sales page instead of
// colliding with the main game project's index.html. Run as this Vercel
// project's Build Command - vendas.html itself stays the single source of
// truth, this just repackages it on every deploy.
//
// Images and supabase-config.js stay on the main game deployment rather
// than being duplicated here (images are multiple MB, not worth doubling
// storage/bandwidth for; the config file is tiny but this way there's only
// ever one copy to keep in sync if the anon key rotates) - local references
// are rewritten to absolute URLs pointing at it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repoRoot, 'dist-vendas');
const GAME_ORIGIN = 'https://interativo-pi.vercel.app';

const localAssetRefs = [
  'icons/icon-32.png',
  'Kapi.png',
  'kapi-meditando.jpg',
  'aventura-das-letras-icon.png',
  'assets/cartoonPT.png',
  'assets/cartonnIT.png',
  'assets/mockup-mini-kit.png',
  'assets/mockup-kit-completo.png',
  'assets/mockup-100-jogos.png',
  'assets/mockup-baralho-foco.png',
  'assets/mockup-combo.png',
  'assets/mockup-mini-kit-it.png',
  'assets/mockup-kit-completo-it.png',
  'assets/mockup-100-jogos-it.png',
  'assets/mockup-baralho-foco-it.png',
  'assets/mockup-pare-de-repetir.png',
  'assets/mockup-pare-de-repetir-it.png',
  'supabase-config.js',
];

function toAbsoluteAssetUrls(html) {
  let out = html;
  for (const ref of localAssetRefs) {
    out = out.split(`"${ref}"`).join(`"${GAME_ORIGIN}/${ref}"`);
    out = out.split(`'${ref}'`).join(`'${GAME_ORIGIN}/${ref}'`);
  }
  return out;
}

const pages = [
  ['vendas.html', 'index.html'],
  ['familias.html', 'familias.html'],
  ['profissionais.html', 'profissionais.html'],
  ['sobre.html', 'sobre.html'],
  ['contato.html', 'contato.html'],
  ['termos-de-uso.html', 'termos-de-uso.html'],
  ['politica-privacidade.html', 'politica-privacidade.html'],
  // Isolated funnel page (not linked from nav, per its own comment) - output
  // as a directory index (same trick as vendas.html -> index.html above) so
  // it resolves at /metodo instead of /metodo.html.
  ['metodo.html', 'metodo/index.html'],
];

for (const [src, dest] of pages) {
  const html = readFileSync(join(repoRoot, src), 'utf8');
  const destPath = join(outDir, dest);
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, toAbsoluteAssetUrls(html));
}

// Shared CSS/JS the multi-page site links to. Named explicitly rather than
// scanning the `assets/` dir, since that folder is shared with the main app
// (videos, avatars, badges) - not exclusively site.css/site.js/checkout.js.
// Pushed through toAbsoluteAssetUrls same as the HTML pages: checkout.js
// contains relative references to assets/cartoonPT.png and assets/cartonnIT.png
// (the checkout modal's product image) that need the same rewrite the HTML
// pages get, or they'd 404 on viscarekids.com (that image lives on the game
// deployment, and only .css/.js get copied into dist-vendas/assets - not
// images).
const sharedAssetFiles = ['site.css', 'site.js', 'checkout.js'];
const assetsOutDir = join(outDir, 'assets');
mkdirSync(assetsOutDir, { recursive: true });
for (const file of sharedAssetFiles) {
  const content = readFileSync(join(repoRoot, 'assets', file), 'utf8');
  writeFileSync(join(assetsOutDir, file), toAbsoluteAssetUrls(content));
}

console.log(`vendas.html site assembled in ${outDir} (${pages.length} pages, ${sharedAssetFiles.length} shared assets, images pointed at ${GAME_ORIGIN})`);
