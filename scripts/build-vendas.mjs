// Assembles the viscarekids.com deployment: vendas.html (+ the legal pages
// and images it links to) copied into an output dir, with vendas.html
// renamed to index.html so the domain's root serves the sales page instead
// of colliding with the main game project's index.html. Run as this Vercel
// project's Build Command - vendas.html itself stays the single source of
// truth, this just repackages it on every deploy.
import { mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repoRoot, 'dist-vendas');

const files = [
  ['vendas.html', 'index.html'],
  ['termos-de-uso.html', 'termos-de-uso.html'],
  ['politica-privacidade.html', 'politica-privacidade.html'],
  ['icons/icon-32.png', 'icons/icon-32.png'],
  ['Kapi.png', 'Kapi.png'],
  ['kapi-meditando.jpg', 'kapi-meditando.jpg'],
  ['aventura-das-letras-icon.png', 'aventura-das-letras-icon.png'],
  ['assets/cartoonPT.png', 'assets/cartoonPT.png'],
  ['assets/cartonnIT.png', 'assets/cartonnIT.png'],
];

for (const [src, dest] of files) {
  const destPath = join(outDir, dest);
  mkdirSync(dirname(destPath), { recursive: true });
  copyFileSync(join(repoRoot, src), destPath);
}

console.log(`vendas.html site assembled in ${outDir} (${files.length} files)`);
