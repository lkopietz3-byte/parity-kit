# Parity Kit

A small, zero-dependency TypeScript library for two questions about data you publish more than once:

1. **Does every copy of a fact still match its source of truth?** (`compareMirror`, `findHandTypedConstants`)
2. **Was a review date earned by an actual recheck?** (`auditReviewStamps`)

You hand it data. It hands back a plain report of what differs. It reads no files, makes no network calls and reads no clock unless you give it a time. Part of the honesty kits, a family of small checks for the claims a product makes.

This package is private and unlicensed (`"private": true`, `"license": "UNLICENSED"`). It is not published anywhere.

## Why

Facts get copied. A `programs.json` feeds a website, a browser extension ships its own `valuations.json`, a doc quotes "1.25 cents per point". Each copy carries a "last reviewed" date. Over time two things go wrong quietly:

- **Drift.** One copy says `1.25` and the other says `1.0`, and both claim the same review date, so the date vouches for a mismatch.
- **Unearned stamps.** Someone bumps `lastReviewed` on 67 records in one commit. The dates look fresh. Nothing was rechecked.

freshness-kit (a sibling kit) scores how old a review date is. This kit asks a different question: do the copies agree, and did the date move for a reason the data can show.

## Install

```sh
npm install ./parity-kit        # from a local checkout
```

Node 20 or newer. ESM only. No runtime dependencies. Nothing in `src` imports `node:` modules, so it also runs in a browser.

## Worked example

`programs.json` is the source of truth. `extension/valuations.json` is a copy that ships in a browser extension.

```ts
import { compareMirror, findHandTypedConstants, auditReviewStamps } from 'parity-kit';

const programs = [
  { id: 'chase-ur', name: 'Chase Ultimate Rewards', baselineCpp: 1.25, lastReviewed: '2026-06-08' },
  { id: 'amex-mr', name: 'Amex Membership Rewards', baselineCpp: 1.2, lastReviewed: '2026-06-08' },
  { id: 'bilt', name: 'Bilt Rewards', baselineCpp: 1.5, lastReviewed: '2026-06-08' },
];
const extension = [
  { id: 'chase-ur', name: 'Chase Ultimate Rewards', baselineCpp: 1.0, lastReviewed: '2026-06-08' },
  { id: 'amex-mr', name: 'Amex Membership Rewards', baselineCpp: 1.2, lastReviewed: '2026-06-08' },
  { id: 'cap-one', name: 'Capital One Miles', baselineCpp: 1.0, lastReviewed: '2026-06-08' },
];

const result = compareMirror(programs, extension, { reviewedField: 'lastReviewed' });
if (!result.ok) {
  console.error(result);
  process.exit(1);
}
```

`result` for this data:

```json
{
  "ok": false,
  "status": "flagged",
  "compared": 2,
  "missing": ["bilt"],
  "extra": ["cap-one"],
  "changed": [
    { "id": "chase-ur", "field": "baselineCpp", "change": "different", "canonical": 1.25, "mirror": 1 }
  ],
  "stampHidesDrift": [
    { "id": "chase-ur", "reviewedValue": "2026-06-08", "fields": ["baselineCpp"] }
  ],
  "duplicateKeys": [],
  "suspectKeys": [],
  "invalid": []
}
```

Read it as: the extension lacks `bilt`, has a `cap-one` the source does not, disagrees on `chase-ur`'s value, and the shared review date `2026-06-08` is sitting on top of that disagreement.

To stop the next hand-typed copy, scan source files and docs for the registered value:

```ts
const hits = findHandTypedConstants(sourceText, [{ id: 'chase-ur.baselineCpp', value: 1.25 }]);
// [{ id: 'chase-ur.baselineCpp', text: '1.25', line: 1, column: 27, kind: 'number', ... }, ...]
```

To check a registry change, compare the old and new snapshots:

```ts
const audit = auditReviewStamps(oldSnapshot, newSnapshot, {
  reviewedField: 'lastReviewed',
  sourceFields: ['source'],
  now: '2026-10-10T12:00:00Z', // optional; future dates are only checked when you pass it
});
// audit.stampOnly, audit.bulkBump, audit.future, audit.backward, audit.unknown, ...
```

## The three functions

### `compareMirror(canonical, mirror, options?)`

Compares a canonical set to one mirror. Each argument is an **array of records** or an **object keyed by id**.

| Option | Default | Meaning |
| --- | --- | --- |
| `key` | `"id"` | Field that identifies a record in an array. |
| `fields` | every own enumerable field of either record | Compare only these fields. |
| `ignoreFields` | none | Fields left out of the comparison. |
| `reviewedField` | none | The review-date field. Turns on `stampHidesDrift`. |
| `numberTolerance` | `0` | Two finite numbers are equal when they differ by at most this. |
| `allowEmpty` | `false` | Let an empty canonical set pass. |
| `foldCase` | `true` | Fold upper and lower case when looking for look-alike keys. |
| `limits` | see Limits | `maxRecords`, `maxNodes`, `maxDepth`. |

Returns:

| Field | What it holds |
| --- | --- |
| `ok` | `true` only when every list below is empty. |
| `status` | `flagged` (positive evidence of drift), `unknown` (nothing flagged, but something could not be checked), or `ok`. |
| `compared` | Records present once on both sides and compared field by field. |
| `missing` | Keys in the canonical set that the mirror lacks. |
| `extra` | Keys in the mirror that the canonical set lacks. |
| `changed` | `{ id, field, change, canonical, mirror }`. `change` is `different`, `missing-in-mirror` or `extra-in-mirror`. |
| `stampHidesDrift` | `{ id, reviewedValue, fields }` when both copies carry the same review date but other fields differ. |
| `duplicateKeys` | `{ side, id, positions }` for a key used by more than one record on one side. Those records are not compared. |
| `suspectKeys` | `{ skeleton, keys: [{ side, key }] }` for keys that look alike but are not identical. |
| `invalid` | Records (or a whole dataset) that could not be read, with a reason. |

`status` is `flagged` when `missing`, `extra`, `changed`, `stampHidesDrift` or `duplicateKeys` has anything in it. Otherwise it is `unknown` when `invalid` or `suspectKeys` has anything in it. Otherwise it is `ok`.

### `findHandTypedConstants(text, registry)`

Finds places where a registered constant is typed by hand, so the caller can import the value instead. The registry is `[{ id, value, forms? }]`.

Returns `[{ id, value, text, index, line, column, kind }]`, ordered by position. `index` is a 0-based UTF-16 offset, `line` and `column` are 1-based, and a column counts UTF-16 code units from the start of the line. `kind` is `number` (found by numeric value) or `form` (found as literal text).

### `auditReviewStamps(before, after, options)`

Compares two snapshots of the same dataset.

| Option | Default | Meaning |
| --- | --- | --- |
| `reviewedField` | required | The review-date field. |
| `sourceFields` | required (may be `[]`) | Fields that say where a value came from. Any change counts as evidence of a recheck. |
| `reviewerField` | none | Who reviewed. A change counts as evidence. |
| `expiryField` | none | A deadline field. Turns on `extendedDeadlines`. |
| `valueFields` | every field | Which fields count as values. Source and reviewer fields always count. |
| `ignoreFields` | none | Fields that never count as evidence, such as an automatic `updatedAt`. |
| `now` | none | A `Date`, epoch milliseconds, or an ISO 8601 timestamp with an explicit zone. Without it, future dates are not checked and no clock is read. |
| `bulkThreshold` | `10` | A bulk bump is more than this many records moving to one new day. |
| `key`, `allowEmpty`, `foldCase`, `limits` | as above | |

Returns `ok`, `status`, `compared`, and:

| Field | What it holds |
| --- | --- |
| `stampOnly` | `{ id, from, to }`: the review date moved later and no value, source or reviewer changed. |
| `bulkBump` | `{ date, count, withEvidence, ids }`: more than `bulkThreshold` records moved to the same new UTC day. |
| `future` | `{ id, value }`: a review date later than `now`. |
| `backward` | `{ id, from, to }`: a review date moved earlier. |
| `extendedDeadlines` | `{ id, from, to }`: the expiry moved later and no source field changed. |
| `unknown` | `{ id, side, field, reason, value? }`: a date that cannot be judged. Never a pass. |
| `added`, `removed` | Keys only in `after` or only in `before`. Informational. |
| `duplicateKeys`, `suspectKeys`, `invalid` | As in `compareMirror`. |

`status` is `flagged` when `stampOnly`, `bulkBump`, `future`, `backward`, `extendedDeadlines` or `duplicateKeys` has anything in it. Otherwise it is `unknown` when `unknown`, `invalid` or `suspectKeys` has anything in it. Otherwise it is `ok`.

## Exact rules

### What is read

- A dataset is an **array of records** or a **plain object keyed by id**. In an object, the property name is the id and the order Proxy traps report keys in never matters, because keys are sorted.
- A record must be a **plain object** (its prototype is `null` or `Object.prototype`, from any realm). A class instance, `Map`, `Date` or array in a record slot is reported as `invalid`.
- Only **own enumerable string-keyed properties** are read (or, with `fields`, the named own properties). Inherited properties, symbol keys and non-enumerable properties are ignored. `toJSON`, `then`, `toString` and `valueOf` are never called.
- A **getter** is run once per read. A getter or Proxy trap that throws makes that record `invalid` with reason `unreadable`; the other records are still compared.
- An object property whose value is `undefined` is treated as absent, the way JSON treats it.
- Values may be strings, finite or non-finite numbers, booleans, bigints, `null`, `Date`s, arrays and plain objects, nested. A function, symbol, class instance, `Map`, typed array or other exotic object inside a record makes the record `invalid` with reason `unsupported-value`. A cycle is `cycle`. Nesting deeper than `maxDepth` is `too-deep`.
- A `Date` is recognized by its internal slot, so a `Date` from another realm works and an object that merely has a `getTime` method does not.
- Results never alias your input. Reported values are copies (objects have a `null` prototype).

### How values are compared

- Strings are compared exactly: NFC and NFD differ, a trailing space differs, a zero-width character differs.
- Types are strict: `1.25` and `"1.25"` differ, `1` and `1n` differ, `null` and `0` differ.
- Numbers: `0` equals `-0`. `NaN` equals `NaN`. With `numberTolerance`, two finite numbers are equal when `|a - b| <= tolerance`. Infinities are equal only to the same infinity. Without a tolerance the comparison is exact, so `1.25` and `1.0000001` differ.
- Dates compare by time value. Two invalid Dates are equal.
- Arrays compare in order. Objects compare by their sorted keys, so key order does not matter.
- A field present in only one copy is reported as `missing-in-mirror` or `extra-in-mirror`.

### Keys

- A key is a non-empty (not all whitespace) string or a finite number. `1` and `"1"` are different keys. Keys are compared exactly.
- A key that looks like another key but is not identical is listed in `suspectKeys` and **never merged**. Two keys look alike when they match after: NFKC normalization (so NFC and NFD agree, as do full-width letters and ligatures), removing zero-width, bidi and other invisible characters, collapsing runs of whitespace (including no-break spaces) to one space and trimming, turning dash variants into `-`, folding case (unless `foldCase: false`), and mapping a short list of Cyrillic and Greek lowercase letters that are drawn like Latin ones (`а е о р с у х ѕ і ј һ к ο ν ι ρ` and a few more). The list is short on purpose and is not the full Unicode confusables table.
- A number key and its string form (`1` and `"1"`) look alike by this rule.
- A renamed NFD key therefore shows up three ways: `missing`, `extra` and `suspectKeys`.
- A key used twice on one side is a `duplicateKey`. That id is not compared field by field, but it still counts as present, so it is never reported as missing.
- A record that cannot be read but whose key can be read still counts as present. It is never reported as missing.
- In an object-keyed dataset, a record that also carries the key field must agree with its property name, otherwise it is `key-mismatch`.

### `stampHidesDrift`

Needs `reviewedField`. It is reported for a record when other compared fields differ and both copies carry a present, equal review value. Two strings that parse as the same ISO 8601 instant count as equal. If the review values differ, the review field itself shows up in `changed` and `stampHidesDrift` stays empty, because the stamps are not hiding anything.

### Hand-typed constants

- A **numeric** `value` is found by numeric value at token boundaries, so `1.25` also finds `1.250` and `$1.25` and `1.25x`.
- A number token is digits with optional `,` thousands groups of exactly three digits, an optional `.` fraction and an optional exponent. `1,250` is 1250. A comma that does not start a three-digit group ends the token, so `chase,1.25,0.5` has three numbers.
- It does **not** match inside a longer number or identifier: `11.256`, `21.25`, `1.255`, `0.125`, a dotted run such as `1.25.3` or `10.1.25.7`, `v1.25`, `x_1.25`, `abc1.25`, `1.25_x`, or a zero-padded run such as `08` or `007`. Letters after a number are fine (`1.25x`, `1.25c`).
- A `-` is part of the number when it follows the start of the text, whitespace, an opening bracket or an operator. So `-1.25` is minus 1.25 and does not match a registered `1.25`, while `x-1.25` reads as 1.25.
- A **string** `value`, and every entry in `forms`, is found as exact, case-sensitive text. The first and last character of the match are checked: a form that starts or ends with a letter or digit must not touch another letter, digit or underscore, and a form that starts or ends with a digit follows the same number-boundary rules as above.
- If a numeric hit and a literal hit for the same constant overlap, the longer one is kept.
- Scanning is linear in the length of the text for a fixed registry (an Aho-Corasick automaton for literal forms, one pass for numbers). Sorting the matches adds a log factor in the number of matches. Many heavily overlapping forms multiply the number of raw hits by the registry size.
- Tiny integers are noisy. A registered `8` matches every standalone `8`. Prefer a `forms` entry with context such as `"8 points"`.
- Registry mistakes throw `ParityError` with code `bad-registry`: duplicate ids, an empty id or form, a non-finite number, a value that is not a number or non-empty string, a hole in the array.
- The registry file itself contains the value, so exclude it from the text you scan.

### Review stamps

**Accepted dates (strict ISO 8601 / RFC 3339):**

- `YYYY-MM-DD`, a real calendar date, years 0001 to 9999 (leap years are checked).
- `YYYY-MM-DDTHH:mm[:ss[.f{1,9}]]Z`, or with an offset `+HH:MM` or `-HH:MM`. The `T` and `Z` are upper case.

**Not accepted:** spaces, a lowercase `t` or `z`, basic format (`20260608`), offsets without a colon, hour 24, leap seconds, impossible dates, numbers, `Date` objects. Each is reported as `unknown` with reason `unparseable-date` or `not-a-string`.

**Zoneless timestamps are not guessed at.** `2026-06-08T10:00:00` has no zone, so it is reported as `unknown` with reason `zoneless-timestamp`. Add a `Z` or an offset.

**Order.** A bare date is midnight UTC. Stamps are compared as instants to the millisecond (extra fraction digits are cut off). `2026-06-09` and `2026-06-09T01:00:00+01:00` are the same instant, so that is not a move.

**Future.** Checked only when `now` is supplied. A timestamp with an explicit offset is future when it is later than `now`, with no tolerance. A bare date can be today in a zone up to 14 hours ahead of UTC, so it is future only when its start of day, minus 14 hours, is later than `now`. `now` must be a valid `Date` (any realm), epoch milliseconds, or an ISO timestamp with an explicit zone. A bare date or zoneless `now` throws.

**Evidence of a recheck** is any change, between the two snapshots, in:

- a value field (every field except the key, the review field, the expiry field and `ignoreFields`, or only `valueFields` when given),
- a source field, or
- the reviewer field.

A field added or removed counts as a change. The expiry field is not evidence: moving a deadline is not a recheck.

**`stampOnly`:** the stamp moved later and there is no evidence.

**`bulkBump`:** more than `bulkThreshold` records moved later to the same new **UTC calendar day**, whether or not each also changed. Grouping is by day so a script that writes a different timestamp on every record is still caught. `withEvidence` says how many of the group also changed something. A bulk bump is a request to look closer, not a finding that anything is wrong.

**`backward`:** the stamp moved earlier. **`extendedDeadlines`:** the expiry moved later and no source field changed. A removed expiry is `unknown` (`expiry-removed`), and a newly added expiry is not reported.

**Records:** only a record present exactly once and readable in both snapshots is compared. A record that is new in `after` is still checked for a future date or an unusable stamp, but a new record cannot be a stamp-only move.

## Limits and errors

Everything wrong with **the whole call** throws `ParityError` (it has a `code`):

| Code | When |
| --- | --- |
| `bad-options` | A misspelled or unknown option, a wrong type, a missing required option, an invalid `now`. |
| `bad-input` | An argument that is not an array or plain object (`null`, a string, a `Map`), or text that is not a string. |
| `unreadable-input` | Reading the argument itself threw (a revoked Proxy, a throwing `length`). |
| `too-large` | A limit was passed. |
| `bad-registry` | A malformed hand-typed-constant registry. |

Everything wrong with **one record** is reported in `invalid` instead, so one bad record never hides the others. Reasons: `empty-dataset`, `hole`, `not-an-object`, `not-a-plain-object`, `missing-key`, `bad-key`, `key-mismatch`, `unreadable`, `unsupported-value`, `too-deep`, `cycle`.

An **empty canonical set** (or empty snapshot) is reported as `invalid` with reason `empty-dataset` unless `allowEmpty: true`, because an empty file loaded by mistake would otherwise pass.

Limits (`limits: { maxRecords, maxNodes, maxDepth }`):

| Limit | Default | Meaning |
| --- | --- | --- |
| `maxRecords` | 1,000,000 | Most records in one dataset. |
| `maxNodes` | 10,000,000 | Most values read in one call. Arrays and objects are capped at a fifth of this. |
| `maxDepth` | 64 (at most 1000) | Deepest nesting inside one record. |

Reading is iterative over records and bounded by these limits, so a 100,000-level nested value or a value that shares sub-objects to blow up exponentially ends in `too-deep` or `too-large`, not a stack overflow or a hang. Comparison itself never recurses deeper than `maxDepth`.

## What it does not do

- **It does not know which copy is right.** `canonical` is the copy you call canonical. If the canonical set is the wrong one, the mirror will be reported as wrong.
- **It does not prove a human rechecked anything.** It flags stamps that moved with no evidence of a recheck in the data. A stamp that moved alongside a changed value passes, even if the change was cosmetic or made by a script. A reviewer name that changes counts as evidence even if nobody reviewed.
- **It does not check that a value is true or current.** It checks that copies agree and that dates moved for a visible reason.
- It does not report a value that changed while its review date did not move. That is a different question.
- It does not read files, call APIs, parse CSV or YAML, or schedule anything. You load the data and pass it in.
- It compares JSON-shaped data. Class instances, `Map`, `Set`, functions and symbols are reported as invalid, not converted.
- Look-alike key detection uses a short list of letters and the Unicode normalization built into your runtime. It will not catch every homoglyph.
- A `Date` whose `Symbol.toStringTag` has been overwritten is not recognized as a Date and is reported as an unsupported value.
- It makes no legal, regulatory or compliance claim. It is a data check.

## Using it in CI

```ts
import { readFileSync } from 'node:fs';
import { compareMirror } from 'parity-kit';

const canonical = JSON.parse(readFileSync('data/programs.json', 'utf8'));
const mirror = JSON.parse(readFileSync('extension/lib/valuations.json', 'utf8'));
const result = compareMirror(canonical, mirror, { reviewedField: 'lastReviewed' });
if (!result.ok) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
```

Treat `status: 'unknown'` as a failure too. `ok` already does. A gate that passes when it could not read something is not a gate.

## Development

```sh
npm install
npm run verify      # lint, typecheck, tests, build, packaging checks
```

See `ENGINEERING.md` for the design rules and `CONTRIBUTING.md` for how to change behavior.
