// Imports the package by its name from an installed tarball (not a relative
// path into src/ or dist/) and exercises the real API the way a consumer
// would, asserting real outputs rather than just "it exports something."
import assert from 'node:assert/strict';
import {
  ParityError,
  auditReviewStamps,
  compareMirror,
  findHandTypedConstants,
} from 'parity-kit';

// compareMirror: the drift the kit exists to catch. Same review date, different value.
const canonical = [{ id: 'chase-ur', baselineCpp: 1.25, reviewedOn: '2026-06-08' }];
const extension = [{ id: 'chase-ur', baselineCpp: 1.0, reviewedOn: '2026-06-08' }];
const drift = compareMirror(canonical, extension, { reviewedField: 'reviewedOn' });
assert.equal(drift.ok, false);
assert.equal(drift.status, 'flagged');
assert.deepEqual(drift.changed, [
  { id: 'chase-ur', field: 'baselineCpp', change: 'different', canonical: 1.25, mirror: 1 },
]);
assert.deepEqual(drift.stampHidesDrift, [
  { id: 'chase-ur', reviewedValue: '2026-06-08', fields: ['baselineCpp'] },
]);

// An honest mirror passes, in any record order and with the keys in any order.
const honest = compareMirror(
  [{ id: 'a', v: 1 }, { id: 'b', v: 2 }],
  [{ v: 2, id: 'b' }, { v: 1, id: 'a' }],
);
assert.equal(honest.ok, true);
assert.equal(honest.compared, 2);

// Missing, extra, and a look-alike key are reported, never merged.
const keys = compareMirror([{ id: 'café' }, { id: 'x' }], [{ id: 'café' }, { id: 'x' }]);
assert.deepEqual(keys.missing, ['café']);
assert.deepEqual(keys.extra, ['café']);
assert.equal(keys.suspectKeys.length, 1);

// An unreadable record is reported as invalid, never as a pass.
const unreadable = compareMirror([{ id: 'a', get v() { throw new Error('boom'); } }], [{ id: 'a', v: 1 }]);
assert.equal(unreadable.ok, false);
assert.equal(unreadable.invalid[0]?.reason, 'unreadable');

// A bad option is a documented error, not a silent no-op.
assert.throws(() => compareMirror([], [], { ignoreField: ['x'] }), ParityError);

// findHandTypedConstants: token boundaries and positions.
const hits = findHandTypedConstants('earns 1.25 cents\nnot 11.256 or v1.25 or 1.25.3\nbut $1.250 yes', [
  { id: 'cpp', value: 1.25 },
]);
assert.deepEqual(hits.map((h) => [h.id, h.text, h.line, h.column]), [
  ['cpp', '1.25', 1, 7],
  ['cpp', '1.250', 3, 6],
]);

// auditReviewStamps: a stamp that moved with nothing else changing.
const before = Array.from({ length: 12 }, (_, i) => ({ id: `card-${i}`, apr: 20, source: 's', reviewedOn: '2026-06-08' }));
const after = before.map((r) => ({ ...r, reviewedOn: '2026-10-10' }));
const stamps = auditReviewStamps(before, after, { reviewedField: 'reviewedOn', sourceFields: ['source'] });
assert.equal(stamps.status, 'flagged');
assert.equal(stamps.stampOnly.length, 12);
assert.equal(stamps.bulkBump[0]?.count, 12);

// A real recheck passes; a future date needs `now`; nothing reads the clock otherwise.
const recheck = auditReviewStamps(
  [{ id: 'a', apr: 20, source: 's', reviewedOn: '2026-06-08' }],
  [{ id: 'a', apr: 21, source: 's', reviewedOn: '2026-10-10' }],
  { reviewedField: 'reviewedOn', sourceFields: ['source'], now: '2026-10-10T12:00:00Z' },
);
assert.equal(recheck.ok, true);
const future = auditReviewStamps(
  [{ id: 'a', apr: 20, source: 's', reviewedOn: '2026-06-08' }],
  [{ id: 'a', apr: 21, source: 's', reviewedOn: '2027-01-01' }],
  { reviewedField: 'reviewedOn', sourceFields: ['source'], now: new Date('2026-10-10T12:00:00Z') },
);
assert.deepEqual(future.future, [{ id: 'a', value: '2027-01-01' }]);

// A date that cannot be judged is `unknown`, not a pass.
const unknown = auditReviewStamps(
  [{ id: 'a', source: 's', reviewedOn: '2026-06-08' }],
  [{ id: 'a', source: 's', reviewedOn: 'last Tuesday' }],
  { reviewedField: 'reviewedOn', sourceFields: ['source'] },
);
assert.equal(unknown.ok, false);
assert.equal(unknown.status, 'unknown');
assert.equal(unknown.unknown[0]?.reason, 'unparseable-date');

console.log('parity-kit consumer probe: all assertions passed');
