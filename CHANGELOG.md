# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
