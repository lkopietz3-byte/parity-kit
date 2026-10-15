// Renders bench/RESULTS.md from the pinned matrices in bench/expected.json.
// run.mjs writes it with --update-expected, and test/bench-regression.test.ts checks that the committed file is what this renders.

import { summarize } from './report.mjs';

const GROUPS = [
  ['mirror', 'Mirror comparison (`compareMirror`), real sources', (id) => /^compareMirror\/(i18n|entities-real|pypa-vs-osv)/.test(id)],
  ['mirror-synthetic', 'Mirror comparison, seeded edits and grids', (id) => /^compareMirror\/(entities-synthetic|numberTolerance)/.test(id)],
  ['constants', 'Hand-typed constants (`findHandTypedConstants`)', (id) => id.startsWith('findHandTypedConstants/')],
  ['stamps', 'Review stamps (`auditReviewStamps`)', (id) => id.startsWith('auditReviewStamps/')],
  ['holdout', 'Fresh holdout, labeled before the run (see `holdout/PREREGISTRATION.md`)', (id) => id.startsWith('holdout/')],
  ['fetched', 'Fetched sources (AGPL, not stored in this repository; `--tier all`)', (id) => id.startsWith('fetched/')],
];

const pct = (x) => (x === null ? 'n/a' : `${(100 * x).toFixed(3)}%`);
const ci = (c) => (c === null ? '' : ` (95% CI ${(100 * c[0]).toFixed(3)} to ${(100 * c[1]).toFixed(3)}%)`);
const num = (n) => n.toLocaleString('en-US');
const factText = (facts) =>
  Object.entries(facts ?? {})
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join('; ');

export function renderResults(pinned) {
  const lines = [];
  lines.push('# Benchmark results', '');
  lines.push('Generated from `bench/expected.json` by `node bench/run.mjs --update-expected`; do not edit by hand. `npm run bench` fails if a run differs from the pinned counts. How to read the columns is in [README.md](README.md).', '');
  const summaries = Object.entries(pinned).map(([id, entry]) => summarize({ id, ...entry }));
  const total = (rows, key) => rows.reduce((a, s) => a + s[key], 0);
  const vendored = summaries.filter((s) => !s.id.startsWith('fetched/'));
  lines.push('## Totals', '');
  lines.push('| Scope | Items that should flag | False pass | Items that should pass | False flag | Abstain |', '| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const [label, rows] of [['Reproduced offline (everything but the fetched sources)', vendored], ['All, with the fetched sources', summaries]]) {
    const p = total(rows, 'positives');
    const fp = total(rows, 'falsePass');
    const n = total(rows, 'negatives');
    const ff = total(rows, 'falseFlag');
    lines.push(`| ${label} | ${num(p)} | ${num(fp)} (${pct(p === 0 ? null : fp / p)}) | ${num(n)} | ${num(ff)} (${pct(n === 0 ? null : ff / n)}) | ${num(total(rows, 'abstainPositive') + total(rows, 'abstainNegative'))} |`);
  }
  lines.push('');
  lines.push('The class rows below overlap (the same stamp pair is scored once per flag, the same table once per option set), so these totals count verdicts, not distinct items. Abstain counts items the kit called `unknown`; a whole file that comes back `unknown` because of look-alike keys still gives a verdict for every key, and is listed in that class\'s run facts (`resultStatus`, `itemsInLookalikeGroups`).', '');
  for (const [, title, test] of GROUPS) {
    const rows = summaries.filter((s) => test(s.id));
    if (rows.length === 0) continue;
    lines.push(`## ${title}`, '');
    lines.push('| Class | Items that should flag | False pass | Items that should pass | False flag | Abstain |', '| --- | ---: | ---: | ---: | ---: | ---: |');
    for (const s of rows) {
      lines.push(`| \`${s.id}\` | ${num(s.positives)} | ${s.falsePass} of ${num(s.positives)} (${pct(s.falsePassRate)})${ci(s.falsePassCi95)} | ${num(s.negatives)} | ${s.falseFlag} of ${num(s.negatives)} (${pct(s.falseFlagRate)})${ci(s.falseFlagCi95)} | ${s.abstainPositive + s.abstainNegative} |`);
    }
    lines.push('');
    for (const s of rows) {
      lines.push(`### \`${s.id}\``, '');
      lines.push(`${pinned[s.id].what}. Denominator: ${pinned[s.id].denominators}.`, '');
      lines.push('| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
      for (const r of s.rows) {
        lines.push(`| ${r.truth} | ${num(r.n)} | ${num(r.agree)} | ${r.falsePass ?? ''} | ${r.falseFlag ?? ''} | ${r.abstain} | ${r.wrongClass ?? ''} |`);
      }
      const facts = factText(s.facts);
      if (facts !== '') lines.push('', `Run facts: ${facts}.`);
      lines.push('');
    }
  }
  lines.push('Intervals are 95% Wilson score intervals; with zero events in n items the upper bound is about 3.8 divided by n.', '');
  return `${lines.join('\n')}\n`;
}

