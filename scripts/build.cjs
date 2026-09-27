const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

// Only this public API URL is included in the browser bundle.
const apiBaseUrl = process.env.API_BASE_URL?.trim() || '/api';
const cliPath = join(__dirname, '..', 'node_modules', '@angular', 'cli', 'bin', 'ng.js');
const result = spawnSync(process.execPath, [
  cliPath,
  'build',
  ...process.argv.slice(2),
  '--define',
  'APP_API_BASE_URL=' + JSON.stringify(apiBaseUrl)
], { stdio: 'inherit' });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
