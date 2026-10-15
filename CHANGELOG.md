# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-15

First release. MIT license. Zero runtime dependencies, ESM only, Node 20 or newer.

### Added

- `compareMirror(canonical, mirror, options?)` compares a canonical record set to a mirror
  (arrays of records, or objects keyed by id). It reports `missing`, `extra`, `changed`
  (field level: `different`, `missing-in-mirror`, `extra-in-mirror`), `stampHidesDrift` (same
  review date, different values), `duplicateKeys`, `suspectKeys` (look-alike keys, never merged),
  `unknownFields` (a field name that matches no record), `noFieldsCompared` (records matched but
  `ignoreFields` removed every field they carry, so nothing was checked) and `invalid` (records
  that could not be read). Comparison is exact by default. Options: `key`, `fields`, `ignoreFields`,
  `reviewedField`, `numberTolerance`, `allowEmpty`, `foldCase`, `foldInvisible` and `limits`.
  `numberTolerance` adds a binary-rounding allowance capped at a thousandth of the tolerance,
  so a real difference is still different at any magnitude. `foldInvisible: false` keeps keys
  that differ only by an invisible character (emoji sequences, a control-character separator)
  as different keys; the default folds them. `suspectKeys[].skeleton` is clipped to 40 units,
  so it is display text and two groups can share one; the README waiver recipe names a reviewed
  group by its keys.
  The key column never counts as a compared field.
- `findHandTypedConstants(text, registry)` finds hand-typed copies of registered constants,
  with line, column and index. Numbers match by value at token boundaries (`1.25` is not found
  inside `11.256`, `1.25.3`, `v1.25` or `08`), including `1,250` and `1_000_000` style
  separators, ranges such as `1..5`, and numbers next to unspaced scripts such as Chinese,
  Japanese, Korean and Thai. A printf or format-spec precision (`%.1f`, `{:.2f}`) is not read as a
  leading-dot number, and a thousands group needs a leading group of one to three digits, so
  `[1000,250]` holds two numbers. Literal forms use an Aho-Corasick automaton, so scanning is linear
  in the length of the text.
- `auditReviewStamps(before, after, options)` compares two snapshots and reports `stampOnly`,
  `bulkBump` (grouped by UTC day, default threshold 10), `future` (only when `now` is passed),
  `backward`, `extendedDeadlines`, `unknown` (missing, non-string, zoneless or unparseable
  dates), `noOverlap` and `unknownFields`. Dates are strict ISO 8601; a zoneless timestamp is
  reported, not guessed. A changed value, source or reviewer counts as evidence of a recheck.
  `now` must fall in the years 0001 to 9999, so epoch microseconds or nanoseconds throw
  instead of switching the future check off.
- Every result has `ok` and a `status` of `flagged` (positive evidence), `unknown` (something
  could not be checked) or `ok`. `ok` is true only when nothing at all is reported. A check
  that compared nothing is never `ok`.
- `ParityError` with codes `bad-options`, `bad-input`, `unreadable-input`, `too-large` and
  `bad-registry` for problems with the whole call. A misspelled option or registry key throws
  instead of quietly turning a check off, and so does an argument past the documented ones.
- Hostile-input handling: Proxies, throwing and flip-flopping getters (each read once),
  inherited `toJSON`, null-prototype records, cross-realm Dates and plain objects, 100,000-level
  nesting, shared-structure blow-ups, 100,000-record arrays and a polluted `Object.prototype`.
  Work is bounded by `maxRecords`, `maxNodes`, `maxDepth` and `maxKeyLength`; a key is
  charged by the size of its Unicode decomposition, not only its length.
- `METHOD.md`: every verdict and default with its reason and how to change it, each heuristic
  with its measured false-flag and false-pass rate, the limits, and non-reliance language.
- A labeled benchmark in the repository (`npm run bench`): locale files, an entity table, an
  advisory database with its OSV.dev copy, review-stamp histories, a fresh holdout labeled
  before the kit ran on it, and seeded edits. The pinned run has 0 false passes in 121,642
  items that should flag and 0 false flags in 3,287,820 items that should pass. `npm run bench`
  re-runs the vendored tier (45,205 and 3,156,270); the two fetched corpora need
  `node bench/fetch/fetch.mjs <dir>` and `--tier all`. The README states the corpus,
  denominators and limits.
- A cross-check against `deep-diff` and `microdiff` and a page of twelve runnable cases showing
  what a generic diff cannot answer, both in the repository.

### Breaking changes

None. This is the first release.
