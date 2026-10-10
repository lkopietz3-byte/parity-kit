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
  /** The field that identifies a record in an array. Default `"id"`. Ignored for ids taken from object keys. */
  key?: string;
  /** Compare only these fields. Default: every own enumerable field of either record. */
  fields?: readonly string[];
  /** Fields left out of the comparison. */
  ignoreFields?: readonly string[];
  /** The field that holds the review date. Enables `stampHidesDrift`. */
  reviewedField?: string;
  /** Treat two finite numbers as equal when they differ by at most this much. Default 0 (exact). */
  numberTolerance?: number;
  /** Allow an empty canonical set to pass. By default an empty canonical set is reported as invalid. */
  allowEmpty?: boolean;
  /** Fold upper and lower case when looking for look-alike keys. Default true. */
  foldCase?: boolean;
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
  /** Keys in the canonical set that the mirror lacks. */
  missing: Key[];
  /** Keys in the mirror that the canonical set lacks. */
  extra: Key[];
  changed: ChangedField[];
  stampHidesDrift: StampHidesDrift[];
  duplicateKeys: DuplicateKey[];
  /** Look-alike keys. Reported, never merged. */
  suspectKeys: SuspectKeyGroup[];
  invalid: InvalidEntry[];
}

const WHAT = 'compareMirror';
const OPTION_NAMES = [
  'key', 'fields', 'ignoreFields', 'reviewedField', 'numberTolerance', 'allowEmpty', 'foldCase', 'limits',
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
  const tolerance = readTolerance(o, WHAT);
  const allowEmpty = optBoolean(o, 'allowEmpty', WHAT) ?? false;
  const foldCase = optBoolean(o, 'foldCase', WHAT) ?? true;
  const budget: Budget = makeBudget(o['limits'], WHAT);

  let names: string[] | null = null;
  if (fields !== undefined) {
    names = [...fields];
    if (reviewedField !== undefined && !names.includes(reviewedField)) names.push(reviewedField);
  }
  const cfg = { key, names };
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

  for (const id of ci.order) if (!mi.byId.has(id)) missing.push(id);
  for (const id of mi.order) if (!ci.byId.has(id)) extra.push(id);

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
      if (ignore.has(field) || (only !== null && !only.has(field))) continue;
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
    foldCase,
  );

  const flagged =
    missing.length + extra.length + changed.length + stampHidesDrift.length + duplicateKeys.length > 0;
  const unknown = invalid.length + suspectKeys.length > 0;
  const status: Status = flagged ? 'flagged' : unknown ? 'unknown' : 'ok';
  return {
    ok: status === 'ok',
    status,
    compared,
    missing,
    extra,
    changed,
    stampHidesDrift,
    duplicateKeys,
    suspectKeys,
    invalid,
  };
}
