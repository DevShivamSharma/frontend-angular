// Serves one explicitly selected private PDF backup on loopback, never a directory.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const [file, key] = process.argv.slice(2);
if (!file || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(key ?? '')) {
  throw new Error('Usage: node scripts/serve-pdf-preview.cjs <prepared.pdfplan> <preview-key>');
}
const absolute = path.resolve(file);
const bytes = fs.readFileSync(absolute);
if (bytes.length > 32 * 1024 * 1024 || bytes.subarray(0, 9).toString() !== 'PDFPLAN1\n')
  throw new Error('Expected a PDF workspace backup under 32 MB.');
const origins = new Set(['http://localhost:4321', 'http://127.0.0.1:4321']);
const server = http.createServer((req, res) => {
  if (req.headers.origin && !origins.has(req.headers.origin)) {
    res.writeHead(403); res.end(); return;
  }
  if (req.headers.origin) res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'HEAD'].includes(req.method) || req.url !== `/${key}.pdfplan`) {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length });
  res.end(req.method === 'HEAD' ? undefined : bytes);
});
server.listen(4322, '127.0.0.1', () => {
  console.log(`Local preview ready: http://localhost:4321/planner/editor?pdfPreview=${key}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
