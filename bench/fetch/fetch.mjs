// Fetches the benchmark sources whose AGPL license keeps them out of this repository.
//
//   node bench/fetch/fetch.mjs <cache-dir>
//
// Every file is downloaded from raw.githubusercontent.com at the commit named in
// manifest.json and refused unless its SHA-256 matches the manifest, so a second
// run sees byte-identical inputs. Files are written under <cache-dir>/<source id>/
// and are only ever read as JSON text; nothing downloaded is executed.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cache = process.argv[2];
if (cache === undefined) {
  console.error('usage: node bench/fetch/fetch.mjs <cache-dir>');
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), 'manifest.json'), 'utf8'));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

let fetched = 0;
let reused = 0;
let bad = 0;
for (const source of manifest.sources) {
  const dir = join(cache, source.id);
  mkdirSync(dir, { recursive: true });
  const queue = [...source.files];
  const worker = async () => {
    for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
      const target = join(dir, file.name);
      if (existsSync(target) && sha256(readFileSync(target)) === file.sha256) {
        reused += 1;
        continue;
      }
      const url = `https://raw.githubusercontent.com/${source.repo}/${source.commit}/${source.path}/${encodeURIComponent(file.name)}`;
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`${url}: HTTP ${response.status}`);
        bad += 1;
        continue;
      }
      const body = Buffer.from(await response.arrayBuffer());
      if (sha256(body) !== file.sha256) {
        console.error(`${source.id}/${file.name}: SHA-256 differs from the manifest; not written`);
        bad += 1;
        continue;
      }
      writeFileSync(target, body);
      fetched += 1;
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}
console.log(`fetched ${fetched}, already present ${reused}, failed ${bad}`);
process.exit(bad === 0 ? 0 : 1);
