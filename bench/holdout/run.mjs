// Scores the kit on the fresh holdout. The labels in data/labels.json were committed
// before this file existed (see PREREGISTRATION.md); nothing here changes them.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { newTally, scoreMirrorPair } from '../lib/vendored.mjs';

const dir = join(fileURLToPath(new URL('.', import.meta.url)), 'data');
const readGz = (name) => JSON.parse(gunzipSync(readFileSync(join(dir, name))).toString('utf8'));
const records = (table) => Object.entries(table).map(([id, fields]) => ({ id, ...fields }));

const FAMILIES = [
  ['http-status', 'http-status.json.gz', 'IANA status registry against five published copies of the reason phrases'],
  ['spdx', 'spdx.json.gz', 'SPDX License List 3.29.0 against two npm packages'],
  ['gitea', 'gitea.json.gz', 'Gitea en-US strings against twelve translations (printf verbs, tags, URLs)'],
];

export function runHoldout(report, kit, { families } = {}) {
  const labels = JSON.parse(readFileSync(join(dir, 'labels.json'), 'utf8'));
  for (const [family, file, what] of FAMILIES) {
    if (families !== undefined && !families.includes(family)) continue;
    const data = readGz(file);
    const id = `holdout/compareMirror/${family}`;
    const matrix = report.matrix(id, {
      check: 'compareMirror',
      what: `fresh holdout, labeled before the run: ${what}`,
      denominators: 'ids in the union of canonical and mirror, summed over mirrors',
    });
    const tally = newTally();
    const canonical = records(data.canonical);
    for (const [mirror, table] of Object.entries(data.mirrors)) {
      const fields = Array.isArray(data.fields) ? data.fields : data.fields[mirror];
      const ids = new Set([...Object.keys(data.canonical), ...Object.keys(table)]);
      scoreMirrorPair(matrix, tally, kit, canonical, records(table), { fields }, labels[`${family}/${mirror}`], ids);
    }
    report.note(id, 'mirrors', tally.pairs);
    report.note(id, 'resultStatus', tally.statuses);
    report.note(id, 'itemsInLookalikeGroups', tally.lookalikeMatchItems);
  }
}
