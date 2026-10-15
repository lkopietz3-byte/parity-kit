// The vendored families: data in bench/data, labels produced by independent oracles (see bench/build).
// Each function runs the kit on the data and adds confusion matrices to the report.

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATA = join(fileURLToPath(new URL('..', import.meta.url)), 'data');

export function readGz(name) {
  return JSON.parse(gunzipSync(readFileSync(join(DATA, name))).toString('utf8'));
}

/** The per-key verdict of a compareMirror result: match, missing, extra, drift or unknown. */
export function mirrorVerdicts(result) {
  const verdicts = new Map();
  const put = (id, v) => {
    if (!verdicts.has(id)) verdicts.set(id, v);
  };
  for (const id of result.missing) put(id, 'missing');
  for (const id of result.extra) put(id, 'extra');
  for (const c of result.changed) put(c.id, 'drift');
  for (const d of result.duplicateKeys) put(d.id, 'unknown');
  for (const i of result.invalid) if (i.id !== undefined) put(i.id, 'unknown');
  return verdicts;
}

function lookalikeKeys(result) {
  const keys = new Set();
  for (const g of result.suspectKeys) for (const k of g.keys) keys.add(k.key);
  return keys;
}

/**
 * Run one canonical/mirror pair and add one item per key to `matrix`.
 * `truth` is { missing, extra, drift }: arrays of keys. A key in neither is `match`.
 * `ids` is every key of either side.
 */
export function scoreMirrorPair(matrix, tally, kit, canonical, mirror, options, truth, ids) {
  const result = kit.compareMirror(canonical, mirror, options);
  const verdicts = mirrorVerdicts(result);
  const label = new Map();
  for (const k of truth.missing) label.set(k, 'missing');
  for (const k of truth.extra) label.set(k, 'extra');
  for (const k of truth.drift) label.set(k, 'drift');
  const lookalike = lookalikeKeys(result);
  let lookalikeMatch = 0;
  for (const id of ids) {
    const t = label.get(id) ?? 'match';
    matrix.add(t, verdicts.get(id) ?? 'match');
    if (lookalike.has(id) && t === 'match') lookalikeMatch += 1;
  }
  tally.statuses[result.status] = (tally.statuses[result.status] ?? 0) + 1;
  tally.pairs += 1;
  tally.lookalikeMatchItems += lookalikeMatch;
  tally.lookalikeGroups += result.suspectKeys.length;
  return result;
}

export function newTally() {
  return { pairs: 0, statuses: {}, lookalikeMatchItems: 0, lookalikeGroups: 0 };
}

// ---------------------------------------------------------------------------
// i18n: one locale file against the source-language file, per key.
// A "fact" of a string is its placeholder names, tag names and URLs.
// ---------------------------------------------------------------------------

function factRecord(id, f) {
  return f === 0 ? { id, ph: [], tags: [], urls: [] } : { id, ph: f[0], tags: f[1], urls: f[2] };
}

export function runI18n(report, kit, file, id, extra = {}) {
  const data = readGz(file);
  const matrix = report.matrix(id, {
    check: 'compareMirror',
    what: `${data.project}: every key of every locale file against the source-language file, fields ${data.fields.join(', ')}`,
    denominators: 'keys in the union of both files, summed over locale files',
    ...extra,
  });
  const canonical = Object.entries(data.canonical).map(([k, f]) => factRecord(k, f));
  const tally = newTally();
  for (const locale of Object.keys(data.locales).sort()) {
    const { mirror, truth } = data.locales[locale];
    const mirrorRecords = Object.entries(mirror).map(([k, f]) => factRecord(k, f));
    const ids = new Set(Object.keys(data.canonical));
    for (const k of Object.keys(mirror)) ids.add(k);
    scoreMirrorPair(matrix, tally, kit, canonical, mirrorRecords, { fields: data.fields }, truth, ids);
  }
  report.note(id, 'locales', tally.pairs);
  report.note(id, 'resultStatus', tally.statuses);
  report.note(id, 'itemsInLookalikeGroups', tally.lookalikeMatchItems);
}

// ---------------------------------------------------------------------------
// Entity tables: names to code points.
// ---------------------------------------------------------------------------

const asRecords = (map) => Object.entries(map).map(([id, characters]) => ({ id, characters }));

export function runEntities(report, kit, { real = true } = {}) {
  const data = readGz('entities.json.gz');
  const configs = [
    ['default', { fields: ['characters'] }],
    ['foldCase-false', { fields: ['characters'], foldCase: false }],
  ];
  const canon = asRecords(data.canon);
  for (const [name, options] of real ? configs : []) {
    const id = `compareMirror/entities-real/${name}`;
    const matrix = report.matrix(id, {
      check: 'compareMirror',
      what: 'WHATWG entity table against six published copies (stdlib and npm packages), per entity name',
      denominators: 'entity names in the union of both tables, summed over the six copies',
    });
    const tally = newTally();
    for (const [mirrorName, map] of Object.entries(data.mirrors)) {
      const ids = new Set([...Object.keys(data.canon), ...Object.keys(map)]);
      scoreMirrorPair(matrix, tally, kit, canon, asRecords(map), options, data.truth[mirrorName] ?? { missing: [], extra: [], drift: [] }, ids);
    }
    report.note(id, 'resultStatus', tally.statuses);
    report.note(id, 'itemsInLookalikeGroups', tally.lookalikeMatchItems);
  }
  const s = data.synthetic;
  for (const [name, options] of configs) {
    const id = `compareMirror/entities-synthetic/${name}`;
    const matrix = report.matrix(id, {
      check: 'compareMirror',
      what: 'a real copy with seeded edits (value swaps, zero-width and trailing-space suffixes, NFD forms, deletions, additions, Cyrillic homoglyph renames); labels by construction',
      denominators: 'entity names in the union of both tables',
    });
    const tally = newTally();
    const ids = new Set([...Object.keys(s.canon), ...Object.keys(s.mirror)]);
    scoreMirrorPair(matrix, tally, kit, asRecords(s.canon), asRecords(s.mirror), options, s.truth, ids);
    report.note(id, 'resultStatus', tally.statuses);
    report.note(id, 'itemsInLookalikeGroups', tally.lookalikeMatchItems);
  }
}

// ---------------------------------------------------------------------------
// Review stamps.
// ---------------------------------------------------------------------------

export const STAMP_FLAGS = ['stampOnly', 'backward', 'future', 'bulkBump', 'unknown'];
const STAMP_BASE = { reviewedField: 'modified', sourceFields: ['references'] };

/** The flags the kit gave each record id. */
export function auditFlags(audit) {
  const flags = new Map();
  const add = (id, f) => {
    if (!flags.has(id)) flags.set(id, new Set());
    flags.get(id).add(f);
  };
  for (const x of audit.stampOnly) add(x.id, 'stampOnly');
  for (const x of audit.backward) add(x.id, 'backward');
  for (const x of audit.future) add(x.id, 'future');
  for (const x of audit.bulkBump) for (const id of x.ids) add(id, 'bulkBump');
  for (const x of audit.unknown) add(x.id, 'unknown');
  return flags;
}

// The kit's `unknown` entry means a stamp it could not read. The matrix words `match`/`unknown` already have
// other meanings, so that class is named `unreadable-stamp` in the matrices.
const classOf = (flag) => (flag === 'unknown' ? 'unreadable-stamp' : flag);

/** One 2x2 per flag, for `universe` items of which `truthFlags` (id to flags) carry labels. */
function addFlagCounts(matrices, flags, kitFlags, truthFlags, universe) {
  for (const flag of flags) {
    let tp = 0;
    let fn = 0;
    let fp = 0;
    for (const [id, fs] of truthFlags) {
      if (!fs.includes(flag)) continue;
      if (kitFlags.get(id)?.has(flag)) tp += 1;
      else fn += 1;
    }
    for (const [id, fs] of kitFlags) if (fs.has(flag) && !(truthFlags.get(id) ?? []).includes(flag)) fp += 1;
    const m = matrices.get(flag);
    const cls = classOf(flag);
    m.add(cls, cls, tp);
    m.add(cls, 'match', fn);
    m.add('match', cls, fp);
    m.add('match', 'match', universe - tp - fn - fp);
  }
}

function stampMatrices(report, prefix, what, denominators, flags = STAMP_FLAGS) {
  const out = new Map();
  for (const flag of flags) {
    out.set(flag, report.matrix(`${prefix}/${classOf(flag)}`, { check: 'auditReviewStamps', what: `${what}: ${flag}`, denominators }));
  }
  return out;
}

function replay(history) {
  const states = new Map();
  for (const label of history.order) {
    const s = history.snapshots[label];
    if (s.full !== undefined) {
      states.set(label, new Map(Object.entries(s.full)));
    } else {
      const state = new Map(states.get(s.after));
      for (const id of s.del) state.delete(id);
      for (const [id, v] of Object.entries(s.set)) state.set(id, v);
      states.set(label, state);
    }
  }
  const stateOf = (label) => {
    const s = history.snapshots[label];
    return states.get(s.same ?? label);
  };
  const commitOf = (label) => history.snapshots[label].same ?? label;
  const records = (label) => [...stateOf(label).values()].map((v) => history.versions[v]);
  return { stateOf, commitOf, records };
}

export function runStampsHistory(report, kit) {
  const history = readGz('stamps-history.json.gz');
  const { stateOf, commitOf, records } = replay(history);
  const matrices = stampMatrices(report, 'auditReviewStamps/pypa-history', 'one real pair of daily or horizon snapshots of the pypa advisory database; `modified` is the review stamp, any other field change is evidence', 'record pairs (union of ids on both sides), summed over pairs with a change');
  let compared = 0;
  let pairsRun = 0;
  for (const [l0, l1] of history.pairs) {
    if (commitOf(l0) === commitOf(l1)) continue;
    const name = `${l0}>${l1}`;
    const before = records(l0);
    const after = records(l1);
    const audit = kit.auditReviewStamps(before, after, { ...STAMP_BASE, now: history.snapshots[l1].committed });
    const universe = new Set([...stateOf(l0).keys(), ...stateOf(l1).keys()]).size;
    if (universe !== history.records[name]) throw new Error(`${name}: ${universe} records, the labels cover ${history.records[name]}`);
    const truth = new Map(Object.entries(history.truth[name] ?? {}));
    addFlagCounts(matrices, STAMP_FLAGS, auditFlags(audit), truth, universe);
    compared += universe;
    pairsRun += 1;
  }
  for (const flag of STAMP_FLAGS) {
    report.note(`auditReviewStamps/pypa-history/${classOf(flag)}`, 'pairsAudited', pairsRun);
    report.note(`auditReviewStamps/pypa-history/${classOf(flag)}`, 'recordPairComparisons', compared);
  }
}

export function runStampsInjected(report, kit) {
  const history = readGz('stamps-history.json.gz');
  const injected = readGz('stamps-injected.json.gz');
  const { records } = replay(history);
  const before = records(injected.L0);
  const afterBase = records(injected.L1);
  const matrices = stampMatrices(report, 'auditReviewStamps/pypa-injected', 'real records with a seeded stamp edit (later, backward, same instant in another notation, sub-millisecond, future, bulk of 10, 11, 25, odd or removed stamps, bare dates)', 'edited records');
  const variantAgreement = {};
  for (const [name, overrides] of Object.entries(injected.variants)) {
    const after = afterBase.map((r) => (r.id in overrides ? overrides[r.id] : r));
    const audit = kit.auditReviewStamps(before, after, { ...STAMP_BASE, now: injected.now });
    const kitFlags = auditFlags(audit);
    const truth = new Map(Object.entries(injected.truth[name]));
    const universe = truth.size;
    // Only the edited records are scored; flags on other records are the real pair's and are scored in the history family.
    const scoped = new Map([...kitFlags].filter(([id]) => truth.has(id)));
    addFlagCounts(matrices, STAMP_FLAGS, scoped, truth, universe);
    let agree = 0;
    for (const [id, fs] of truth) {
      const a = [...fs].sort().join(',');
      const b = [...(kitFlags.get(id) ?? [])].sort().join(',');
      if (a === b) agree += 1;
    }
    variantAgreement[name] = `${agree}/${universe}`;
  }
  report.note('auditReviewStamps/pypa-injected/stampOnly', 'exactFlagSetByVariant', variantAgreement);
}

export function runStampsEdge(report, kit) {
  const edge = JSON.parse(readFileSync(join(DATA, 'stamps-edge.json'), 'utf8'));
  const matrices = stampMatrices(report, 'auditReviewStamps/stamp-edge-cases', 'one record whose stamp moves from 2026-06-01 to a boundary notation (offsets, fractions, leap days, 24:00, whitespace, full-width digits)', 'stamp strings', ['stampOnly', 'backward', 'future', 'unknown']);
  for (const row of edge.rows) {
    const audit = kit.auditReviewStamps([{ id: 'a', modified: edge.before, v: 1 }], [{ id: 'a', modified: row.stamp, v: 1 }], { reviewedField: 'modified', sourceFields: [], now: edge.now });
    addFlagCounts(matrices, ['stampOnly', 'backward', 'future', 'unknown'], auditFlags(audit), new Map([['a', row.truth]]), 1);
  }
}

export function runStampsOptions(report, kit) {
  const history = readGz('stamps-history.json.gz');
  const { stateOf, records } = replay(history);
  const flags = ['stampOnly', 'bulkBump'];
  const matrices = stampMatrices(report, 'auditReviewStamps/pypa-option-variants', 'the six horizon pairs again with valueFields or ignoreFields changing what counts as evidence', 'record pairs (union of ids), summed over six pairs and three option sets', flags);
  const truthBy = new Map();
  for (const row of history.optionTruth) {
    const key = `${row.pair}|${row.variant}`;
    if (!truthBy.has(key)) truthBy.set(key, new Map());
    truthBy.get(key).set(row.id, row.truth);
  }
  for (const pair of history.optionPairs) {
    const [l0, l1] = pair.split('>');
    const before = records(l0);
    const after = records(l1);
    const universe = new Set([...stateOf(l0).keys(), ...stateOf(l1).keys()]).size;
    for (const [variant, extra] of Object.entries(history.optionVariants)) {
      const audit = kit.auditReviewStamps(before, after, { ...STAMP_BASE, now: history.snapshots[l1].committed, ...extra });
      addFlagCounts(matrices, flags, auditFlags(audit), truthBy.get(`${pair}|${variant}`) ?? new Map(), universe);
    }
  }
}

// ---------------------------------------------------------------------------
// One advisory, two copies: the pypa advisory file against the OSV.dev API copy.
// ---------------------------------------------------------------------------

export function runAdvisories(report, kit) {
  const data = readGz('advisories-vs-osv.json.gz');
  const ids = Object.keys(data.canonical).sort();
  const result = kit.compareMirror(ids.map((i) => data.canonical[i]), ids.map((i) => data.mirror[i]), { reviewedField: 'modified' });
  const fieldMatrix = report.matrix('compareMirror/pypa-vs-osv/fields', {
    check: 'compareMirror',
    what: 'one advisory in the pypa database against the same advisory served by OSV.dev, per field (fields other than id and modified are digests of the values)',
    denominators: 'fields in the union of both copies of an advisory, summed over 200 advisories',
  });
  const hidesMatrix = report.matrix('compareMirror/pypa-vs-osv/stampHidesDrift', {
    check: 'compareMirror',
    what: 'advisories whose `modified` stamp is the same instant in both copies while another field differs',
    denominators: '200 advisories',
  });
  const kitChange = new Map();
  for (const c of result.changed) kitChange.set(`${c.id}\u0000${c.field}`, c.change);
  const hides = new Set(result.stampHidesDrift.map((x) => x.id));
  for (const id of ids) {
    const truth = new Map(data.truth[id].changed.map(([field, change]) => [field, change]));
    const fields = new Set([...Object.keys(data.canonical[id]), ...Object.keys(data.mirror[id])]);
    fields.delete('id');
    for (const field of fields) fieldMatrix.add(truth.get(field) ?? 'match', kitChange.get(`${id}\u0000${field}`) ?? 'match');
    hidesMatrix.add(data.truth[id].hides ? 'stampHidesDrift' : 'match', hides.has(id) ? 'stampHidesDrift' : 'match');
  }
}

// ---------------------------------------------------------------------------
// Hand-typed constants.
// ---------------------------------------------------------------------------

export function runConstants(report, kit) {
  const data = readGz('constants.json.gz');
  const matrix = report.matrix('findHandTypedConstants/advisory-texts', {
    check: 'findHandTypedConstants',
    what: '400 advisory descriptions and 9 registered numbers; every digit run equal to a registered number is either a hand-typed copy or not, by the README rules',
    denominators: 'digit runs whose value equals a registered number (typed copies, plus runs the rules exclude), plus kit hits that are neither',
  });
  const notAHit = new Set(data.notAHit);
  const truthHits = new Set(data.oracle.map((r) => r.id).filter((id) => !notAHit.has(id)));
  const excluded = new Set([...data.excluded.map((r) => r.id), ...data.notAHit]);
  const kitHits = new Set();
  for (const { id, text } of data.texts) {
    for (const h of kit.findHandTypedConstants(text, data.registry)) kitHits.add(`${id}#${h.id}@${h.index}`);
  }
  for (const id of truthHits) matrix.add('hit', kitHits.has(id) ? 'hit' : 'match');
  const candidates = new Set([...truthHits, ...excluded]);
  for (const id of excluded) matrix.add('match', kitHits.has(id) ? 'hit' : 'match');
  for (const id of kitHits) if (!candidates.has(id)) matrix.add('match', 'hit');
  report.note('findHandTypedConstants/advisory-texts', 'kitHits', kitHits.size);
  const missed = [...truthHits].filter((id) => !kitHits.has(id));
  const extraHits = [...kitHits].filter((id) => !candidates.has(id) || excluded.has(id));
  report.note('findHandTypedConstants/advisory-texts', 'missedIds', missed.slice(0, 20));
  report.note('findHandTypedConstants/advisory-texts', 'flaggedNonCopyIds', extraHits.slice(0, 20));
}

// ---------------------------------------------------------------------------
// numberTolerance on decimal grids. Truth is integer arithmetic on whole units
// (cents or tenths), so floating point never decides a label.
// ---------------------------------------------------------------------------

export function runTolerance(report, kit) {
  const grids = [
    ['cents-tol-0.01', 100, 1, 0.01],
    ['tenths-tol-0.1', 10, 1, 0.1],
    ['cents-tol-0.02', 100, 2, 0.02],
  ];
  const n = 9999;
  for (const [name, scale, tolUnits, tolerance] of grids) {
    const id = `compareMirror/numberTolerance/${name}`;
    const matrix = report.matrix(id, {
      check: 'compareMirror',
      what: `prices on a ${scale === 100 ? 'cent' : 'tenth'} grid; the mirror is 0, 1 or 2 units above the canonical price; numberTolerance ${tolerance}`,
      denominators: `${n} price pairs`,
    });
    const boundary = report.matrix(`${id}/at-the-boundary`, {
      check: 'compareMirror',
      what: `only the pairs whose difference is exactly the tolerance (${tolUnits} unit${tolUnits === 1 ? '' : 's'})`,
      denominators: 'price pairs at the boundary',
    });
    const canonical = [];
    const mirror = [];
    for (let i = 0; i < n; i += 1) {
      const d = i % 3;
      canonical.push({ id: `p${i}`, v: Number((i / scale).toFixed(2)) });
      mirror.push({ id: `p${i}`, v: Number(((i + d) / scale).toFixed(2)) });
    }
    const result = kit.compareMirror(canonical, mirror, { fields: ['v'], numberTolerance: tolerance });
    const flagged = new Set(result.changed.map((c) => c.id));
    for (let i = 0; i < n; i += 1) {
      const d = i % 3;
      const truth = d <= tolUnits ? 'match' : 'different';
      const verdict = flagged.has(`p${i}`) ? 'different' : 'match';
      matrix.add(truth, verdict);
      if (d === tolUnits) boundary.add(truth, verdict);
    }
  }
}
