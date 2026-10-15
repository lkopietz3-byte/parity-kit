# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-14

First release. MIT license. Zero runtime dependencies, ESM only, Node 20 or newer.

### Added

- `compareMirror(canonical, mirror, options?)` compares a canonical record set to a mirror
  (arrays of records, or objects keyed by id). It reports `missing`, `extra`, `changed`
  (field level: `different`, `missing-in-mirror`, `extra-in-mirror`), `stampHidesDrift` (same
  review date, different values), `duplicateKeys`, `suspectKeys` (look-alike keys, never merged),
  `unknownFields` (a field name that matches no record) and `invalid` (records that could not
  be read). Comparison is exact by default. Options: `key`, `fields`, `ignoreFields`,
  `reviewedField`, `numberTolerance`, `allowEmpty`, `foldCase` and `limits`.
- `findHandTypedConstants(text, registry)` finds hand-typed copies of registered constants,
  with line, column and index. Numbers match by value at token boundaries (`1.25` is not found
  inside `11.256`, `1.25.3`, `v1.25` or `08`), including `1,250` and `1_000_000` style
  separators, ranges such as `1..5`, and numbers next to unspaced scripts such as Chinese,
  Japanese, Korean and Thai. Literal forms use an Aho-Corasick automaton, so scanning is linear
  in the length of the text.
- `auditReviewStamps(before, after, options)` compares two snapshots and reports `stampOnly`,
  `bulkBump` (grouped by UTC day, default threshold 10), `future` (only when `now` is passed),
  `backward`, `extendedDeadlines`, `unknown` (missing, non-string, zoneless or unparseable
  dates), `noOverlap` and `unknownFields`. Dates are strict ISO 8601; a zoneless timestamp is
  reported, not guessed. A changed value, source or reviewer counts as evidence of a recheck.
- Every result has `ok` and a `status` of `flagged` (positive evidence), `unknown` (something
  could not be checked) or `ok`. `ok` is true only when nothing at all is reported. A check
  that compared nothing is never `ok`.
- `ParityError` with codes `bad-options`, `bad-input`, `unreadable-input`, `too-large` and
  `bad-registry` for problems with the whole call. A misspelled option or registry key throws
  instead of quietly turning a check off.
- Hostile-input handling: Proxies, throwing and flip-flopping getters (each read once),
  inherited `toJSON`, null-prototype records, cross-realm Dates and plain objects, 100,000-level
  nesting, shared-structure blow-ups and 100,000-record arrays. Work is bounded by
  `maxRecords`, `maxNodes`, `maxDepth` and `maxKeyLength`.
- `METHOD.md`: every verdict and default with its reason and how to change it, each heuristic
  with its measured false-flag and false-pass rate, the limits, and non-reliance language.
- A labeled benchmark in the repository (`npm run bench`): locale files, an entity table, an
  advisory database with its OSV.dev copy, review-stamp histories, a fresh holdout labeled
  before the kit ran on it, and seeded edits. The pinned run has 0 false passes in 121,642
  items that should flag and 0 false flags in 3,287,820 items that should pass. The README
  states the corpus, denominators and limits.
- A cross-check against `deep-diff` and `microdiff` and a page of twelve runnable cases showing
  what a generic diff cannot answer, both in the repository.

### Breaking changes

None. This is the first release.
