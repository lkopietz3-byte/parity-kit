// Writes bench/data/manifest.json: the SHA-256 and size of every vendored data file.
// test/bench-regression.test.ts checks the files against it, so a data file cannot change unnoticed.
//   node bench/build/manifest.mjs

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const bench = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const files = {};
for (const dir of ['data', 'holdout/data']) {
  for (const name of readdirSync(join(bench, dir)).sort()) {
    if (name === 'manifest.json') continue;
    const bytes = readFileSync(join(bench, dir, name));
    files[`${dir}/${name}`] = { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
  }
}
writeFileSync(join(bench, 'data', 'manifest.json'), `${JSON.stringify({ note: 'SHA-256 of every vendored bench data file, relative to bench/', files }, null, 1)}\n`);
console.log(Object.keys(files).length, 'files');
