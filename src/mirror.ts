import { parseStamp } from './dates.js';
import { ParityError } from './errors.js';
import { findSuspectKeys } from './keys.js';
import {
  makeBudget,
  optBoolean,
  optNames,
  optString,
  readOptions,
  type Budget,
} from './options.js';
import {
  plainValue,
  readDataset,
  snapEqual,
  type DatasetEntry,
  type ReadDataset,
  type Snap,
} from './snapshot.js';
import type { DuplicateKey, InvalidEntry, Key, Limits, SuspectKeyGroup } from './types.js';

export interface MirrorOptions {
  /** The field that identifies a record in an array. Default `"id"`. In an object keyed by id the property name is the id, and a record that also has this field must agree with it (otherwise `key-mismatch`); name a field the records do not have to turn that check off. */
  key?: string;
  /** Compare only these fields (and `reviewedField`, which is always compared). Default: every own enumerable field of either record. Must name at least one field, and at least one must not be in `ignoreFields`. */
  fields?: readonly string[];
  /** Fields left out of the comparison. A name that appears in no record is reported in `unknownFields`. */
  ignoreFields?: readonly string[];
  /** The field that holds the review date. Enables `stampHidesDrift`. */
  reviewedField?: string;
  /** Treat two finite numbers as equal when they differ by at most this much. Default 0 (exact). */
  numberTolerance?: number;
  /** Allow an empty canonical set to pass. By default an empty canonical set is reported as invalid. */
  allowEmpty?: boolean;
  /** Fold upper and lower case when looking for look-alike keys. Default true. */
  foldCase?: boolean;
  /** Remove invisible characters (zero-width characters, variation selectors, joiners, tag characters, control characters) when looking for look-alike keys. Default true. Pass false for key sets that legitimately carry them, such as emoji sequences or ids joined by a control-character separator; keys that differ only by an invisible character are then different keys, and a renamed one still shows as `missing` plus `extra`. */
  foldInvisible?: boolean;
  limits?: Limits;
}

/** One field that differs between the canonical record and its mirror. */
export interface ChangedField {
  id: Key;
  field: string;
  /** `different`: both copies have the field. `missing-in-mirror` / `extra-in-mirror`: only one copy has it. */
  change: 'different' | 'missing-in-mirror' | 'extra-in-mirror';
  /** `undefined` when the canonical record has no such field. */
  canonical: unknown;
  /** `undefined` when the mirror record has no such field. */
  mirror: unknown;
}

/** Both copies carry the same review date, yet other fields differ. */
export interface StampHidesDrift {
  id: Key;
  reviewedValue: unknown;
  fields: string[];
}

export type Status = 'ok' | 'flagged' | 'unknown';

export interface MirrorResult {
  /** True only when nothing at all is reported. */
  ok: boolean;
  /** `flagged`: positive evidence of drift. `unknown`: nothing is flagged but something could not be checked. `ok`: nothing reported. */
  status: Status;
  /** Records present once on both sides and compared field by field. */
  compared: number;
  /**
   * True when records were matched but no field of any of them was compared
   * because `ignoreFields` removed every field they carry. Nothing was checked,
   * so the result is `unknown`, never `ok`.
   */
  noFieldsCompared: boolean;
  /** Keys in the canonical set that the mirror lacks. */
  missing: Key[];
  /** Keys in the mirror that the canonical set lacks. */
  extra: Key[];
  changed: ChangedField[];
  stampHidesDrift: StampHidesDrift[];
  duplicateKeys: DuplicateKey[];
  /**
   * Selected or ignored names (`fields`, `reviewedField`, `ignoreFields`) that appear in
   * no readable record on either side, in the order they were given. A misspelled name
   * lands here, so the result is never `ok`.
   */
  unknownFields: string[];
  /** Look-alike keys. Reported, never merged. */
  suspectKeys: SuspectKeyGroup[];
  invalid: InvalidEntry[];
}

const WHAT = 'compareMirror';
const OPTION_NAMES = [
  'key', 'fields', 'ignoreFields', 'reviewedField', 'numberTolerance', 'allowEmpty', 'foldCase', 'foldInvisible', 'limits',
];

export interface Indexed {
  byId: Map<Key, DatasetEntry[]>;
  order: Key[];
}

export function indexEntries(entries: readonly DatasetEntry[]): Indexed {
  const byId = new Map<Key, DatasetEntry[]>();
  const order: Key[] = [];
  for (const entry of entries) {
    if (entry.id === undefined) continue;
    const list = byId.get(entry.id);
    if (list === undefined) {
      byId.set(entry.id, [entry]);
      order.push(entry.id);
    } else {
      list.push(entry);
    }
  }
  return { byId, order };
}

export function duplicatesOf(side: string, indexed: Indexed): DuplicateKey[] {
  const out: DuplicateKey[] = [];
  for (const id of indexed.order) {
    const list = indexed.byId.get(id) as DatasetEntry[];
    if (list.length > 1) out.push({ side, id, positions: list.map((e) => e.position) });
  }
  return out;
}

export function invalidOf(side: string, read: ReadDataset): InvalidEntry[] {
  return read.invalid.map((item) => {
    const entry: InvalidEntry = { side, position: item.position, reason: item.reason };
    if (item.id !== undefined) entry.id = item.id;
    if (item.path !== undefined) entry.path = item.path;
    if (item.detail !== undefined) entry.detail = item.detail;
    return entry;
  });
}

/**
 * Which of `names` appear in no readable record of the given datasets? The key
 * field counts as present when any record has a usable key (in an object keyed
 * by id too, where the property name is the key). Empty when there is no
 * readable record at all (there is nothing to say a name is missing from).
 * One pass over the fields that were read.
 */
export function findUnknownFields(
  datasets: ReadonlyArray<readonly DatasetEntry[]>,
  names: readonly string[],
  key: string,
): string[] {
  if (names.length === 0) return [];
  const wanted = new Set(names);
  const found = new Set<string>();
  let readable = false;
  for (const entries of datasets) {
    for (const entry of entries) {
      if (entry.fields === undefined) continue;
      readable = true;
      if (entry.id !== undefined && wanted.has(key)) found.add(key);
      for (const field of entry.fields.keys()) if (wanted.has(field)) found.add(field);
    }
  }
  if (!readable) return [];
  const out: string[] = [];
  const emitted = new Set<string>();
  for (const name of names) {
    if (!found.has(name) && !emitted.has(name)) {
      emitted.add(name);
      out.push(name);
    }
  }
  return out;
}

/** How many records of a side could not be read well enough to know their id. */
function unreadableIds(read: ReadDataset): number {
  let count = 0;
  for (const item of read.invalid) if (item.reason === 'unreadable' && item.id === undefined) count += 1;
  return count;
}

export function emptyDatasetInvalid(side: string): InvalidEntry {
  return {
    side,
    position: null,
    reason: 'empty-dataset',
    detail: `the ${side} set has no records, so there is nothing to compare; pass allowEmpty if that is expected`,
  };
}

function sortedUnion(a: ReadonlyMap<string, Snap>, b: ReadonlyMap<string, Snap>): string[] {
  const names = new Set<string>();
  for (const k of a.keys()) names.add(k);
  for (const k of b.keys()) names.add(k);
  return [...names].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
}

function present(value: Snap | undefined): value is Snap {
  return value !== undefined && value !== null && value !== '';
}

function sameStamp(a: Snap, b: Snap): boolean {
  if (snapEqual(a, b, 0)) return true;
  if (typeof a === 'string' && typeof b === 'string') {
    const pa = parseStamp(a);
    const pb = parseStamp(b);
    return pa.ok && pb.ok && pa.ms === pb.ms;
  }
  return false;
}

export function readTolerance(o: Record<string, unknown>, what: string): number {
  const tol = o['numberTolerance'];
  if (tol === undefined) return 0;
  if (typeof tol !== 'number' || !Number.isFinite(tol) || tol < 0) {
    throw new ParityError('bad-options', `${what}: option "numberTolerance" must be a finite number of zero or more`);
  }
  return tol;
}

/**
 * Does every record in the mirror still match the canonical record with the
 * same key? Reports records missing from the mirror, extra in the mirror,
 * fields that differ, review dates that hide drift, duplicate keys, look-alike
 * keys and records that could not be read.
 *
 * Throws `ParityError` for bad options, an argument that is not a dataset, or
 * a size limit. A single bad record is reported in `invalid`, not thrown.
 */
export function compareMirror(canonical: unknown, mirror: unknown, options?: MirrorOptions): MirrorResult {
  const o = readOptions(options, OPTION_NAMES, WHAT);
  const key = optString(o, 'key', WHAT) ?? 'id';
  const fields = optNames(o, 'fields', WHAT);
  const ignoreFields = optNames(o, 'ignoreFields', WHAT) ?? [];
  const reviewedField = optString(o, 'reviewedField', WHAT);
  if (fields !== undefined) {
    // An empty selection (for example Object.keys of an empty schema) would compare nothing and pass.
    if (fields.length === 0) {
      throw new ParityError('bad-options', `${WHAT}: option "fields" must name at least one field`);
    }
    // `reviewedField` is always compared, so it counts as a selection unless `ignoreFields` removes it.
    const ignored = new Set(ignoreFields);
    const reviewCounts = reviewedField !== undefined && !ignored.has(reviewedField);
    if (!reviewCounts && fields.every((name) => ignored.has(name))) {
      throw new ParityError('bad-options', `${WHAT}: every field in "fields" is also in "ignoreFields", so nothing would be compared`);
    }
  }
  const tolerance = readTolerance(o, WHAT);
  const allowEmpty = optBoolean(o, 'allowEmpty', WHAT) ?? false;
  const foldCase = optBoolean(o, 'foldCase', WHAT) ?? true;
  const foldInvisible = optBoolean(o, 'foldInvisible', WHAT) ?? true;
  const budget: Budget = makeBudget(o['limits'], WHAT);

  let names: string[] | null = null;
  if (fields !== undefined) {
    // Ignored names are read too (and then left out) so a misspelled one can be reported.
    const set = new Set<string>(fields);
    if (reviewedField !== undefined) set.add(reviewedField);
    for (const name of ignoreFields) set.add(name);
    names = [...set];
  }
  const includeKey = reviewedField === key || (fields?.includes(key) ?? false);
  const cfg = { key, names, includeKey };
  const c = readDataset(canonical, 'canonical', cfg, budget);
  const m = readDataset(mirror, 'mirror', cfg, budget);
  const ci = indexEntries(c.entries);
  const mi = indexEntries(m.entries);

  const invalid = [...invalidOf('canonical', c), ...invalidOf('mirror', m)];
  if (c.entries.length === 0 && !allowEmpty) invalid.push(emptyDatasetInvalid('canonical'));
  const duplicateKeys = [...duplicatesOf('canonical', ci), ...duplicatesOf('mirror', mi)];

  const missing: Key[] = [];
  const extra: Key[] = [];
  const changed: ChangedField[] = [];
  const stampHidesDrift: StampHidesDrift[] = [];
  let compared = 0;
  let examined = 0;
  let suppressed = 0;

  for (const id of ci.order) if (!mi.byId.has(id)) missing.push(id);
  for (const id of mi.order) if (!ci.byId.has(id)) extra.push(id);
  // A record whose id could not be read may be any of the ids the other side
  // lacks, so those ids are not claimed as missing or extra unless there are
  // more of them than unreadable records could explain. The unreadable
  // record is already in `invalid`, so the result is `unknown`, not `ok`.
  if (missing.length <= unreadableIds(m)) missing.length = 0;
  if (extra.length <= unreadableIds(c)) extra.length = 0;

  const only = fields !== undefined ? new Set(fields) : null;
  const ignore = new Set(ignoreFields);
  for (const id of ci.order) {
    const cl = ci.byId.get(id) as DatasetEntry[];
    const ml = mi.byId.get(id);
    if (ml === undefined || cl.length !== 1 || ml.length !== 1) continue;
    const cf = (cl[0] as DatasetEntry).fields;
    const mf = (ml[0] as DatasetEntry).fields;
    if (cf === undefined || mf === undefined) continue;
    compared += 1;
    const diffs: string[] = [];
    for (const field of sortedUnion(cf, mf)) {
      // The review field is compared even when `fields` does not list it, so a different review value is never silent.
      if (only !== null && !only.has(field) && field !== reviewedField) continue;
      // The key column is equal by construction, so it is neither a comparison nor an ignored comparison.
      const keyColumn = includeKey && field === key;
      if (ignore.has(field)) {
        if (!keyColumn) suppressed += 1;
        continue;
      }
      if (!keyColumn) examined += 1;
      const a = cf.get(field);
      const b = mf.get(field);
      const inC = cf.has(field);
      const inM = mf.has(field);
      if (inC && inM) {
        if (snapEqual(a, b, tolerance)) continue;
        changed.push({ id, field, change: 'different', canonical: plainValue(a), mirror: plainValue(b) });
      } else if (inC) {
        changed.push({ id, field, change: 'missing-in-mirror', canonical: plainValue(a), mirror: undefined });
      } else {
        changed.push({ id, field, change: 'extra-in-mirror', canonical: undefined, mirror: plainValue(b) });
      }
      if (field !== reviewedField) diffs.push(field);
    }
    if (reviewedField !== undefined && diffs.length > 0) {
      const ra = cf.get(reviewedField);
      const rb = mf.get(reviewedField);
      if (present(ra) && present(rb) && sameStamp(ra, rb)) {
        stampHidesDrift.push({ id, reviewedValue: plainValue(ra), fields: diffs });
      }
    }
  }

  const suspectKeys = findSuspectKeys(
    [
      { side: 'canonical', keys: ci.order },
      { side: 'mirror', keys: mi.order },
    ],
    { foldCase, foldInvisible },
  );

  const unknownFields = findUnknownFields(
    [c.entries, m.entries],
    [...new Set([...(fields ?? []), ...(reviewedField === undefined ? [] : [reviewedField]), ...ignoreFields])],
    key,
  );
  // Records were matched, every field they carry was ignored: nothing was checked.
  const noFieldsCompared = compared > 0 && examined === 0 && suppressed > 0;
  const flagged =
    missing.length + extra.length + changed.length + stampHidesDrift.length + duplicateKeys.length > 0;
  const unknown = invalid.length + suspectKeys.length + unknownFields.length > 0 || noFieldsCompared;
  const status: Status = flagged ? 'flagged' : unknown ? 'unknown' : 'ok';
  return {
    ok: status === 'ok',
    status,
    compared,
    noFieldsCompared,
    missing,
    extra,
    changed,
    stampHidesDrift,
    duplicateKeys,
    unknownFields,
    suspectKeys,
    invalid,
  };
}
