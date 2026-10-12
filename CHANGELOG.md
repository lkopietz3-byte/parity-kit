# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - unreleased

First version. It is private and unlicensed and has not been published.

### Breaking changes

None. This is the first version, so there is nothing to migrate from.

### Added

- `compareMirror(canonical, mirror, options?)`: compares a canonical record set to a
  mirror (arrays of records or id-keyed objects). Reports `missing`, `extra`, `changed`
  (field level, with `different`, `missing-in-mirror` and `extra-in-mirror`),
  `stampHidesDrift` (same review date, different values), `duplicateKeys`, `suspectKeys`
  (look-alike keys, never merged) and `invalid` (records that could not be read).
  Comparison is exact by default; `numberTolerance` is opt-in. `ok` is true only when
  nothing is reported; `status` is `flagged`, `unknown` or `ok`.
- `findHandTypedConstants(text, registry)`: finds hand-typed copies of registered
  constants with line, column and index. Numbers match by value at token boundaries
  (`1.25` is not found inside `11.256`, `1.25.3`, `v1.25` or `08`); literal forms use an
  Aho-Corasick automaton, so scanning is linear in the text.
- `auditReviewStamps(before, after, options)`: compares two snapshots and reports
  `stampOnly`, `bulkBump` (grouped by UTC day), `future` (only when `now` is supplied),
  `backward`, `extendedDeadlines` and `unknown` (missing, non-string, zoneless or
  unparseable dates). Strict ISO 8601 parsing; zoneless timestamps are reported, not guessed.
- `ParityError` with codes `bad-options`, `bad-input`, `unreadable-input`, `too-large`
  and `bad-registry` for problems with the whole call.
- Hostile-input handling: Proxies (including reordered `ownKeys` and throwing traps),
  throwing and flip-flopping getters (each read once), inherited `toJSON`, null-prototype
  records, cross-realm Dates and plain objects, 100,000-level nesting, shared-structure
  blow-ups and 100,000-record arrays. Size limits: `maxRecords`, `maxNodes`, `maxDepth`.

### Fixed (review round 1)

- `findHandTypedConstants`: literal forms and string values now share the number lexer's
  boundaries. `1.25` is found in `1.25,0.5`; `250` is not found in `1,250`; `8` is not found
  in `1e+8`. Comma tokenization is documented and pinned.
- `findHandTypedConstants`: a non-ASCII decimal digit next to a number (`1.25６`) is part of a
  longer number and is not a hit.
- Option objects and id-keyed datasets are read from the property descriptor captured while
  enumerating, so a Proxy cannot change a value after it was observed.
- Field-name lists are validated in linear time (they were quadratic).
- A record whose prototype lookup throws, or that is a class instance, keeps its readable key,
  so it is reported `invalid` and is never reported as `missing`.
- `maxDepth` is inclusive: a container directly in a field is level 1.
- A revoked or otherwise hostile options object throws `ParityError('bad-options')`.

### Fixed (review round 1, batch 2)

- Values are no longer classified through `Object.prototype.toString`, so an inherited
  `Symbol.toStringTag` getter (or a Proxy `get` trap) cannot run and change a record before
  it is read. Built-ins are recognized by internal-slot probes (`Date`, `Map`, `Set`, `RegExp`,
  `ArrayBuffer`, typed arrays, `Promise`, `WeakMap`, boxed primitives, `Error`), so a built-in
  whose prototype was replaced with `null` or `Object.prototype` is an unsupported value, and a
  null-prototype Date is a Date.
- `auditReviewStamps` now validates every present expiry value in `after`, moved or not; an
  unchanged garbage, numeric or zoneless expiry is `unknown`.
- Duplicate forms are one pattern each, so repeating a form no longer multiplies candidate
  storage (a thousand copies of one form used about 200 MiB; now a few hundred KiB).
- Overlap suppression in `findHandTypedConstants` is limited to a number hit against a literal
  hit of the same constant. Two overlapping literal hits are both reported.
- A key field named in `fields`, or used as `reviewedField`, is now read and compared.
- Every probe for a named field counts against `maxNodes`, present or absent, so a long `fields`
  list ends in `too-large` instead of an unbounded loop.
- Our own errors are recognized by identity, and thrown values are never inspected or coerced:
  a Proxy thrown from a getter now marks only that record `invalid`.

### Fixed (review round 2)

- Classifying an object with no selected fields no longer clones it, so an excluded getter is
  not run and the work limit cannot be bypassed by a large built-in. Classification uses
  bounded internal-slot probes only.
- The record key is looked up once on the default path (it was read again during the field
  scan), so a Proxy cannot change a field between two reads of the key.
- A Promise whose `then` probe would fail after recognition (a null, string or accessor
  `constructor`, or a throwing `Symbol.species`) is `unsupported-value`, never plain data.
  A probe that cannot be completed safely fails closed.

### Fixed (review round 3)

- Removed the `Error.stackTraceLimit` mutation; the library no longer changes any global.
- The built-in probe runs only for an object with no own enumerable property. A populated
  object is plain data, and a hidden property no longer makes it unsupported.
- Classification reuses the descriptors read during enumeration, including `constructor` and the
  key, so nothing is read twice.
- `Promise.prototype.then` is only called when it provably cannot run caller code (no own
  `constructor` or an own undefined one, and a `null` or untouched `Object.prototype` prototype).
  An empty object on any other prototype, including one from another realm, is `unsupported-value`.
- Without `Error.isError` (Node before 24), an Error is recognized with a conservative
  `Object.prototype.toString` fallback, or the object fails closed.
- String keys are bounded before Unicode normalization: `limits.maxKeyLength` (default 4096) and a
  32-mark combining run limit; refused keys make the record `invalid` (`key-too-long`,
  `key-unnormalizable`) and key lengths count against `maxNodes`.
- Changed rows: a 1 MB key is now refused instead of analyzed; a boxed `String` with a replaced
  prototype (enumerable index properties) reads as plain data, a documented gap.

### Fixed (review round 4)

- A populated record with no selected fields is no longer given the empty-object built-in probe:
  emptiness is decided from the record's own enumerable keys (descriptors only), not from the
  selection. A selected field that exists only in the mirror is now `extra-in-mirror`.
- An oversized key is refused before any trim or whitespace scan, on the array and id-keyed
  paths, so its cost no longer grows with its length.

### Added and fixed (field-trial round)

- `compareMirror` and `auditReviewStamps` report `unknownFields`: a selected or configured name
  (`fields`, `reviewedField`, `sourceFields`, `reviewerField`, `expiryField`, `valueFields`) that
  appears in no readable record. The result is `unknown`, never `ok`, so a misspelled column can
  no longer turn a gate permanently green.
- `auditReviewStamps` adds `unknownSummary` (counts per field and reason) and each `bulkBump`
  entry now leads with `summary`, `count`, `withEvidence` and `withoutEvidence`.
- README: a recipe for files with one file-level review date, the behavior for boolean or missing
  expiry values and for records with no stamp, and how to read a bulk bump.
- Changed rows: three existing rows that selected field names present in no record
  (`fields: ['rate']`, twenty `f0..f19` names) now report those names as `unknownFields`
  instead of passing.

### Changed before release (audit round 1)

These change a verdict or a result shape before the first release, so nothing is migrated.
Each has a verdict-table row named for its finding id.

- `numberTolerance` (PF-6): two finite numbers are equal when
  `|a - b| <= tolerance + 8 * Number.EPSILON * max(|a|, |b|, tolerance)`. A decimal difference
  that is exactly the tolerance (`1.25` vs `1.15` at `0.1`) is now equal; it was called
  different because of binary rounding. A tolerance of `0` is still exact. On a 29,997-item
  boundary corpus (cents, tenths, rounded mirrors) false fails went from several thousand to 0
  and false passes stayed at 0.
- `findHandTypedConstants` registry (hostile-F6, DR-3): an entry key other than `id`, `value`
  and `forms` now throws `ParityError('bad-registry')` and names the key, so `form` instead of
  `forms` can no longer silently drop the forms list. An empty registry now throws
  `bad-registry` instead of returning `[]`, so a registry file that failed to load cannot pass
  as "no hand-typed copies". Empty text with a real registry still returns `[]`. One existing
  row changed: `findHandTypedConstants('1.25', [])` used to be `[]` and now throws.
- `auditReviewStamps` adds `noOverlap` (PF-4, hostile-F1). When both snapshots have keyed records
  and not one key is shared, the status is `unknown` and `ok` is false. Before, renaming every
  id (a NUL or `-v2` suffix, a Greek letter, a tag character) gave `compared: 0` and `ok: true`.
  The same ids with the same bump are still `flagged`, and two empty snapshots with `allowEmpty`
  are still `ok`. The result type gains one boolean field. The README gate recipe for evidenced
  bulk bumps now also requires `!a.noOverlap`.
- `compareMirror` refuses an empty effective field selection (PF-2, hostile-F2). `fields: []`
  and a `fields` list that `ignoreFields` cancels entirely throw `ParityError('bad-options')`.
  With no `fields`, when `ignoreFields` removes every field of every matched record, the result
  is `unknown` with `noFieldsCompared: true` (this depends on the data, so it is reported, not
  thrown; records that carry only an id still pass as a presence check). Before, both gave
  `ok: true` on data that really differed. The result type gains one boolean field.
- `ignoreFields` names are checked (PF-1). In `auditReviewStamps` a name that matches no record
  lands in `unknownFields` and the audit is `unknown`; before, a typo such as `updatedat` let an
  auto-touched `updatedAt` count as evidence and an unearned bump passed as `ok`. The README line
  saying such a typo "fails safe" was wrong for the audit and is removed. `compareMirror` reports
  the same names in `unknownFields` for consistency (one existing row changed: an ignored name
  that matches nothing used to be `ok` and is now `unknown`). Names in `ignoreFields` are read
  when `fields` or `valueFields` narrows the read, so they can be checked.
