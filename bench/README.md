# Benchmark

This directory holds labeled data and a runner that scores parity-kit against it, so that a claim like "the kit never passed a copy that had drifted" is something anyone can re-run. It is not part of the npm package (`files` in `package.json` leaves it out).

```
npm run bench
```

builds the kit, runs it over every vendored data set and the fresh holdout, prints a table, and fails if any count differs from `expected.json`. The numbers, with denominators and intervals, are in [RESULTS.md](RESULTS.md).

## What is measured

Each item is one thing the kit gives a verdict on: a translation key in a locale file, an entity name in a table, a field of an advisory, a pair of prices, a review stamp that moved, a digit run in a paragraph. An independent label says what the verdict should be. The runner compares.

- **False pass.** The label names a problem (a key missing from the mirror, a value that drifted, a stamp that moved with no evidence) and the kit reported nothing about the item. Rate = false passes / items whose label names a problem.
- **False flag.** The label says the copies agree (or the stamp was earned) and the kit reported a problem. Rate = false flags / items whose label says they agree.
- **Abstain.** The kit said it could not tell (`unknown`). It is counted apart: it is neither a pass nor a flag.
- **Wrong class.** The label names one problem and the kit names another.

Every rate has its denominator beside it and a 95% Wilson interval. With zero events in n items, the interval's upper end is about 3.8 / n.

The kit's verdict for an item is read from its result: `missing`, `extra`, `changed` (drift), `duplicateKeys` and `invalid` (unknown), for the stamp audit the listed `stampOnly`, `backward`, `future`, `bulkBump` and `unknown` entries, and for the constant scanner the hits. A mirror comparison that is `unknown` for the whole file because of look-alike keys still gives a verdict for every key, and those keys are counted as run facts (`itemsInLookalikeGroups`).

## The data

| Family | Items are | Source | Labels from |
| --- | --- | --- | --- |
| `compareMirror/i18n-excalidraw`, `i18n-jitsi` | keys of 56 and 59 locale files against the source-language file | MIT and Apache-2.0 repositories | `build/i18n.py` (python) |
| `compareMirror/entities-real/*` | entity names of six published copies against the WHATWG table | WHATWG, Python stdlib, npm | `build/oracle/oracle_entities.py` |
| `compareMirror/entities-synthetic/*` | the same, with seeded edits (value swaps, zero-width suffixes, NFD forms, deletions, additions, Cyrillic homoglyph renames) | derived | by construction and `oracle_entities.py` |
| `compareMirror/pypa-vs-osv/*` | fields of 200 advisories against the OSV.dev copy | CC-BY-4.0 | `build/oracle/oracle_osv.py` |
| `compareMirror/numberTolerance/*` | price pairs on cent and tenth grids | generated | integer arithmetic on whole units |
| `findHandTypedConstants/advisory-texts` | digit runs equal to a registered number in 400 advisory texts | CC-BY-4.0 | `build/oracle/oracle_consts.py` plus a reading of each disputed context |
| `auditReviewStamps/pypa-history/*` | record pairs across 75 daily and horizon snapshot pairs of the advisory database | CC-BY-4.0 | `build/oracle/oracle_s2.py` |
| `auditReviewStamps/pypa-injected/*` | real records with a seeded stamp edit | derived | `build/oracle/inj_plan.py` |
| `auditReviewStamps/stamp-edge-cases/*` | 40 stamp spellings at boundaries | hand-chosen | `build/oracle/edge_cases.py` |
| `auditReviewStamps/pypa-option-variants/*` | the six horizon pairs again with `valueFields` or `ignoreFields` | CC-BY-4.0 | `build/oracle/opts_truth.py` |
| `holdout/*` | status phrases, SPDX licenses, Gitea strings: 45,491 items | see below | `holdout/label.py` |
| `fetched/*` | keys of 105 Mastodon and 66 Nextcloud locale pairs | AGPL-3.0, fetched | the runner (see below) |

Where each source came from, at which commit, and under which license is in [SOURCES.json](SOURCES.json). What is stored is derived data: keys, placeholder and tag names, flags, and digests of values. A record of the advisory database keeps its `id` and `modified` stamp as written and a 12-digit digest of every other field; the kit compares values by equality only, so a digest changes its answer exactly when the value would have (`build/derive.mjs` checks this on the way in).

The labeling scripts are in `build/`; they are the record of how the labels were made, not part of the run. The python oracles were written separately from the kit, from the README's rules, and never import it.

## The fresh holdout

`holdout/` is 45,491 items from three families that were never used while the kit was being developed: the IANA HTTP status registry against five published copies, the SPDX license list against two npm packages, and Gitea's English strings against twelve translations. It was labeled, and the prediction written down, in a commit that precedes any code that runs the kit on it ([PREREGISTRATION.md](holdout/PREREGISTRATION.md)). Everything else in the benchmark is data the kit's authors have seen: some of its rules (the tolerance boundary, the range and separator handling in the constant scanner) were changed because of what this corpus showed, so those classes are no longer a test of a rule that was written blind. The holdout is.

## Fetched sources

Two sources are AGPL-3.0 and are not copied here. To run them:

```
node bench/fetch/fetch.mjs ~/parity-bench-cache
node bench/run.mjs --tier all --cache ~/parity-bench-cache --check
```

`fetch.mjs` downloads each file at a pinned commit and refuses any file whose SHA-256 is not the one in `fetch/manifest.json`. The labels for these families are a plain Map and Set comparison written in `lib/fetched.mjs`, over the same extracted facts the kit is given, so they are a weaker check than the python oracles: they test the comparison and not the extraction.

## What this does not show

- **Items are not independent.** The keys of one locale file share a file, an author and a style. The intervals treat each item as an independent draw, so they are narrower than the uncertainty. Read "0 of 70,230" as "no failure in 70,230 correlated items", not as a probability.
- **Labels can be wrong.** An oracle is a second implementation of a rule, written by the same people, from the same README. A rule both implementations misread would pass silently. The holdout labels were checked by hand on a seeded sample of 69 items; the others were not.
- **Thin classes.** The real advisory history has one `stampOnly` event and no `backward` or unreadable stamp; those classes are exercised by injected edits and 40 hand-chosen stamps, which are the authors' idea of hard. `numberTolerance`, `reviewerField` and `expiryField` have no real-data coverage.
- **It scores equality, not meaning.** A translation that swaps `%s` for `%[1]s` prints the same, and the kit (and the label) call it drift.
- **No comparison with other tools.** For that, see [docs/differential.md](../docs/differential.md) and [docs/what-a-diff-cannot-answer.md](../docs/what-a-diff-cannot-answer.md).

## Layout

- `run.mjs`: the entry point. `--tier vendored|all`, `--cache <dir>`, `--json <file>`, `--check`, `--update-expected`, `--quiet`.
- `expected.json`: every confusion matrix, pinned. `RESULTS.md` is rendered from it.
- `lib/`: `report.mjs` (matrices, rates, intervals), `vendored.mjs` and `fetched.mjs` (one function per family), `suite.mjs` (what `npm test` and `npm run bench` run), `results.mjs`.
- `data/`, `holdout/data/`: the vendored data, with SHA-256 in `data/manifest.json` (checked by `npm test`).
- `build/`: how the data and labels were produced. `derive.mjs` assembles `data/`; `manifest.mjs` writes the manifest.
- `doc-cases.mjs`: rewrites the printed results in `docs/what-a-diff-cannot-answer.md`.

`npm test` runs the quick subset of this suite against the source (about 180,000 verdicts, about six seconds of CPU) and compares it with `expected.json`.

## Updating after a deliberate change

If a kit change legitimately moves a count, run `npm run bench -- --update-expected`, read the diff of `expected.json` and `RESULTS.md`, and say in the commit which items moved and why. A count that moves in the wrong direction is a bug, not a baseline to refresh.
