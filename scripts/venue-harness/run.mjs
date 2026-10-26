import { build } from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

// Runs a TypeScript entry against the real explorer modules in Node (no WebGL): esbuild (installed with
// @angular/build) bundles it into node_modules/.cache so 'three' resolves; three.js stays external.
// Usage: node scripts/venue-harness/run.mjs <entry.ts> [args...]
const [entry, ...args] = process.argv.slice(2);
fs.mkdirSync(path.join('node_modules', '.cache'), { recursive: true });
const outdir = fs.mkdtempSync(path.join('node_modules', '.cache', 'venue-harness-'));
const outfile = path.resolve(outdir, 'entry.mjs');
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'error',
  external: ['three', 'three/*', 'meshoptimizer'], tsconfig: 'tsconfig.app.json' });
process.argv = [process.argv[0], outfile, ...args];
try { await import(pathToFileURL(outfile).href); } finally { fs.rmSync(outdir, { recursive: true, force: true }); }
