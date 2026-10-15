// Assembles the vendored bench data from raw downloads and the oracle outputs.
//
//   BENCH_WORK=<dir> node bench/build/derive.mjs
//
// BENCH_WORK holds data/ (raw downloads, parsed once into JSON) and out/
// (labels written by the python oracles in bench/build/oracle). The kit is
// imported only to check that the reduced records behave exactly like the full
// ones (see `checkReduction`); labels never come from it.
//
// What is stored, and why it is derived data and not a copy of a source:
// - advisory records keep `id` and `modified` as written and every other
//   top-level field as a 12-hex-digit digest of its canonical JSON. The kit
//   compares values for equality only, so a digest changes the kit's answer
//   exactly when the value would have;
// - entity maps are facts (name to code points) and are stored as such;
// - hand-typed-constant texts are advisory `details` strings (CC-BY-4.0).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WORK = process.env.BENCH_WORK;
if (!WORK) throw new Error('set BENCH_WORK');
const OUT = join(fileURLToPath(new URL('..', import.meta.url)), 'data');
mkdirSync(OUT, { recursive: true });
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const readJsonl = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const writeGz = (name, value) => {
  const buf = gzipSync(Buffer.from(JSON.stringify(value)), { level: 9 });
  writeFileSync(join(OUT, name), buf);
  console.log(name, buf.length, 'bytes');
};

// -- reduction -----------------------------------------------------------------

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'undefined';
}
const digest = (v) => createHash('sha256').update(canonical(v)).digest('hex').slice(0, 12);

/** `id` and `modified` stay as written; every other field becomes a digest. */
export function reduce(record) {
  const out = {};
  for (const [k, v] of Object.entries(record)) out[k] = k === 'id' || k === 'modified' ? v : digest(v);
  return out;
}

// -- stamps history ----------------------------------------------------------------

const store = JSON.parse(gunzipSync(readFileSync(join(WORK, 'data/s2_blobs.json.gz'))).toString());
const manifests = readJson(join(WORK, 'data/s2_manifests.json'));
const labels = Object.keys(manifests).sort();

const versionIndex = new Map(); // blob sha -> index in `versions`
const versions = [];
const idOfPath = new Map();
function versionOf(sha) {
  let i = versionIndex.get(sha);
  if (i === undefined) {
    i = versions.length;
    versions.push(reduce(store[sha]));
    versionIndex.set(sha, i);
  }
  return i;
}
function stateOf(label) {
  const state = new Map(); // record id -> version index
  for (const [path, sha] of Object.entries(manifests[label].files)) {
    if (!path.endsWith('.yaml')) continue;
    const record = store[sha];
    const id = record.id;
    if (idOfPath.has(path) && idOfPath.get(path) !== id) throw new Error(`path ${path} changed id`);
    idOfPath.set(path, id);
    if (state.has(id)) throw new Error(`duplicate id ${id} in ${label}`);
    state.set(id, versionOf(sha));
  }
  return state;
}

const snapshots = {};
let previous = null; // state of the last distinct snapshot
let previousCommit = null;
const firstLabelOfCommit = new Map();
const order = [];
for (const label of labels) {
  const { commit, committed } = manifests[label];
  if (firstLabelOfCommit.has(commit)) {
    snapshots[label] = { committed, same: firstLabelOfCommit.get(commit) };
    continue;
  }
  firstLabelOfCommit.set(commit, label);
  const state = stateOf(label);
  if (previous === null) {
    snapshots[label] = { committed, full: Object.fromEntries(state) };
  } else {
    const set = {};
    const del = [];
    for (const [id, v] of state) if (previous.get(id) !== v) set[id] = v;
    for (const id of previous.keys()) if (!state.has(id)) del.push(id);
    snapshots[label] = { committed, after: previousCommit, set, del };
  }
  order.push(label);
  previous = state;
  previousCommit = label;
}

const daily = labels.filter((l) => l >= '2026-07-01');
const pairs = [];
for (let i = 0; i + 1 < daily.length; i += 1) pairs.push([daily[i], daily[i + 1], 'daily']);
for (const l of ['2026-10-08', '2026-10-02', '2026-09-09', '2026-07-11', '2026-04-12', '2026-01-12']) pairs.push([l, '2026-10-09', 'horizon']);

const realTruth = readJsonl(join(WORK, 'out/s2_real_truth.jsonl'));
const truth = {};
for (const row of realTruth) {
  if (row.truth.length === 0) continue;
  (truth[row.pair] ??= {})[row.id] = row.truth;
}
const oracleSummary = readJson(join(WORK, 'out/s2_real_oracle_summary.json'));
const records = {};
for (const s of oracleSummary) if (!s.same_commit) records[s.pair] = s.records;

// Option variants: which fields count as evidence changes. Labels use the oracle's own stamp parser.
const optionVariants = {
  valueFields_details_summary: { valueFields: ['details', 'summary'] },
  ignoreFields_affected: { ignoreFields: ['affected'] },
  ignoreFields_affected_aliases: { ignoreFields: ['affected', 'aliases'] },
};
const optTruth = readJsonl(join(WORK, 'out/s2_opts_truth.jsonl'));

writeGz('stamps-history.json.gz', { order, snapshots, versions, pairs, truth, records, optionVariants, optionPairs: ['2026-10-08', '2026-10-02', '2026-09-09', '2026-07-11', '2026-04-12', '2026-01-12'].map((l) => `${l}>2026-10-09`), optionTruth: optTruth });

// -- injected stamps ------------------------------------------------------------------

const plan = readJson(join(WORK, 'data/s2_inj_plan.json'));
const injTruth = readJsonl(join(WORK, 'out/s2_inj_truth.jsonl'));
const injected = { L0: plan.L0, L1: plan.L1, now: plan.now, variants: {}, truth: {} };
for (const [name, v] of Object.entries(plan.variants)) {
  injected.variants[name] = Object.fromEntries(Object.entries(v.overrides).map(([id, rec]) => [id, reduce(rec)]));
}
for (const row of injTruth) (injected.truth[row.variant] ??= {})[row.id] = row.truth;
writeGz('stamps-injected.json.gz', injected);

const edge = readJson(join(WORK, 'data/s2_edge_cases.json'));
writeFileSync(join(OUT, 'stamps-edge.json'), `${JSON.stringify({ now: edge.now, before: edge.before, rows: edge.rows.map((r) => ({ stamp: r.case, truth: r.truth })) })}\n`);

// -- entities --------------------------------------------------------------------------------

const maps = readJson(join(WORK, 'data/s3/s3_maps.json'));
const synth = readJson(join(WORK, 'data/s3/s3_synth_maps.json'));
const entTruth = readJsonl(join(WORK, 'out/s3_truth.jsonl'));
const synthTruth = readJsonl(join(WORK, 'out/s3_synth_truth.jsonl'));
const labelOf = (t) => (t === 'differ' ? 'drift' : t);
const real = {};
for (const row of entTruth) {
  const t = labelOf(row.truth);
  if (t === 'match') continue;
  ((real[row.mirror] ??= { missing: [], extra: [], drift: [] })[t]).push(row.key);
}
const synthLabels = { missing: [], extra: [], drift: [] };
const kinds = {};
for (const row of synthTruth) {
  const t = labelOf(row.truth);
  if (t !== 'match') synthLabels[t].push(row.key);
  if (row.kind !== 'untouched') kinds[row.key] = row.kind;
}
const mirrors = Object.fromEntries(Object.entries(maps).filter(([k]) => k !== 'canon'));
writeGz('entities.json.gz', { canon: maps.canon, mirrors, truth: real, synthetic: { canon: synth.canon, mirror: synth.mirror, truth: synthLabels, kinds } });

// -- advisories vs OSV ------------------------------------------------------------------------------

const osv = readJson(join(WORK, 'data/s6_osv.json'));
const canonAdv = readJson(join(WORK, 'data/s6_canon.json'));
const advTruth = readJsonl(join(WORK, 'out/s6_truth.jsonl'));
writeGz('advisories-vs-osv.json.gz', {
  canonical: Object.fromEntries(Object.entries(canonAdv).map(([id, r]) => [id, reduce(r)])),
  mirror: Object.fromEntries(Object.entries(osv.records).map(([id, r]) => [id, reduce(r)])),
  truth: Object.fromEntries(advTruth.map((r) => [r.id, { changed: r.truth_changed, hides: r.truth_stampHidesDrift }])),
});

// -- hand-typed constants -----------------------------------------------------------------------------

const s7 = readJson(join(WORK, 'data/s7_texts.json'));
const oracle = readJsonl(join(WORK, 'out/s7_oracle.jsonl'));
const excluded = readJsonl(join(WORK, 'out/s7_oracle_negatives.jsonl'));
// Adjudicated by reading each context: these oracle hits are not hand-typed constants (a `.1f` format spec).
const NOT_A_HIT = ['PYSEC-2026-3495#c1@3297', 'PYSEC-2026-3654#c1@5344', 'PYSEC-2026-3681#c1@6893'];
writeGz('constants.json.gz', {
  registry: s7.reg,
  texts: s7.texts,
  oracle: oracle.map((r) => ({ id: `${r.tid}#${r.const}@${r.index}`, text: r.text })),
  notAHit: NOT_A_HIT,
  // Digit runs whose value equals a registered constant that the README rules say are not hand-typed copies (version fragments, glued to a word, in a dotted run).
  excluded: excluded.map((r) => ({ id: `${r.tid}#${r.const}@${r.index}`, text: r.text })),
});

// -- the reduction changes nothing the kit looks at ----------------------------------------------------

// Every real snapshot pair, audited once on the full records and once on the reduced ones: the
// report must be identical (status, counts and every flagged id). Needs a built kit.
const kitPath = process.env.BENCH_KIT ?? join(OUT, '..', '..', 'dist', 'index.js');
if (existsSync(kitPath)) {
  const kit = await import(pathToFileURL(kitPath).href);
  const full = (label) => Object.entries(manifests[label].files).filter(([path]) => path.endsWith('.yaml')).map(([, sha]) => store[sha]);
  const reduced = (label) => {
    const state = stateOf(label);
    return [...state.values()].map((v) => versions[v]);
  };
  const summary = (audit) => JSON.stringify([
    audit.status, audit.compared, audit.added.length, audit.removed.length,
    audit.stampOnly.map((x) => x.id).sort(), audit.backward.map((x) => x.id).sort(), audit.future.map((x) => x.id).sort(),
    audit.bulkBump.map((x) => [x.date, x.count, x.withEvidence, x.withoutEvidence, [...x.ids].sort()]).sort(), audit.unknown.map((x) => x.id).sort(),
  ]);
  let checked = 0;
  for (const [l0, l1] of pairs) {
    if (manifests[l0].commit === manifests[l1].commit) continue;
    const options = { reviewedField: 'modified', sourceFields: ['references'], now: manifests[l1].committed };
    const a = summary(kit.auditReviewStamps(full(l0), full(l1), options));
    const b = summary(kit.auditReviewStamps(reduced(l0), reduced(l1), options));
    if (a !== b) throw new Error(`reduction changed the audit of ${l0}>${l1}`);
    checked += 1;
  }
  console.log(`reduction check: ${checked} snapshot pairs give the same audit on full and reduced records`);
} else {
  console.log(`reduction check skipped: ${kitPath} is not built`);
}
