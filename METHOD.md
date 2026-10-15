# Method

How parity-kit reaches each verdict, what it assumes, how often it was wrong on
labeled data, and how to change every default. Read this before you make the
kit a gate that blocks a release.

## What the kit does and does not do

parity-kit checks evidence. Given two sets of records, it reports where the
data shows the copies disagree. Given two snapshots of one set, it reports
review dates that moved when the data shows no reason for them to move.

It does not certify that a value is true, that a copy is the right one, that a
person rechecked anything, or that you comply with any rule, contract or law.
A result of `ok` means "nothing was reported on the data you passed, with the
options you passed". It does not mean the data is correct. See
"Non-reliance" at the end.

## Four rules behind every verdict

1. **Fail only on positive evidence.** A difference is reported only when the
   data shows it. A record is never called missing because it could not be read.
2. **"Can't tell" is its own answer.** An unreadable record, a missing or
   unparseable date, a zoneless timestamp, an empty dataset, a look-alike key
   or a check that compared nothing is reported as `invalid`, `unknown` or
   `suspectKeys`, and `ok` is `false`. It is never a silent pass and never a
   made-up difference.
3. **A bad call throws.** A misspelled option, a registry entry with an unknown
   key or an argument that is not a dataset throws `ParityError`. Skipping it
   would quietly turn a check off.
4. **The caller decides what is canonical.** The kit has no opinion on which
   copy is right.

## Verdicts

`status` is `flagged`, `unknown` or `ok`. `ok` is `true` only when nothing at
all is reported.

### `compareMirror`

| Report | When it is set | Why | How to change it |
| --- | --- | --- | --- |
| `missing` | A key is in the canonical set and not in the mirror. | The mirror lost a record. Unreadable records still count as present, so a read failure is never called a loss. | Filter the canonical set to the ids the mirror should carry, using a list that does not come from the mirror. There is no subset option on purpose. |
| `extra` | A key is in the mirror and not in the canonical set. | The mirror has a record the source does not. | None. Remove the record or add it to the source. |
| `changed` | A compared field differs (`different`, `missing-in-mirror`, `extra-in-mirror`). | Exact comparison is the only rule that cannot hide a change. | `fields`, `ignoreFields`, `numberTolerance`. |
| `stampHidesDrift` | Both copies carry the same review date and other fields differ. | A shared date on top of a mismatch makes the date vouch for it. | Needs `reviewedField`. Leave it unset to turn this off. |
| `duplicateKeys` | One key is used by more than one record on a side. | Which record is meant is not knowable. Those records are not compared but still count as present. | Fix the data. |
| `suspectKeys` | Two keys look alike but are not identical. | A renamed key (a trailing zero-width character, a Cyrillic letter) must not be merged silently. The status is `unknown`. | `foldCase: false` stops grouping keys that differ only by case. |
| `unknownFields` | A name you gave in `fields`, `ignoreFields` or `reviewedField` is in no record. | A misspelled name would otherwise compare nothing. | Correct the name. |
| `noFieldsCompared` | Records matched but `ignoreFields` removed every field they carry. The key column does not count as a field, so naming the key in `fields` does not avoid it. | A run that checked nothing is not a pass. | Narrow `ignoreFields`. Records that carry only an id are an honest presence check and do not set this. |
| `invalid` | A record or dataset could not be read, with a reason. | One bad record must not hide the others, and must not pass. | Fix the record. `allowEmpty: true` accepts an empty canonical set. |

### `auditReviewStamps`

| Report | When it is set | Why | How to change it |
| --- | --- | --- | --- |
| `stampOnly` | The review date moved later and no value, source or reviewer changed. | The date moved without any mark of a recheck in the data. | List the fields that count as evidence with `valueFields` and `sourceFields`, and fields that never count with `ignoreFields`. |
| `bulkBump` | More than `bulkThreshold` records moved to the same new UTC day. | One script run can refresh many dates at once. It is a request to look closer, and it is flagged even when every record also changed. | `bulkThreshold` (default 10). To accept bumps that are all evidenced, filter the result as shown in the README. |
| `future` | A review date is later than `now`. | A date in the future cannot have been earned. | Pass `now`. Without it nothing is judged and no clock is read. |
| `backward` | A review date moved earlier. | Dates should not go back. | Rewrite both snapshots to one date format first if you are migrating formats. |
| `extendedDeadlines` | The expiry moved later and no source field changed. | Moving a deadline is not a recheck. | Needs `expiryField`. |
| `unknown` | A date is missing, not a string, zoneless or unparseable. | The kit does not guess a zone or a format. | Write dates as `YYYY-MM-DD` or with `Z` or an offset. |
| `noOverlap` | Both snapshots have keyed records and share no key. | Renamed ids or the wrong two files compare nothing. The status is `unknown`. | Compare the right pair of files. |
| `unknownFields`, `duplicateKeys`, `suspectKeys`, `invalid` | As in `compareMirror`. | Same reasons. | Same fixes. |

### `findHandTypedConstants`

It returns a list of places where a registered value appears in text. It has no
status. A registry mistake throws `bad-registry`: an entry with an unknown key,
a duplicate id, or an empty registry. An empty registry would make "no hand-typed
copies" look the same as "the registry file failed to load".

## Defaults

| Setting | Default | Why | How to change it |
| --- | --- | --- | --- |
| `key` | `"id"` | The most common identity field. | Pass `key`. If an unrelated field named `id` exists, name a field the records do not have. |
| `fields` | Every own enumerable field of either record | A field added on one side is drift. | Pass `fields`. It must name at least one field not in `ignoreFields`. |
| `numberTolerance` | `0` (exact) | Any tolerance waives real changes. | Pass a number. It is one absolute number for every compared field, so use one call per scale. |
| `foldCase` | `true` | Keys that differ only by case are usually the same key, typed twice. | `foldCase: false` for key sets where case carries meaning, such as HTML entity names. |
| `allowEmpty` | `false` | An empty file loaded by mistake would otherwise pass. | `allowEmpty: true`. |
| `now` | none | The kit never reads the clock. | Pass a `Date`, epoch milliseconds or an ISO timestamp with a zone. |
| `bulkThreshold` | `10` | The owner's choice. More than ten records moving to one new day is the point where a person should look. It is not derived from data. | Pass `bulkThreshold`. Lower it if your bumps are smaller. |
| Reviewer name changes count as evidence | on, when `reviewerField` is set | The owner's choice. A reviewer name in the data is the only mark of who looked. The kit cannot tell that nobody did. | Leave `reviewerField` unset to stop counting it. |
| Bare date | Midnight UTC | A date with no time needs one fixed reading. | Write a full timestamp with an offset. |
| Future grace for a bare date | 14 hours | UTC+14 is the furthest-ahead civil offset, so a bare date may truly be today there. A timestamp with an offset gets none. | Not configurable. |
| Zoneless timestamp | `unknown` | The kit does not guess a zone. | Add `Z` or an offset. |
| `maxRecords` | 1,000,000 | Bound work on hostile input. | `limits`. |
| `maxNodes` | 10,000,000 | Same. Ends a pair of ordinary datasets near 350,000 records. | `limits`, raise it for bigger data. |
| `maxDepth` | 64 (at most 1,000) | Same. | `limits`. |
| `maxKeyLength` | 4,096 (at most 1,048,576) | Same. | `limits`. |

## Heuristics and their measured error rates

A heuristic here is any rule that goes beyond plain equality and so can be
wrong in both directions. Every number below comes from the labeled benchmark in
`bench/` in the repository, run on parity-kit 0.1.0 with Node 26.3.0. Read the
columns this way:

- **False pass.** The label names a problem and the kit reported nothing about
  that item. Rate is false passes over items labeled as a problem.
- **False flag.** The label says the copies agree (or the stamp was earned) and
  the kit reported a problem. Rate is false flags over items labeled as fine.
- The interval is a 95% Wilson interval. With no events in `n` items its upper
  end is about `3.8 / n`.
- Items are not independent: the keys of one locale file share a file, an author
  and a style. Read "0 of 70,230" as "no failure in 70,230 correlated items",
  not as a probability.
- Labels come from independent scripts written from the README rules, and from
  construction for the seeded edits. A rule that both the kit and the scripts
  misread would pass silently. Only the holdout labels were also checked by hand
  (69 items).

Full tables are in `bench/RESULTS.md`; the corpora and licenses are in
`bench/SOURCES.json`.

| Heuristic | Where | False pass | False flag | Corpus and notes |
| --- | --- | --- | --- | --- |
| Exact equality of values | `compareMirror`, field level | 0 of 1,236 and 0 of 128 drifted keys in two locale corpora; 0 of 468 different advisory fields | 0 of 33,148 and 0 of 70,230 matching keys; 0 of 951 matching advisory fields | Translation placeholder, tag and URL sets of 56 and 59 locale files; 200 advisories against their OSV.dev copy. |
| Equality on the fresh holdout | `compareMirror` | 0 of 7,469, 0 of 34 and 0 of 23 | 0 of 36,223, 0 of 285 and 0 of 1,457 | Gitea strings, IANA status phrases, SPDX licenses. Labeled and the prediction committed before the kit was run. The upper interval ends are 0.051%, 10.2% and 14.3% for the three miss counts. |
| Missing and extra ids | `compareMirror` | 0 of 1,400, 0 of 24,396 and 0 of 424 missing ids; 0 of 127 extra ids in a third corpus | none observed beyond the matching-key counts above | Locale files and the WHATWG entity table against six published copies. |
| Look-alike keys (`suspectKeys`, `foldCase: true`) | `compareMirror` | 0 of 335 seeded edits (value swaps, deletions, additions, and renames that use zero-width suffixes, NFD forms or Cyrillic letters) | **File level, not zero.** On the WHATWG entity table, 4,746 of 13,386 names fall in a look-alike group (names such as `&AElig;` and `&aelig;`), and 2 of the 2 copies with no real drift came back `unknown` instead of `ok`. With `foldCase: false` those two are `ok` and 0 of 12,962 items flag. On a Nextcloud corpus, 1,281 keys fall in groups and 14 of 66 locale pairs ended `unknown` for that reason. | The heuristic is meant to stop you merging a renamed key, so a case-distinct key set trips it by design. Items were still scored correctly one by one (0 false passes and 0 false flags), because each key keeps its own verdict. The cost is a file-level `unknown`. |
| Case sensitivity off (`foldCase: false`) | `compareMirror` | 0 of 424 and 0 of 335 | 0 of 12,962 and 0 of 1,976 | Trade-off: a Cyrillic capital for a Latin capital is then no longer grouped. It still shows as `missing` plus `extra`, so it cannot pass. |
| `stampHidesDrift` | `compareMirror` | 0 of 15 | 0 of 185 | 200 advisories against OSV.dev. Few real cases, so the interval is wide (0 to 20.4% for the miss count). |
| `numberTolerance` plus a binary-rounding allowance of `min(8 * Number.EPSILON * max(\|a\|, \|b\|, tolerance), tolerance / 1000)` | `compareMirror` | 0 of 3,333 pairs one unit past the tolerance, on a cent grid and on a tenth grid | 0 of 3,333 pairs exactly at the tolerance, on each grid | Generated prices on integer grids. There is no real-data coverage of `numberTolerance`. |
| Number lexer and boundaries | `findHandTypedConstants` | 0 of 306 typed copies | 0 of 479 digit runs the rules exclude (`1,250`, `v1.25`, `11.256`) | 400 advisory descriptions, 9 registered numbers. Some scanner rules were changed after reading this corpus, so it is not a blind test of those rules. The measure is whether a digit run equal to the value is found or skipped, not whether the author meant it as a copy of the constant (see limits). |
| `stampOnly` (no evidence in the data) | `auditReviewStamps` | 0 of 1 real, 0 of 326 injected, 0 of 92 with option variants, 0 of 17 hand-chosen | 0 of 533,836 real pairs, 0 of 366 injected, 0 of 139,228, 0 of 23 | Only one real stamp-only event exists in the advisory history (interval 0 to 79%). The injected and hand-chosen items are the authors' idea of a hard case. |
| `bulkBump` | `auditReviewStamps` | 0 of 170 real, 0 of 51 injected, 0 of 330 with option variants | 0 of 533,667, 0 of 641, 0 of 138,990 | Real advisory history across 75 snapshot pairs. Measured at the default threshold of 10. |
| `future` | `auditReviewStamps` | 0 of 144 real, 0 of 60 injected, 0 of 5 hand-chosen | 0 of 533,693, 0 of 632, 0 of 35 | The 14-hour grace for bare dates is exercised only by the 40 hand-chosen stamps. |
| `backward` | `auditReviewStamps` | 0 of 100 injected, 0 of 5 hand-chosen | 0 of 592 injected, 0 of 35 hand-chosen | **No real event exists** in the corpus (0 items), so this is not a real-data result. |
| Unreadable or ambiguous stamp (`unknown`) | `auditReviewStamps` | 0 of 24 injected, 0 of 14 hand-chosen | 0 of 668, 0 of 26 | **No real event exists** in the corpus. |

All classes together, in the pinned run: 0 false passes in 121,642 items that
should flag, and 0 false flags in 3,287,820 items that should pass. The class
rows overlap (the same pair is scored once per flag), so these are counts of
verdicts, not of distinct items.

### Not measured

These rules are covered by unit tests but have no labeled real-data
measurement, so no error rate is claimed for them:

- `reviewerField` counting a name change as evidence.
- `expiryField` and `extendedDeadlines`.
- `noOverlap`, `noFieldsCompared`, and the empty-dataset and `invalid` reasons.
- Whether an `unknown` result is common on your own data. It depends on how
  clean your keys and dates are.

## Honest limits

- **Equality, not meaning.** A translation that swaps `%s` for `%[1]s` prints the
  same and is reported as drift. A cosmetic change to a value still counts as
  evidence of a recheck.
- **Evidence is whatever changed.** A stamp that moved next to a changed value
  passes, even if a script made the change. A reviewer name that changes counts
  as evidence even if nobody reviewed. The kit cannot see a recheck that left no
  mark in the data.
- **An automatic field hides stamp-only bumps.** A field that changes on every
  edit (`updatedAt`, a version counter) counts as evidence unless you list it in
  `ignoreFields`. The kit cannot know which field you meant.
- **Bulk bumps split at UTC midnight.** Grouping is by UTC day. A bump spread
  over two UTC days, or one local day that crosses UTC midnight, is counted per
  day and can stay under the threshold. A bump with no value change is still
  caught as `stampOnly`; one padded with a real change to every record is
  evidence by the rules.
- **One tolerance for every number.** `numberTolerance: 0.01` also waives a fee
  rate change from `0.015` to `0.02`.
- **Numbers are 64-bit floats.** Integers past 2^53 that `JSON.parse` already
  rounded compare equal. Keep such ids as strings.
- **Order of records is not compared.** If the order is the fact, put it in a
  field such as `rank`.
- **Look-alike keys use a short list.** NFKC normalization, invisible
  characters, whitespace, dashes, case and a short list of Cyrillic and Greek
  letters. It is not the full Unicode confusables table. A pair it does not
  group still shows as `missing` plus `extra`.
- **Hand-typed constants are text matches.** A registered `8` matches every
  standalone `8`. The kit finds the number; it does not know whether the author
  meant it as a copy of your constant. Prefer a `forms` entry with context. Minified
  arrays of three-digit integers separated by bare commas (`[100,200,300]`) run
  together and are not found; parse such data and use `compareMirror`.
- **JSON-shaped data only.** Class instances, `Map`, `Set`, functions and symbols
  make a record `invalid`. A built-in disguised with a replaced prototype and its
  own enumerable properties is read as plain data.
- **The corpus is public text data.** Locale files, an entity table, an advisory
  database, status phrases and license lists. Your data may behave differently.
  Product catalogs, price lists and records with free text are not represented.
- **No comparison against a human reviewer.** Nobody measured how often the
  findings changed a decision.

## Non-reliance

parity-kit is a data check provided as is, under the MIT license in `LICENSE`.
It reports differences and unexplained date changes in the data you give it. It
does not certify that any data is accurate, current or complete, and it does not
establish that a review took place. Nothing it prints is legal, regulatory,
financial or compliance advice, and a passing result is not evidence of
compliance with any law, standard, contract or policy. Error rates above were
measured on the named public corpora and may be different on yours. Keep the
decision about what to publish with a person who can read the data.
