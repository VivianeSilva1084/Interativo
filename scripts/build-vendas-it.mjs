// Assembles the it.viscarekids.com deployment: same pages as build-vendas.mjs
// (vendas.html renamed to index.html, plus the legal pages it links to), but
// with the Italian half of each page's PT/IT toggle forced to show by
// default instead of the Portuguese one - the copy itself already lives in
// vendas.html's `data-lang="it"` block (and the legal pages' own toggles),
// this script only flips which language renders before any JS runs, and
// swaps the <html lang>/<title>/<meta description> to match.
//
// Reuses the exact same asset-URL-rewriting approach as build-vendas.mjs
// (images/videos stay on the main game deployment, not duplicated here).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repoRoot, 'dist-vendas-it');
const GAME_ORIGIN = 'https://interativo-pi.vercel.app';

const localAssetRefs = [
  'icons/icon-32.png',
  'Kapi.png',
  'kapi-meditando.jpg',
  'aventura-das-letras-icon.png',
  'assets/cartoonPT.png',
  'assets/cartonnIT.png',
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

// Forces the Italian half of the page's data-lang toggle to be the one
// visible before setDocLang() ever runs, and keeps the header language
// buttons' active state in sync with that - the PT->IT switch still works
// for anyone who wants to read the Portuguese version instead.
function forceItalianDefault(html) {
  return html
    .replace('[data-lang="it"]{ display:none; }', '[data-lang="pt"]{ display:none; }')
    .replace('<html lang="pt-BR">', '<html lang="it-IT">')
    .replace('id="btnPt" class="active"', 'id="btnPt"')
    .replace('id="btnIt"', 'id="btnIt" class="active"');
}

const pages = [
  {
    src: 'vendas.html',
    dest: 'index.html',
    title: 'VisCare Kids — Giochi educativi per attenzione, autocontrollo e lettura',
    description: "Giochi educativi brevi e coinvolgenti, pensati anche per bambini con ADHD, DSA e difficoltà di apprendimento, con strumenti per osservare i progressi nel tempo.",
  },
  {
    src: 'termos-de-uso.html',
    dest: 'termos-de-uso.html',
    title: 'Termini di Utilizzo — VisCare Kids',
  },
  {
    src: 'politica-privacidade.html',
    dest: 'politica-privacidade.html',
    title: 'Informativa sulla Privacy — VisCare Kids',
  },
];

for (const { src, dest, title, description } of pages) {
  let html = readFileSync(join(repoRoot, src), 'utf8');
  html = toAbsoluteAssetUrls(html);
  html = forceItalianDefault(html);
  if (title) html = html.replace(/<title>.*?<\/title>/s, `<title>${title}</title>`);
  if (description) html = html.replace(/<meta name="description" content=".*?">/s, `<meta name="description" content="${description}">`);
  const destPath = join(outDir, dest);
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, html);
}

console.log(`it.viscarekids.com site assembled in ${outDir} (${pages.length} pages, Italian shown by default, images pointed at ${GAME_ORIGIN})`);
