// Rewrites the printed results in docs/what-a-diff-cannot-answer.md from the code above them.
//
//   node bench/doc-cases.mjs          rewrite the page
//   node bench/doc-cases.mjs --check  exit 1 if the page is out of date
//
// Runs against dist/ (npm run build first). The same blocks are checked, against src, by
// test/what-a-diff-cannot-answer.test.ts.

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rewrite } from './lib/doc-blocks.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const modules = {
  'parity-kit': await import(pathToFileURL(join(root, 'dist', 'index.js')).href),
  'deep-diff': { default: require('deep-diff') },
  microdiff: await import('microdiff'),
};
const page = join(root, 'docs', 'what-a-diff-cannot-answer.md');
const before = readFileSync(page, 'utf8');
const after = await rewrite(before, modules);
if (process.argv.includes('--check')) {
  if (before !== after) {
    console.error('docs/what-a-diff-cannot-answer.md is out of date: run node bench/doc-cases.mjs');
    process.exit(1);
  }
  console.log('docs/what-a-diff-cannot-answer.md is up to date');
} else {
  writeFileSync(page, after);
  console.log('rewrote', page);
}
