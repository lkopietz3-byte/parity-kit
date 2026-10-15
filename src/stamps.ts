import { formatDay, isFuture, parseStamp, utcDay, type StampProblem } from './dates.js';
import { ParityError } from './errors.js';
import { findSuspectKeys } from './keys.js';
import { duplicatesOf, emptyDatasetInvalid, findUnknownFields, indexEntries, invalidOf, type Status } from './mirror.js';
import {
  makeBudget,
  optBoolean,
  optNames,
  optString,
  readOptions,
} from './options.js';
import { dateTime, plainValue, readDataset, snapEqual, type DatasetEntry, type Snap } from './snapshot.js';
import type { DuplicateKey, InvalidEntry, Key, Limits, SuspectKeyGroup } from './types.js';

export interface StampOptions {
  /** The field that identifies a record in an array. Default `"id"`. */
  key?: string;
  /** The field that holds the review date (a strict ISO 8601 string). Required. */
  reviewedField: string;
  /**
   * Fields that name where a value came from (a URL, a citation, a file).
   * Required; may be empty. A change in any of these counts as evidence of a recheck.
   */
  sourceFields: readonly string[];
  /** Who reviewed it. A change counts as evidence of a recheck. */
  reviewerField?: string;
  /** A field holding an expiry or next-review deadline. Enables `extendedDeadlines`. */
  expiryField?: string;
  /** Only these fields count as "value" fields. Default: every field. Source and reviewer fields always count. */
  valueFields?: readonly string[];
  /** Fields that never count as evidence (for example an automatic `updatedAt`). */
  ignoreFields?: readonly string[];
  /** The current time. Future-dated stamps are only checked when this is supplied. A Date, epoch milliseconds, or an ISO 8601 timestamp with an explicit zone, in the years 0001 to 9999 (a number outside that range, such as epoch microseconds, throws `bad-options`). */
  now?: Date | number | string;
  /** Flag a bulk bump when MORE than this many records moved to the same new date in one change. Default 10. */
  bulkThreshold?: number;
  /** Allow an empty snapshot. By default an empty one is reported as invalid. */
  allowEmpty?: boolean;
  /** Fold upper and lower case when looking for look-alike keys. Default true. */
  foldCase?: boolean;
  /** Remove invisible characters (zero-width characters, variation selectors, joiners, tag characters, control characters) when looking for look-alike keys. Default true. Pass false for key sets that legitimately carry them, such as emoji sequences or ids joined by a control-character separator. */
  foldInvisible?: boolean;
  limits?: Limits;
}

/** The review date moved later, and no value, source or reviewer changed. */
export interface StampOnly {
  id: Key;
  from: string;
  to: string;
}

/**
 * More than `bulkThreshold` records moved to the same new review day in one
 * change. Records are grouped by the UTC calendar day of their new stamp, so
 * a script that writes a different timestamp on every record is still caught.
 */
export interface BulkBump {
  /** One line to read first, for example `12 records moved to 2026-10-10; 12 of 12 also changed a value, source or reviewer`. */
  summary: string;
  count: number;
  /** How many of those records also show a changed value, source or reviewer. */
  withEvidence: number;
  /** How many show no such change (these are also in `stampOnly`). Zero means every record carried a change. */
  withoutEvidence: number;
  /** The new UTC calendar day, `YYYY-MM-DD`. */
  date: string;
  ids: Key[];
}

/** A review date later than `now`. */
export interface FutureStamp {
  id: Key;
  value: string;
}

/** A review date that moved earlier. */
export interface BackwardStamp {
  id: Key;
  from: string;
  to: string;
}

/** An expiry that moved later while no source field changed. */
export interface ExtendedDeadline {
  id: Key;
  from: string;
  to: string;
}

export type UnknownReason = StampProblem | 'expiry-removed';

/** Something that cannot be judged. Never a pass. */
export interface UnknownStamp {
  id: Key;
  side: 'before' | 'after';
  field: string;
  reason: UnknownReason;
  /** The value found, when there was one. */
  value?: unknown;
}

/** How many `unknown` entries share a field and a reason (both snapshots together). */
export interface UnknownSummary {
  field: string;
  reason: UnknownReason;
  count: number;
}

export interface StampAudit {
  /** True only when nothing at all is reported. */
  ok: boolean;
  /** `flagged`: positive evidence a stamp was not earned. `unknown`: nothing flagged but something could not be judged. `ok`: nothing reported. */
  status: Status;
  /** Records present once and readable in both snapshots. */
  compared: number;
  /**
   * True when both snapshots have keyed records and not one key appears in both,
   * so nothing could be compared. That is what a wholesale rename of every id
   * looks like (or the wrong two files). The result is `unknown`, never `ok`:
   * a gate must not pass because every record looked new.
   */
  noOverlap: boolean;
  stampOnly: StampOnly[];
  bulkBump: BulkBump[];
  future: FutureStamp[];
  backward: BackwardStamp[];
  extendedDeadlines: ExtendedDeadline[];
  unknown: UnknownStamp[];
  /** `unknown` counted per field and reason, so thousands of entries can be read at a glance. */
  unknownSummary: UnknownSummary[];
  /**
   * Configured names (`reviewedField`, `sourceFields`, `reviewerField`, `expiryField`,
   * `valueFields`, `ignoreFields`) that appear in no readable record in either snapshot,
   * in the order given. A misspelled name lands here and the result is never `ok`. A typo in
   * `ignoreFields` matters most: the field it should have excluded would count as evidence.
   */
  unknownFields: string[];
  /** Keys only in the `after` snapshot. Informational. */
  added: Key[];
  /** Keys only in the `before` snapshot. Informational. */
  removed: Key[];
  duplicateKeys: DuplicateKey[];
  suspectKeys: SuspectKeyGroup[];
  invalid: InvalidEntry[];
}

const WHAT = 'auditReviewStamps';
const OPTION_NAMES = [
  'key', 'reviewedField', 'sourceFields', 'reviewerField', 'expiryField', 'valueFields', 'ignoreFields',
  'now', 'bulkThreshold', 'allowEmpty', 'foldCase', 'foldInvisible', 'limits',
];
const DEFAULT_BULK_THRESHOLD = 10;

/** 0001-01-01T00:00:00.000Z and 9999-12-31T23:59:59.999Z: the years a stamp can have, so the years `now` can have. */
const NOW_MIN_MS = -62135596800000;
const NOW_MAX_MS = 253402300799999;

function readNow(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const bad = (): never => {
    throw new ParityError('bad-options', `${WHAT}: option "now" must be a valid Date, epoch milliseconds, or an ISO 8601 timestamp with an explicit zone, in the years 0001 to 9999 (microseconds or nanoseconds are not milliseconds)`);
  };
  // A `now` after every date a stamp can hold would make the future check silently never fire.
  const inRange = (ms: number): number => (ms >= NOW_MIN_MS && ms <= NOW_MAX_MS ? ms : bad());
  if (typeof value === 'number') return Number.isFinite(value) ? inRange(value) : bad();
  if (typeof value === 'string') {
    const parsed = parseStamp(value);
    return parsed.ok && !parsed.dateOnly ? inRange(parsed.ms) : bad();
  }
  if (typeof value === 'object' && value !== null) {
    const time = dateTime(value);
    return time !== undefined && Number.isFinite(time) ? inRange(time) : bad();
  }
  return bad();
}

function fieldEqual(a: Snap | undefined, b: Snap | undefined): boolean {
  return a === undefined || b === undefined ? a === b : snapEqual(a, b, 0);
}

function stampText(value: Snap | undefined): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Compare two snapshots of the same dataset and report review dates that
 * moved without evidence of a recheck.
 *
 * - `stampOnly`: the review date moved later and no value, source or reviewer changed.
 * - `bulkBump`: more than `bulkThreshold` records moved to the same new date.
 * - `future`: a review date after `now` (only when `now` is supplied).
 * - `backward`: a review date moved earlier.
 * - `extendedDeadlines`: the expiry moved later and no source field changed.
 * - `unknown`: a missing, non-string, zoneless or unparseable date; never a pass.
 *
 * Evidence is whatever the data shows: a changed field. It is not proof that
 * a person looked at anything, and a cosmetic edit counts as a change.
 * Throws `ParityError` for bad options, an argument that is not a dataset,
 * or a size limit.
 */
export function auditReviewStamps(before: unknown, after: unknown, options: StampOptions): StampAudit {
  const o = readOptions(options, OPTION_NAMES, WHAT);
  const reviewedField = optString(o, 'reviewedField', WHAT);
  if (reviewedField === undefined) {
    throw new ParityError('bad-options', `${WHAT}: option "reviewedField" is required`);
  }
  const sourceFields = optNames(o, 'sourceFields', WHAT);
  if (sourceFields === undefined) {
    throw new ParityError('bad-options', `${WHAT}: option "sourceFields" is required (it may be an empty array)`);
  }
  const key = optString(o, 'key', WHAT) ?? 'id';
  const reviewerField = optString(o, 'reviewerField', WHAT);
  const expiryField = optString(o, 'expiryField', WHAT);
  const valueFields = optNames(o, 'valueFields', WHAT);
  const ignoreFields = optNames(o, 'ignoreFields', WHAT) ?? [];
  const allowEmpty = optBoolean(o, 'allowEmpty', WHAT) ?? false;
  const foldCase = optBoolean(o, 'foldCase', WHAT) ?? true;
  const foldInvisible = optBoolean(o, 'foldInvisible', WHAT) ?? true;
  const nowMs = readNow(o['now']);
  const thresholdRaw = o['bulkThreshold'];
  if (
    thresholdRaw !== undefined &&
    (typeof thresholdRaw !== 'number' || !Number.isInteger(thresholdRaw) || thresholdRaw < 0)
  ) {
    throw new ParityError('bad-options', `${WHAT}: option "bulkThreshold" must be an integer of zero or more`);
  }
  const bulkThreshold = (thresholdRaw) ?? DEFAULT_BULK_THRESHOLD;
  const ignoredNames = new Set(ignoreFields);
  const sourceNames = new Set(sourceFields);
  for (const name of [...sourceFields, ...(reviewerField === undefined ? [] : [reviewerField])]) {
    if (ignoredNames.has(name)) {
      throw new ParityError('bad-options', `${WHAT}: field "${name}" cannot be both evidence and ignored`);
    }
  }
  const budget = makeBudget(o['limits'], WHAT);

  let names: string[] | null = null;
  if (valueFields !== undefined) {
    // Ignored names are read too (and then left out) so a misspelled one can be reported.
    const set = new Set<string>([...valueFields, ...sourceFields, reviewedField, ...ignoreFields]);
    if (reviewerField !== undefined) set.add(reviewerField);
    if (expiryField !== undefined) set.add(expiryField);
    names = [...set];
  }
  const includeKey =
    key === reviewedField ||
    key === expiryField ||
    key === reviewerField ||
    sourceNames.has(key) ||
    (valueFields?.includes(key) ?? false);
  const cfg = { key, names, includeKey };
  const b = readDataset(before, 'before', cfg, budget);
  const a = readDataset(after, 'after', cfg, budget);
  const bi = indexEntries(b.entries);
  const ai = indexEntries(a.entries);

  const invalid = [...invalidOf('before', b), ...invalidOf('after', a)];
  if (!allowEmpty) {
    if (b.entries.length === 0) invalid.push(emptyDatasetInvalid('before'));
    if (a.entries.length === 0) invalid.push(emptyDatasetInvalid('after'));
  }
  const duplicateKeys = [...duplicatesOf('before', bi), ...duplicatesOf('after', ai)];
  const added: Key[] = ai.order.filter((id) => !bi.byId.has(id));
  const removed: Key[] = bi.order.filter((id) => !ai.byId.has(id));
  // Both sides have keyed records and every one is new or gone: nothing to compare.
  const noOverlap = bi.order.length > 0 && ai.order.length > 0 && added.length === ai.order.length;

  const stampOnly: StampOnly[] = [];
  const future: FutureStamp[] = [];
  const backward: BackwardStamp[] = [];
  const extendedDeadlines: ExtendedDeadline[] = [];
  const unknown: UnknownStamp[] = [];
  const groups = new Map<number, BulkBump>();
  let compared = 0;

  const markUnknown = (id: Key, side: 'before' | 'after', field: string, reason: UnknownReason, value: Snap | undefined): void => {
    const item: UnknownStamp = { id, side, field, reason };
    if (value !== undefined) item.value = plainValue(value);
    unknown.push(item);
  };

  const ignore = new Set<string>([key, reviewedField, ...ignoreFields]);
  if (expiryField !== undefined) ignore.add(expiryField);
  const evidenceSet = valueFields === undefined ? null : new Set<string>([...valueFields, ...sourceFields, ...(reviewerField === undefined ? [] : [reviewerField])]);

  for (const id of ai.order) {
    const al = ai.byId.get(id) as DatasetEntry[];
    if (al.length !== 1) continue;
    const af = (al[0] as DatasetEntry).fields;
    if (af === undefined) continue;
    const bl = bi.byId.get(id);
    const bf = bl !== undefined && bl.length === 1 ? (bl[0] as DatasetEntry).fields : undefined;

    // The stamp as it stands now.
    const afterValue = af.get(reviewedField);
    const pa = parseStamp(afterValue);
    if (!pa.ok) markUnknown(id, 'after', reviewedField, pa.reason, afterValue);
    else if (nowMs !== undefined && isFuture(pa, nowMs)) future.push({ id, value: stampText(afterValue) });

    // Every expiry value that is present must be a usable date, whether or not it moved.
    const expiryAfter = expiryField === undefined ? undefined : af.get(expiryField);
    const parsedExpiryAfter = expiryAfter === undefined ? undefined : parseStamp(expiryAfter);
    if (parsedExpiryAfter !== undefined && !parsedExpiryAfter.ok) {
      markUnknown(id, 'after', expiryField as string, parsedExpiryAfter.reason, expiryAfter);
    }

    if (bf === undefined) continue;
    compared += 1;

    // What changed besides the dates.
    let anyEvidence = false;
    let sourceChanged = false;
    const consider = new Set<string>();
    for (const f of bf.keys()) consider.add(f);
    for (const f of af.keys()) consider.add(f);
    for (const f of consider) {
      if (ignore.has(f)) continue;
      if (evidenceSet !== null && !evidenceSet.has(f)) continue;
      if (!fieldEqual(bf.get(f), af.get(f))) {
        anyEvidence = true;
        if (sourceNames.has(f)) sourceChanged = true;
      }
    }
    // Did the review date move?
    const beforeValue = bf.get(reviewedField);
    if (!fieldEqual(beforeValue, afterValue)) {
      const pb = parseStamp(beforeValue);
      if (!pb.ok) markUnknown(id, 'before', reviewedField, pb.reason, beforeValue);
      if (pa.ok && pb.ok) {
        if (pa.ms > pb.ms) {
          if (!anyEvidence) stampOnly.push({ id, from: stampText(beforeValue), to: stampText(afterValue) });
          const day = utcDay(pa.ms);
          let group = groups.get(day);
          if (group === undefined) {
            group = { summary: '', count: 0, withEvidence: 0, withoutEvidence: 0, date: formatDay(day), ids: [] };
            groups.set(day, group);
          }
          group.count += 1;
          if (anyEvidence) group.withEvidence += 1;
          group.ids.push(id);
        } else if (pa.ms < pb.ms) {
          backward.push({ id, from: stampText(beforeValue), to: stampText(afterValue) });
        }
      }
    }

    // Did the deadline move?
    if (expiryField !== undefined) {
      const eb = bf.get(expiryField);
      if (eb !== undefined && expiryAfter === undefined) {
        markUnknown(id, 'after', expiryField, 'expiry-removed', eb);
      } else if (eb !== undefined && expiryAfter !== undefined && !snapEqual(eb, expiryAfter, 0)) {
        const xb = parseStamp(eb);
        if (!xb.ok) markUnknown(id, 'before', expiryField, xb.reason, eb);
        if (xb.ok && parsedExpiryAfter?.ok === true && parsedExpiryAfter.ms > xb.ms && !sourceChanged) {
          extendedDeadlines.push({ id, from: stampText(eb), to: stampText(expiryAfter) });
        }
      }
    }
  }

  const bulkBump = [...groups.values()].filter((g) => g.count > bulkThreshold);
  for (const group of bulkBump) {
    group.withoutEvidence = group.count - group.withEvidence;
    group.summary = `${group.count} records moved to ${group.date}; ${group.withEvidence} of ${group.count} also changed a value, source or reviewer`;
  }
  const summaryCounts = new Map<string, UnknownSummary>();
  for (const item of unknown) {
    const id = `${item.field}\u0000${item.reason}`;
    const entry = summaryCounts.get(id);
    if (entry === undefined) summaryCounts.set(id, { field: item.field, reason: item.reason, count: 1 });
    else entry.count += 1;
  }
  const unknownSummary = [...summaryCounts.values()];
  const unknownFields = findUnknownFields(
    [b.entries, a.entries],
    [...new Set([reviewedField, ...sourceFields, ...(reviewerField === undefined ? [] : [reviewerField]), ...(expiryField === undefined ? [] : [expiryField]), ...(valueFields ?? []), ...ignoreFields])],
    key,
  );
  const suspectKeys = findSuspectKeys(
    [
      { side: 'before', keys: bi.order },
      { side: 'after', keys: ai.order },
    ],
    { foldCase, foldInvisible },
  );

  const flagged =
    stampOnly.length + bulkBump.length + future.length + backward.length + extendedDeadlines.length + duplicateKeys.length > 0;
  const notJudged = unknown.length + invalid.length + suspectKeys.length + unknownFields.length > 0 || noOverlap;
  const status: Status = flagged ? 'flagged' : notJudged ? 'unknown' : 'ok';
  return {
    ok: status === 'ok',
    status,
    compared,
    noOverlap,
    stampOnly,
    bulkBump,
    future,
    backward,
    extendedDeadlines,
    unknown,
    unknownSummary,
    unknownFields,
    added,
    removed,
    duplicateKeys,
    suspectKeys,
    invalid,
  };
}
