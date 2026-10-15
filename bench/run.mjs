// npm run bench
//
//   node bench/run.mjs [--tier vendored|all] [--cache <dir>] [--json <file>]
//                      [--check | --update-expected] [--quiet]
//
// Runs the kit over the labeled field corpus and prints, for each class of
// check, how often it passed something that should have been flagged (false
// pass) and flagged something that was fine (false flag), with denominators
// and 95% Wilson intervals.
//
//   --tier vendored   (default) the families whose data ships in bench/data.
//   --tier all        also the families whose sources are AGPL licensed and so
//                     are fetched by pinned commit (bench/fetch); needs --cache
//                     or BENCH_CACHE, and exits 2 when the cache is missing.
//   --check           compare every confusion matrix with bench/expected.json;
//                     any difference exits 1. This is the CI gate.
//   --update-expected rewrite bench/expected.json (and bench/RESULTS.md, which is rendered from it) from this run.
//
// The kit under test is dist/index.js (run `npm run build` first) unless BENCH_KIT names another file.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { formatTable, summarize } from './lib/report.mjs';
import { renderResults } from './lib/results.mjs';
import { runSuite } from './lib/suite.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const tier = value('--tier') ?? 'vendored';
if (!['vendored', 'all'].includes(tier)) {
  console.error('--tier must be vendored or all');
  process.exit(2);
}
const kitPath = process.env.BENCH_KIT ?? join(here, '..', 'dist', 'index.js');
if (!existsSync(kitPath)) {
  console.error(`The kit is not built (${kitPath} is missing). Run: npm run build`);
  process.exit(2);
}
const kit = await import(pathToFileURL(kitPath).href);
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));

const started = process.cpuUsage();
const report = runSuite(kit);

if (tier === 'all') {
  const cache = value('--cache') ?? process.env.BENCH_CACHE;
  if (cache === undefined || !existsSync(cache)) {
    console.error('--tier all needs the fetched sources: run `node bench/fetch/fetch.mjs <dir>` and pass --cache <dir> (or set BENCH_CACHE)');
    process.exit(2);
  }
  const fetched = await import('./lib/fetched.mjs');
  fetched.runFetched(report, kit, cache);
}
const cpu = process.cpuUsage(started);

const summaries = [...report.matrices.values()].map(summarize);
const out = {
  schemaVersion: 1,
  kit: { name: pkg.name, version: pkg.version },
  node: process.version,
  tier,
  cpuSeconds: Math.round((cpu.user + cpu.system) / 1e4) / 100,
  classes: summaries,
};

if (!flag('--quiet')) {
  console.log(`parity-kit ${pkg.version}, node ${process.version}, tier ${tier}`);
  console.log(formatTable(summaries));
  const positives = summaries.reduce((a, s) => a + s.positives, 0);
  const falsePass = summaries.reduce((a, s) => a + s.falsePass, 0);
  const negatives = summaries.reduce((a, s) => a + s.negatives, 0);
  const falseFlag = summaries.reduce((a, s) => a + s.falseFlag, 0);
  console.log(`\nAcross all classes: ${falsePass} false passes in ${positives} items that should flag; ${falseFlag} false flags in ${negatives} items that should pass.`);
}
if (value('--json') !== undefined) writeFileSync(value('--json'), `${JSON.stringify(out, null, 1)}\n`);

// What is compared with expected.json: the matrices, nothing that varies by machine.
const expectedPath = join(here, 'expected.json');
const pinned = Object.fromEntries([...report.matrices.values()].map((m) => [m.id, { check: m.check, what: m.what, denominators: m.denominators, facts: m.facts, counts: m.counts }]));
if (flag('--update-expected')) {
  const existing = existsSync(expectedPath) ? JSON.parse(readFileSync(expectedPath, 'utf8')) : {};
  // A vendored-only run must not erase the fetched families' pins, and the reverse.
  const merged = tier === 'all' ? pinned : { ...Object.fromEntries(Object.entries(existing).filter(([id]) => id.startsWith('fetched/'))), ...pinned };
  writeFileSync(expectedPath, `${JSON.stringify(sortDeep(merged), null, 1)}\n`);
  writeFileSync(join(here, 'RESULTS.md'), renderResults(merged));
  console.log(`wrote ${expectedPath} and bench/RESULTS.md`);
}
if (flag('--check')) {
  const expected = JSON.parse(readFileSync(expectedPath, 'utf8'));
  const problems = [];
  for (const [id, entry] of Object.entries(pinned)) {
    if (!(id in expected)) problems.push(`${id}: not in expected.json`);
    else if (JSON.stringify(sortDeep(entry)) !== JSON.stringify(sortDeep(expected[id]))) {
      problems.push(`${id}: expected ${JSON.stringify(sortDeep(expected[id].counts))}\n      got      ${JSON.stringify(sortDeep(entry.counts))}${JSON.stringify(sortDeep(entry.facts)) === JSON.stringify(sortDeep(expected[id].facts)) ? '' : '\n      (the facts differ too)'}`);
    }
  }
  for (const id of Object.keys(expected)) {
    const inScope = tier === 'all' || !id.startsWith('fetched/');
    if (inScope && !(id in pinned)) problems.push(`${id}: in expected.json but not produced`);
  }
  if (problems.length > 0) {
    console.error(`\nbench check FAILED (${problems.length}):\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log('\nbench check passed: every confusion matrix equals expected.json');
}

function sortDeep(x) {
  if (x === null || typeof x !== 'object') return x;
  return Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortDeep(x[k])]));
}
