// Bundles src/app.js (the game's client-side code, being incrementally
// split out of index.html's former single inline <script>) into one output
// file, IIFE format - deliberately not ESM, so the deployed <script src>
// keeps the exact same blocking/document-order execution timing the inline
// script always had. dist/ is gitignored, same as dist-vendas - Vercel
// rebuilds it fresh every deploy rather than committing generated output.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/app.js'],
  bundle: true,
  format: 'iife',
  outfile: 'dist/app.js',
  target: 'es2020',
  sourcemap: false,
  logLevel: 'info',
  // The HTML still calls dozens of these functions via inline onclick="..."
  // attributes, invisible to esbuild's reachability analysis - with
  // tree-shaking on, esbuild silently deleted huntStart/buildHuntGrid/
  // huntClick/etc. (anything only ever called from an onclick=, not from
  // other JS) because nothing in the bundle appeared to reference them.
  // Caught by manually diffing which functions survived, not by any build
  // error. Once functions genuinely move to addEventListener-based wiring
  // (or get explicit `window.fn = fn` exports) this can be re-enabled.
  treeShaking: false,
});
