# Benchmark results

Generated from `bench/expected.json` by `node bench/run.mjs --update-expected`; do not edit by hand. `npm run bench` fails if a run differs from the pinned counts. How to read the columns is in [README.md](README.md).

## Totals

| Scope | Items that should flag | False pass | Items that should pass | False flag | Abstain |
| --- | ---: | ---: | ---: | ---: | ---: |
| Reproduced offline (everything but the fetched sources) | 45,205 | 0 (0.000%) | 3,156,270 | 0 (0.000%) | 0 |
| All, with the fetched sources | 121,642 | 0 (0.000%) | 3,287,820 | 0 (0.000%) | 0 |

The class rows below overlap (the same stamp pair is scored once per flag, the same table once per option set), so these totals count verdicts, not distinct items. Abstain counts items the kit called `unknown`; a whole file that comes back `unknown` because of look-alike keys still gives a verdict for every key, and is listed in that class's run facts (`resultStatus`, `itemsInLookalikeGroups`).

## Mirror comparison (`compareMirror`), real sources

| Class | Items that should flag | False pass | Items that should pass | False flag | Abstain |
| --- | ---: | ---: | ---: | ---: | ---: |
| `compareMirror/entities-real/default` | 424 | 0 of 424 (0.000%) (95% CI 0.000 to 0.898%) | 12,962 | 0 of 12,962 (0.000%) (95% CI 0.000 to 0.030%) | 0 |
| `compareMirror/entities-real/foldCase-false` | 424 | 0 of 424 (0.000%) (95% CI 0.000 to 0.898%) | 12,962 | 0 of 12,962 (0.000%) (95% CI 0.000 to 0.030%) | 0 |
| `compareMirror/i18n-excalidraw` | 2,636 | 0 of 2,636 (0.000%) (95% CI 0.000 to 0.146%) | 33,148 | 0 of 33,148 (0.000%) (95% CI 0.000 to 0.012%) | 0 |
| `compareMirror/i18n-jitsi` | 24,524 | 0 of 24,524 (0.000%) (95% CI 0.000 to 0.016%) | 70,230 | 0 of 70,230 (0.000%) (95% CI 0.000 to 0.005%) | 0 |
| `compareMirror/pypa-vs-osv/fields` | 675 | 0 of 675 (0.000%) (95% CI 0.000 to 0.566%) | 951 | 0 of 951 (0.000%) (95% CI 0.000 to 0.402%) | 0 |
| `compareMirror/pypa-vs-osv/stampHidesDrift` | 15 | 0 of 15 (0.000%) (95% CI 0.000 to 20.389%) | 185 | 0 of 185 (0.000%) (95% CI 0.000 to 2.034%) | 0 |

### `compareMirror/entities-real/default`

WHATWG entity table against six published copies (stdlib and npm packages), per entity name. Denominator: entity names in the union of both tables, summed over the six copies.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| match | 12,962 | 12,962 |  | 0 | 0 |  |
| missing | 424 | 424 | 0 |  | 0 | 0 |

Run facts: itemsInLookalikeGroups: 4746; resultStatus: {"flagged":4,"unknown":2}.

### `compareMirror/entities-real/foldCase-false`

WHATWG entity table against six published copies (stdlib and npm packages), per entity name. Denominator: entity names in the union of both tables, summed over the six copies.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| match | 12,962 | 12,962 |  | 0 | 0 |  |
| missing | 424 | 424 | 0 |  | 0 | 0 |

Run facts: itemsInLookalikeGroups: 0; resultStatus: {"flagged":4,"ok":2}.

### `compareMirror/i18n-excalidraw`

excalidraw: every key of every locale file against the source-language file, fields ph, tags, urls. Denominator: keys in the union of both files, summed over locale files.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| drift | 1,236 | 1,236 | 0 |  | 0 | 0 |
| match | 33,148 | 33,148 |  | 0 | 0 |  |
| missing | 1,400 | 1,400 | 0 |  | 0 | 0 |

Run facts: itemsInLookalikeGroups: 0; locales: 56; resultStatus: {"flagged":56}.

### `compareMirror/i18n-jitsi`

jitsi: every key of every locale file against the source-language file, fields ph, tags, urls. Denominator: keys in the union of both files, summed over locale files.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| drift | 128 | 128 | 0 |  | 0 | 0 |
| match | 70,230 | 70,230 |  | 0 | 0 |  |
| missing | 24,396 | 24,396 | 0 |  | 0 | 0 |

Run facts: itemsInLookalikeGroups: 0; locales: 59; resultStatus: {"flagged":59}.

### `compareMirror/pypa-vs-osv/fields`

one advisory in the pypa database against the same advisory served by OSV.dev, per field (fields other than id and modified are digests of the values). Denominator: fields in the union of both copies of an advisory, summed over 200 advisories.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| different | 468 | 468 | 0 |  | 0 | 0 |
| extra-in-mirror | 200 | 200 | 0 |  | 0 | 0 |
| match | 951 | 951 |  | 0 | 0 |  |
| missing-in-mirror | 7 | 7 | 0 |  | 0 | 0 |

### `compareMirror/pypa-vs-osv/stampHidesDrift`

advisories whose `modified` stamp is the same instant in both copies while another field differs. Denominator: 200 advisories.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| match | 185 | 185 |  | 0 | 0 |  |
| stampHidesDrift | 15 | 15 | 0 |  | 0 | 0 |

## Mirror comparison, seeded edits and grids

| Class | Items that should flag | False pass | Items that should pass | False flag | Abstain |
| --- | ---: | ---: | ---: | ---: | ---: |
| `compareMirror/entities-synthetic/default` | 335 | 0 of 335 (0.000%) (95% CI 0.000 to 1.134%) | 1,976 | 0 of 1,976 (0.000%) (95% CI 0.000 to 0.194%) | 0 |
| `compareMirror/entities-synthetic/foldCase-false` | 335 | 0 of 335 (0.000%) (95% CI 0.000 to 1.134%) | 1,976 | 0 of 1,976 (0.000%) (95% CI 0.000 to 0.194%) | 0 |
| `compareMirror/numberTolerance/cents-tol-0.01` | 3,333 | 0 of 3,333 (0.000%) (95% CI 0.000 to 0.115%) | 6,666 | 0 of 6,666 (0.000%) (95% CI 0.000 to 0.058%) | 0 |
| `compareMirror/numberTolerance/cents-tol-0.01/at-the-boundary` | 0 | 0 of 0 (n/a) | 3,333 | 0 of 3,333 (0.000%) (95% CI 0.000 to 0.115%) | 0 |
| `compareMirror/numberTolerance/cents-tol-0.02` | 0 | 0 of 0 (n/a) | 9,999 | 0 of 9,999 (0.000%) (95% CI 0.000 to 0.038%) | 0 |
| `compareMirror/numberTolerance/cents-tol-0.02/at-the-boundary` | 0 | 0 of 0 (n/a) | 3,333 | 0 of 3,333 (0.000%) (95% CI 0.000 to 0.115%) | 0 |
| `compareMirror/numberTolerance/tenths-tol-0.1` | 3,333 | 0 of 3,333 (0.000%) (95% CI 0.000 to 0.115%) | 6,666 | 0 of 6,666 (0.000%) (95% CI 0.000 to 0.058%) | 0 |
| `compareMirror/numberTolerance/tenths-tol-0.1/at-the-boundary` | 0 | 0 of 0 (n/a) | 3,333 | 0 of 3,333 (0.000%) (95% CI 0.000 to 0.115%) | 0 |

### `compareMirror/entities-synthetic/default`

a real copy with seeded edits (value swaps, zero-width and trailing-space suffixes, NFD forms, deletions, additions, Cyrillic homoglyph renames); labels by construction. Denominator: entity names in the union of both tables.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| drift | 175 | 175 | 0 |  | 0 | 0 |
| extra | 80 | 80 | 0 |  | 0 | 0 |
| match | 1,976 | 1,976 |  | 0 | 0 |  |
| missing | 80 | 80 | 0 |  | 0 | 0 |

Run facts: itemsInLookalikeGroups: 749; resultStatus: {"flagged":1}.

### `compareMirror/entities-synthetic/foldCase-false`

a real copy with seeded edits (value swaps, zero-width and trailing-space suffixes, NFD forms, deletions, additions, Cyrillic homoglyph renames); labels by construction. Denominator: entity names in the union of both tables.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| drift | 175 | 175 | 0 |  | 0 | 0 |
| extra | 80 | 80 | 0 |  | 0 | 0 |
| match | 1,976 | 1,976 |  | 0 | 0 |  |
| missing | 80 | 80 | 0 |  | 0 | 0 |

Run facts: itemsInLookalikeGroups: 0; resultStatus: {"flagged":1}.

### `compareMirror/numberTolerance/cents-tol-0.01`

prices on a cent grid; the mirror is 0, 1 or 2 units above the canonical price; numberTolerance 0.01. Denominator: 9999 price pairs.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| different | 3,333 | 3,333 | 0 |  | 0 | 0 |
| match | 6,666 | 6,666 |  | 0 | 0 |  |

### `compareMirror/numberTolerance/cents-tol-0.01/at-the-boundary`

only the pairs whose difference is exactly the tolerance (1 unit). Denominator: price pairs at the boundary.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| match | 3,333 | 3,333 |  | 0 | 0 |  |

### `compareMirror/numberTolerance/cents-tol-0.02`

prices on a cent grid; the mirror is 0, 1 or 2 units above the canonical price; numberTolerance 0.02. Denominator: 9999 price pairs.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| match | 9,999 | 9,999 |  | 0 | 0 |  |

### `compareMirror/numberTolerance/cents-tol-0.02/at-the-boundary`

only the pairs whose difference is exactly the tolerance (2 units). Denominator: price pairs at the boundary.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| match | 3,333 | 3,333 |  | 0 | 0 |  |

### `compareMirror/numberTolerance/tenths-tol-0.1`

prices on a tenth grid; the mirror is 0, 1 or 2 units above the canonical price; numberTolerance 0.1. Denominator: 9999 price pairs.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| different | 3,333 | 3,333 | 0 |  | 0 | 0 |
| match | 6,666 | 6,666 |  | 0 | 0 |  |

### `compareMirror/numberTolerance/tenths-tol-0.1/at-the-boundary`

only the pairs whose difference is exactly the tolerance (1 unit). Denominator: price pairs at the boundary.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| match | 3,333 | 3,333 |  | 0 | 0 |  |

## Hand-typed constants (`findHandTypedConstants`)

| Class | Items that should flag | False pass | Items that should pass | False flag | Abstain |
| --- | ---: | ---: | ---: | ---: | ---: |
| `findHandTypedConstants/advisory-texts` | 306 | 0 of 306 (0.000%) (95% CI 0.000 to 1.240%) | 479 | 0 of 479 (0.000%) (95% CI 0.000 to 0.796%) | 0 |

### `findHandTypedConstants/advisory-texts`

400 advisory descriptions and 9 registered numbers; every digit run equal to a registered number is either a hand-typed copy or not, by the README rules. Denominator: digit runs whose value equals a registered number (typed copies, plus runs the rules exclude), plus kit hits that are neither.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| hit | 306 | 306 | 0 |  | 0 | 0 |
| match | 479 | 479 |  | 0 | 0 |  |

Run facts: flaggedNonCopyIds: {}; kitHits: 306; missedIds: {}.

## Review stamps (`auditReviewStamps`)

| Class | Items that should flag | False pass | Items that should pass | False flag | Abstain |
| --- | ---: | ---: | ---: | ---: | ---: |
| `auditReviewStamps/pypa-history/backward` | 0 | 0 of 0 (n/a) | 533,837 | 0 of 533,837 (0.000%) (95% CI 0.000 to 0.001%) | 0 |
| `auditReviewStamps/pypa-history/bulkBump` | 170 | 0 of 170 (0.000%) (95% CI 0.000 to 2.210%) | 533,667 | 0 of 533,667 (0.000%) (95% CI 0.000 to 0.001%) | 0 |
| `auditReviewStamps/pypa-history/future` | 144 | 0 of 144 (0.000%) (95% CI 0.000 to 2.598%) | 533,693 | 0 of 533,693 (0.000%) (95% CI 0.000 to 0.001%) | 0 |
| `auditReviewStamps/pypa-history/stampOnly` | 1 | 0 of 1 (0.000%) (95% CI 0.000 to 79.346%) | 533,836 | 0 of 533,836 (0.000%) (95% CI 0.000 to 0.001%) | 0 |
| `auditReviewStamps/pypa-history/unreadable-stamp` | 0 | 0 of 0 (n/a) | 533,837 | 0 of 533,837 (0.000%) (95% CI 0.000 to 0.001%) | 0 |
| `auditReviewStamps/pypa-injected/backward` | 100 | 0 of 100 (0.000%) (95% CI 0.000 to 3.699%) | 592 | 0 of 592 (0.000%) (95% CI 0.000 to 0.645%) | 0 |
| `auditReviewStamps/pypa-injected/bulkBump` | 51 | 0 of 51 (0.000%) (95% CI 0.000 to 7.005%) | 641 | 0 of 641 (0.000%) (95% CI 0.000 to 0.596%) | 0 |
| `auditReviewStamps/pypa-injected/future` | 60 | 0 of 60 (0.000%) (95% CI 0.000 to 6.017%) | 632 | 0 of 632 (0.000%) (95% CI 0.000 to 0.604%) | 0 |
| `auditReviewStamps/pypa-injected/stampOnly` | 326 | 0 of 326 (0.000%) (95% CI 0.000 to 1.165%) | 366 | 0 of 366 (0.000%) (95% CI 0.000 to 1.039%) | 0 |
| `auditReviewStamps/pypa-injected/unreadable-stamp` | 24 | 0 of 24 (0.000%) (95% CI 0.000 to 13.798%) | 668 | 0 of 668 (0.000%) (95% CI 0.000 to 0.572%) | 0 |
| `auditReviewStamps/pypa-option-variants/bulkBump` | 330 | 0 of 330 (0.000%) (95% CI 0.000 to 1.151%) | 138,990 | 0 of 138,990 (0.000%) (95% CI 0.000 to 0.003%) | 0 |
| `auditReviewStamps/pypa-option-variants/stampOnly` | 92 | 0 of 92 (0.000%) (95% CI 0.000 to 4.008%) | 139,228 | 0 of 139,228 (0.000%) (95% CI 0.000 to 0.003%) | 0 |
| `auditReviewStamps/stamp-edge-cases/backward` | 5 | 0 of 5 (0.000%) (95% CI 0.000 to 43.449%) | 35 | 0 of 35 (0.000%) (95% CI 0.000 to 9.890%) | 0 |
| `auditReviewStamps/stamp-edge-cases/future` | 5 | 0 of 5 (0.000%) (95% CI 0.000 to 43.449%) | 35 | 0 of 35 (0.000%) (95% CI 0.000 to 9.890%) | 0 |
| `auditReviewStamps/stamp-edge-cases/stampOnly` | 17 | 0 of 17 (0.000%) (95% CI 0.000 to 18.432%) | 23 | 0 of 23 (0.000%) (95% CI 0.000 to 14.312%) | 0 |
| `auditReviewStamps/stamp-edge-cases/unreadable-stamp` | 14 | 0 of 14 (0.000%) (95% CI 0.000 to 21.532%) | 26 | 0 of 26 (0.000%) (95% CI 0.000 to 12.873%) | 0 |

### `auditReviewStamps/pypa-history/backward`

one real pair of daily or horizon snapshots of the pypa advisory database; `modified` is the review stamp, any other field change is evidence: backward. Denominator: record pairs (union of ids on both sides), summed over pairs with a change.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| backward | 0 | 0 | 0 |  | 0 | 0 |
| match | 533,837 | 533,837 |  | 0 | 0 |  |

Run facts: pairsAudited: 75; recordPairComparisons: 533837.

### `auditReviewStamps/pypa-history/bulkBump`

one real pair of daily or horizon snapshots of the pypa advisory database; `modified` is the review stamp, any other field change is evidence: bulkBump. Denominator: record pairs (union of ids on both sides), summed over pairs with a change.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| bulkBump | 170 | 170 | 0 |  | 0 | 0 |
| match | 533,667 | 533,667 |  | 0 | 0 |  |

Run facts: pairsAudited: 75; recordPairComparisons: 533837.

### `auditReviewStamps/pypa-history/future`

one real pair of daily or horizon snapshots of the pypa advisory database; `modified` is the review stamp, any other field change is evidence: future. Denominator: record pairs (union of ids on both sides), summed over pairs with a change.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| future | 144 | 144 | 0 |  | 0 | 0 |
| match | 533,693 | 533,693 |  | 0 | 0 |  |

Run facts: pairsAudited: 75; recordPairComparisons: 533837.

### `auditReviewStamps/pypa-history/stampOnly`

one real pair of daily or horizon snapshots of the pypa advisory database; `modified` is the review stamp, any other field change is evidence: stampOnly. Denominator: record pairs (union of ids on both sides), summed over pairs with a change.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| match | 533,836 | 533,836 |  | 0 | 0 |  |
| stampOnly | 1 | 1 | 0 |  | 0 | 0 |

Run facts: pairsAudited: 75; recordPairComparisons: 533837.

### `auditReviewStamps/pypa-history/unreadable-stamp`

one real pair of daily or horizon snapshots of the pypa advisory database; `modified` is the review stamp, any other field change is evidence: unknown. Denominator: record pairs (union of ids on both sides), summed over pairs with a change.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| match | 533,837 | 533,837 |  | 0 | 0 |  |
| unreadable-stamp | 0 | 0 | 0 |  | 0 | 0 |

Run facts: pairsAudited: 75; recordPairComparisons: 533837.

### `auditReviewStamps/pypa-injected/backward`

real records with a seeded stamp edit (later, backward, same instant in another notation, sub-millisecond, future, bulk of 10, 11, 25, odd or removed stamps, bare dates): backward. Denominator: edited records.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| backward | 100 | 100 | 0 |  | 0 | 0 |
| match | 592 | 592 |  | 0 | 0 |  |

### `auditReviewStamps/pypa-injected/bulkBump`

real records with a seeded stamp edit (later, backward, same instant in another notation, sub-millisecond, future, bulk of 10, 11, 25, odd or removed stamps, bare dates): bulkBump. Denominator: edited records.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| bulkBump | 51 | 51 | 0 |  | 0 | 0 |
| match | 641 | 641 |  | 0 | 0 |  |

### `auditReviewStamps/pypa-injected/future`

real records with a seeded stamp edit (later, backward, same instant in another notation, sub-millisecond, future, bulk of 10, 11, 25, odd or removed stamps, bare dates): future. Denominator: edited records.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| future | 60 | 60 | 0 |  | 0 | 0 |
| match | 632 | 632 |  | 0 | 0 |  |

### `auditReviewStamps/pypa-injected/stampOnly`

real records with a seeded stamp edit (later, backward, same instant in another notation, sub-millisecond, future, bulk of 10, 11, 25, odd or removed stamps, bare dates): stampOnly. Denominator: edited records.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| match | 366 | 366 |  | 0 | 0 |  |
| stampOnly | 326 | 326 | 0 |  | 0 | 0 |

Run facts: exactFlagSetByVariant: {"V10_bare_dates":"40/40","V1_stamp_only_later":"150/150","V2_stamp_plus_whitespace_details":"100/100","V3_backward":"100/100","V4_same_instant_other_notation":"100/100","V5_submillisecond_move":"27/27","V6_plus_one_ms":"30/30","V7_future":"60/60","V8_bulk_10_same_day":"10/10","V8_bulk_11_same_day":"11/11","V8_bulk_15_evidenced":"15/15","V8_bulk_25_same_day":"25/25","V9_odd_stamps":"14/14","V9b_stamp_removed":"10/10"}.

### `auditReviewStamps/pypa-injected/unreadable-stamp`

real records with a seeded stamp edit (later, backward, same instant in another notation, sub-millisecond, future, bulk of 10, 11, 25, odd or removed stamps, bare dates): unknown. Denominator: edited records.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| match | 668 | 668 |  | 0 | 0 |  |
| unreadable-stamp | 24 | 24 | 0 |  | 0 | 0 |

### `auditReviewStamps/pypa-option-variants/bulkBump`

the six horizon pairs again with valueFields or ignoreFields changing what counts as evidence: bulkBump. Denominator: record pairs (union of ids), summed over six pairs and three option sets.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| bulkBump | 330 | 330 | 0 |  | 0 | 0 |
| match | 138,990 | 138,990 |  | 0 | 0 |  |

### `auditReviewStamps/pypa-option-variants/stampOnly`

the six horizon pairs again with valueFields or ignoreFields changing what counts as evidence: stampOnly. Denominator: record pairs (union of ids), summed over six pairs and three option sets.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| match | 139,228 | 139,228 |  | 0 | 0 |  |
| stampOnly | 92 | 92 | 0 |  | 0 | 0 |

### `auditReviewStamps/stamp-edge-cases/backward`

one record whose stamp moves from 2026-06-01 to a boundary notation (offsets, fractions, leap days, 24:00, whitespace, full-width digits): backward. Denominator: stamp strings.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| backward | 5 | 5 | 0 |  | 0 | 0 |
| match | 35 | 35 |  | 0 | 0 |  |

### `auditReviewStamps/stamp-edge-cases/future`

one record whose stamp moves from 2026-06-01 to a boundary notation (offsets, fractions, leap days, 24:00, whitespace, full-width digits): future. Denominator: stamp strings.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| future | 5 | 5 | 0 |  | 0 | 0 |
| match | 35 | 35 |  | 0 | 0 |  |

### `auditReviewStamps/stamp-edge-cases/stampOnly`

one record whose stamp moves from 2026-06-01 to a boundary notation (offsets, fractions, leap days, 24:00, whitespace, full-width digits): stampOnly. Denominator: stamp strings.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| match | 23 | 23 |  | 0 | 0 |  |
| stampOnly | 17 | 17 | 0 |  | 0 | 0 |

### `auditReviewStamps/stamp-edge-cases/unreadable-stamp`

one record whose stamp moves from 2026-06-01 to a boundary notation (offsets, fractions, leap days, 24:00, whitespace, full-width digits): unknown. Denominator: stamp strings.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| match | 26 | 26 |  | 0 | 0 |  |
| unreadable-stamp | 14 | 14 | 0 |  | 0 | 0 |

## Fresh holdout, labeled before the run (see `holdout/PREREGISTRATION.md`)

| Class | Items that should flag | False pass | Items that should pass | False flag | Abstain |
| --- | ---: | ---: | ---: | ---: | ---: |
| `holdout/compareMirror/gitea` | 7,469 | 0 of 7,469 (0.000%) (95% CI 0.000 to 0.051%) | 36,223 | 0 of 36,223 (0.000%) (95% CI 0.000 to 0.011%) | 0 |
| `holdout/compareMirror/http-status` | 34 | 0 of 34 (0.000%) (95% CI 0.000 to 10.152%) | 285 | 0 of 285 (0.000%) (95% CI 0.000 to 1.330%) | 0 |
| `holdout/compareMirror/spdx` | 23 | 0 of 23 (0.000%) (95% CI 0.000 to 14.312%) | 1,457 | 0 of 1,457 (0.000%) (95% CI 0.000 to 0.263%) | 0 |

### `holdout/compareMirror/gitea`

fresh holdout, labeled before the run: Gitea en-US strings against twelve translations (printf verbs, tags, URLs). Denominator: ids in the union of canonical and mirror, summed over mirrors.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| drift | 84 | 84 | 0 |  | 0 | 0 |
| extra | 24 | 24 | 0 |  | 0 | 0 |
| match | 36,223 | 36,223 |  | 0 | 0 |  |
| missing | 7,361 | 7,361 | 0 |  | 0 | 0 |

Run facts: itemsInLookalikeGroups: 0; mirrors: 12; resultStatus: {"flagged":12}.

### `holdout/compareMirror/http-status`

fresh holdout, labeled before the run: IANA status registry against five published copies of the reason phrases. Denominator: ids in the union of canonical and mirror, summed over mirrors.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| drift | 20 | 20 | 0 |  | 0 | 0 |
| extra | 9 | 9 | 0 |  | 0 | 0 |
| match | 285 | 285 |  | 0 | 0 |  |
| missing | 5 | 5 | 0 |  | 0 | 0 |

Run facts: itemsInLookalikeGroups: 0; mirrors: 5; resultStatus: {"flagged":5}.

### `holdout/compareMirror/spdx`

fresh holdout, labeled before the run: SPDX License List 3.29.0 against two npm packages. Denominator: ids in the union of canonical and mirror, summed over mirrors.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| drift | 4 | 4 | 0 |  | 0 | 0 |
| match | 1,457 | 1,457 |  | 0 | 0 |  |
| missing | 19 | 19 | 0 |  | 0 | 0 |

Run facts: itemsInLookalikeGroups: 0; mirrors: 2; resultStatus: {"flagged":2}.

## Fetched sources (AGPL, not stored in this repository; `--tier all`)

| Class | Items that should flag | False pass | Items that should pass | False flag | Abstain |
| --- | ---: | ---: | ---: | ---: | ---: |
| `fetched/compareMirror/i18n-mastodon` | 71,337 | 0 of 71,337 (0.000%) (95% CI 0.000 to 0.005%) | 95,718 | 0 of 95,718 (0.000%) (95% CI 0.000 to 0.004%) | 0 |
| `fetched/compareMirror/nextcloud-l10n` | 5,100 | 0 of 5,100 (0.000%) (95% CI 0.000 to 0.075%) | 35,832 | 0 of 35,832 (0.000%) (95% CI 0.000 to 0.011%) | 0 |

### `fetched/compareMirror/i18n-mastodon`

mastodon: every key of every locale file against en.json, ICU placeholder names, tag names and URLs. Denominator: keys in the union of both files, summed over locale files.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| drift | 143 | 143 | 0 |  | 0 | 0 |
| match | 95,718 | 95,718 |  | 0 | 0 |  |
| missing | 71,194 | 71,194 | 0 |  | 0 | 0 |

Run facts: locales: 105; resultStatus: {"flagged":100,"ok":5}.

### `fetched/compareMirror/nextcloud-l10n`

nextcloud core translations: en_GB against every other locale, and ten pairs of regional variants; keys are the English strings, field is the set of %s, %1$s and {name} placeholders. Denominator: keys in the union of both files, summed over 66 locale pairs.

| Label says | Items | Kit agrees | Kit passed it (false pass) | Kit flagged it (false flag) | Kit said unknown | Kit named another class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| drift | 10 | 10 | 0 |  | 0 | 0 |
| extra | 127 | 127 | 0 |  | 0 | 0 |
| match | 35,832 | 35,832 |  | 0 | 0 |  |
| missing | 4,963 | 4,963 | 0 |  | 0 | 0 |

Run facts: itemsInLookalikeGroups: 1281; localePairs: 66; resultStatus: {"flagged":52,"unknown":14}.

Intervals are 95% Wilson score intervals; with zero events in n items the upper bound is about 3.8 divided by n.

