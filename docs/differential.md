# Where parity-kit and a generic diff agree, and where they do not

`compareMirror` is not a diff library, but on one narrow question it should give
the same answer as one: which records and fields differ between two sets of
plain JSON records. This page records how that was checked against two mature
libraries and every place the three disagree, with a ruling for each.

The test is `test/differential.test.ts`. The two reference libraries are dev
dependencies only (`deep-diff` 1.0.2 and `microdiff` 1.6.0); nothing in
`dependencies` or `dist` uses them. `deep-diff` is marked deprecated on npm
("no longer supported"); it is still widely installed, which is why it is used
as a reference.

## What is compared

For each generated pair of datasets, the kit and each library are asked what
differs, and the answers are reduced to the same shape:

- ids present only in the canonical set (missing) and only in the mirror (extra);
- (id, field) pairs whose value differs, where a nested change counts against
  its top-level field.

The libraries are given the two sets as objects keyed by id with the id field
removed, so `path[0]` is the id and `path[1]` the field. The kit is given the
arrays. Nothing else is shared.

## Agreement on 15,000 datasets

The generator is in the test file only (a seeded mulberry32, seed 20261014). It
builds 1 to 7 records with up to five fields of JSON values (null, booleans,
numbers including `0.1`, `1.25` and `1e21`, strings including `''`, combining
accents and CJK, arrays and objects up to three levels deep), then makes a
mirror by editing some records (replace a value, change something nested,
delete or add a field, reorder the keys), dropping about one record in ten,
adding one or two unknown records and shuffling the order.

Result: on 15,000 datasets the kit's missing, extra and changed sets equal
deep-diff's and microdiff's on every dataset, **0 disagreements**. The seed is
fixed, so the totals are exact and the test pins them: 6,114 missing ids,
7,309 extra ids, 15,775 changed (id, field) pairs, and 2,410 datasets in which
nothing differed at all.

Agreement on this data is not a proof of anything beyond this data. It shows
that the kit does not invent or lose differences on ordinary JSON, and that the
other disagreements are limited to the cases below.

## Properties that need no reference

The same file checks four properties on 1,000 seeded datasets each:

- a dataset compared with a copy of itself is `ok`;
- swapping canonical and mirror swaps `missing` and `extra` and leaves the
  changed (id, field) pairs the same;
- a field name that no record has is never `ok` (it is reported in
  `unknownFields`), and an empty `fields` list throws;
- renaming every id between two audit snapshots is never `ok` and compares
  nothing.

## Rulings

Each row passes one record pair through all three and pins the outcome in the
test (`rulings:` block). "Refused" means the kit reports the record as
`invalid` instead of comparing it. "Same" and "different" are what the tool
reports for the pair.

| Row | Case | kit | deep-diff | microdiff | Ruling |
| --- | --- | --- | --- | --- | --- |
| R1 | `-0` against `0` | same | same | different | The kit follows `===`: a copy of a price is not stale because the sign bit of a zero differs. microdiff treats them as different. |
| R2 | `NaN` against `NaN` | same | same | same | All three call two NaNs equal. |
| R3 | a property set to `undefined` against an absent property | same | different | different | The kit treats `undefined` as absent, the way JSON does (README, "What is read"). Both libraries report a difference. If your data distinguishes the two, normalize it before the call. |
| R4 | two invalid Dates | same | different | same | The kit compares Dates by time value and calls two invalid Dates equal. deep-diff reports a difference. |
| R5 | two Date objects for the same instant | same | same | same | Agreement. |
| R6 | a Date against its ISO string | different | different | different | Agreement: a Date is not a string. |
| R7 | a hole in an array (`[1, , 3]`) | refused | different | different | The kit cannot tell what a hole means and refuses the record. The libraries compare it with `undefined`. |
| R8 | two Maps with different contents | refused | same | same | Both libraries read a Map as an object with no enumerable properties, so two different Maps look identical. The kit refuses a Map rather than pass it. This is the one place a generic diff silently says "no difference" about different data. |
| R9 | a class instance against a plain object with the same fields | refused | same | same | The kit reads plain data only. The libraries compare the own fields and call them equal. |
| R10 | two different functions | refused | different | different | Functions are not data; the kit refuses them. |
| R11 | a boxed `Number(1)` against `1` | refused | different | different | The kit refuses boxed primitives. |
| R12 | a cycle on both sides | refused | different | different | The kit reports `cycle`. |
| R13 | `1.25` against `1.2500000001` with `numberTolerance: 1e-6` | same | different | different | Tolerance is a kit option; the libraries have none. |
| R14 | key order inside a nested object | same | same | same | Agreement. |
| R15 | array order | different | different | different | Agreement: arrays are ordered. |
| R16 | the string `"1"` against the number `1` | different | different | different | Agreement. |

Where a row says "refused", the kit is deliberately stricter than a generic
diff: it would rather report "I could not read this" than answer "no
difference".

## Re-running

```
npm test -- test/differential.test.ts
```
