import { build } from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

// Runs a TypeScript entry from scripts/venue-harness against the real explorer modules in Node (no WebGL):
// esbuild (already installed with @angular/build) bundles it, three.js stays external.
// Usage: node scripts/venue-harness/run.mjs <entry.ts> [args...]
const [entry, ...args] = process.argv.slice(2);
// Inside the project so the bundle resolves 'three' from node_modules.
const outdir = fs.mkdtempSync(path.join('node_modules', '.cache', 'venue-harness-'));
const outfile = path.resolve(outdir, 'entry.mjs');
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'error',
  external: ['three', 'three/*'], tsconfig: 'tsconfig.app.json' });
process.argv = [process.argv[0], outfile, ...args];
await import(pathToFileURL(outfile).href);
