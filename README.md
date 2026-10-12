# Parity Kit

A small, zero-dependency TypeScript library for two questions about data you publish more than once:

1. **Does every copy of a fact still match its source of truth?** (`compareMirror`, `findHandTypedConstants`)
2. **Was a review date earned by an actual recheck?** (`auditReviewStamps`)

It is for developers who keep a source-of-truth data file and publish copies of it (a website, an extension, docs) and want a CI check that fails when the copies drift or a review date moves without a recheck. You hand it data. It hands back a plain report of what differs. It reads no files, makes no network calls and reads no clock unless you give it a time. It does not decide which copy is right, prove that a person rechecked anything, or check that a value is true (see "What it does not do"). Part of the honesty kits, a family of small checks for the claims a product makes.

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
  "noFieldsCompared": false,
  "missing": ["bilt"],
  "extra": ["cap-one"],
  "changed": [
    { "id": "chase-ur", "field": "baselineCpp", "change": "different", "canonical": 1.25, "mirror": 1 }
  ],
  "stampHidesDrift": [
    { "id": "chase-ur", "reviewedValue": "2026-06-08", "fields": ["baselineCpp"] }
  ],
  "duplicateKeys": [],
  "unknownFields": [],
  "suspectKeys": [],
  "invalid": []
}
```

Read it as: the extension lacks `bilt`, has a `cap-one` the source does not, disagrees on `chase-ur`'s value, and the shared review date `2026-06-08` is sitting on top of that disagreement.

### Files with one review date for the whole file

Real files often keep one `reviewed` date next to a `programs` array, not a date on every record. `compareMirror` compares records, so copy the file date onto each record first and pass the arrays, not the whole files:

```ts
const stamp = (file: { reviewed: string; programs: object[] }) =>
  file.programs.map((p) => ({ ...p, reviewed: file.reviewed }));

const result = compareMirror(stamp(programsFile), stamp(extensionFile), { reviewedField: 'reviewed' });
// result.stampHidesDrift: [{ id: 'chase-ur', reviewedValue: '2026-06-08', fields: ['baselineCpp'] }]
```

With the 1.25 versus 1.0 example above, both files say `reviewed: "2026-06-08"` and `chase-ur` differs, so `stampHidesDrift` names it. If you forget the copy, `reviewedField: 'reviewed'` matches no record and the result reports `unknownFields: ['reviewed']` instead of quietly doing nothing. Passing the whole files makes each top-level property a record to read and reports them as `invalid`. The same copy works for `auditReviewStamps` snapshots.

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
  ignoreFields: ['updatedAt'], // see the note below
});
// audit.stampOnly, audit.bulkBump, audit.future, audit.backward, audit.unknown, ...
```

If a field changes by itself whenever a record is touched (`updatedAt`, a version counter), list it in `ignoreFields`. Otherwise it counts as evidence of a recheck and hides a stamp-only bump. A name in `ignoreFields` that matches no record is reported in `unknownFields` and the audit is `unknown`, so a typo cannot quietly turn the exclusion off.

## The exports

`compareMirror`, `findHandTypedConstants`, `auditReviewStamps` and `ParityError`, plus the option, result and entry types (`MirrorOptions`, `MirrorResult`, `StampOptions`, `StampAudit`, `RegisteredConstant`, `HandTypedMatch`, `Limits`, `Status` and the rest of the report entry types). `api-surface.json` lists the runtime names and `verify:package` checks them against the packed tarball.

### `compareMirror(canonical, mirror, options?)`

Compares a canonical set to one mirror. Each argument is an **array of records** or an **object keyed by id**.

| Option | Default | Meaning |
| --- | --- | --- |
| `key` | `"id"` | Field that identifies a record in an array. In an object keyed by id the property name is the id, and a record that also has this field must agree with it (see Keys). |
| `fields` | every own enumerable field of either record | Compare only these fields. Must name at least one field, and at least one must not be in `ignoreFields`; an empty list, or a list that `ignoreFields` cancels entirely, throws `bad-options` because it would compare nothing and always pass. |
| `ignoreFields` | none | Fields left out of the comparison. A name that appears in no record lands in `unknownFields`. |
| `reviewedField` | none | The review-date field. Turns on `stampHidesDrift`. It is always compared, even when `fields` does not list it, so a mirror with a different review date is never silent. `ignoreFields` can still remove it. |
| `numberTolerance` | `0` | Two finite numbers are equal when they differ by at most this, plus a few units of binary rounding error (see How values are compared). |
| `allowEmpty` | `false` | Let an empty canonical set pass. |
| `foldCase` | `true` | Fold upper and lower case when looking for look-alike keys. |
| `limits` | see Limits | `maxRecords`, `maxNodes`, `maxDepth`, `maxKeyLength`. |

Returns:

| Field | What it holds |
| --- | --- |
| `ok` | `true` only when every list below is empty. |
| `status` | `flagged` (positive evidence of drift), `unknown` (nothing flagged, but something could not be checked), or `ok`. |
| `compared` | Records present once on both sides and compared field by field. |
| `noFieldsCompared` | `true` when records were matched but `ignoreFields` removed every field they carry, so no field was checked. The result is `unknown`, never `ok`. Records that carry only an id are an honest presence check and do not set it. |
| `missing` | Keys in the canonical set that the mirror lacks. |
| `extra` | Keys in the mirror that the canonical set lacks. |
| `changed` | `{ id, field, change, canonical, mirror }`. `change` is `different`, `missing-in-mirror` or `extra-in-mirror`. |
| `stampHidesDrift` | `{ id, reviewedValue, fields }` when both copies carry the same review date but other fields differ. |
| `duplicateKeys` | `{ side, id, positions }` for a key used by more than one record on one side. Those records are not compared. |
| `unknownFields` | Names you selected or ignored (`fields`, `reviewedField`, `ignoreFields`) that appear in no readable record on either side. A misspelled name lands here and the result is never `ok`. |
| `suspectKeys` | `{ skeleton, keys: [{ side, key }] }` for keys that look alike but are not identical. |
| `invalid` | Records (or a whole dataset) that could not be read, with a reason. |

`status` is `flagged` when `missing`, `extra`, `changed`, `stampHidesDrift` or `duplicateKeys` has anything in it. Otherwise it is `unknown` when `noFieldsCompared` is `true` or `invalid`, `suspectKeys` or `unknownFields` has anything in it. Otherwise it is `ok`.

### `findHandTypedConstants(text, registry)`

Finds places where a registered constant is typed by hand, so the caller can import the value instead. The registry is a non-empty array of `{ id, value, forms? }` entries, and an entry may carry no other key.

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
| `ignoreFields` | none | Fields that never count as evidence, such as an automatic `updatedAt`. A name that appears in no record lands in `unknownFields`. |
| `now` | none | A `Date`, epoch milliseconds, or an ISO 8601 timestamp with an explicit zone. Without it, future dates are not checked and no clock is read. |
| `bulkThreshold` | `10` | A bulk bump is more than this many records moving to one new day. |
| `key`, `allowEmpty`, `foldCase`, `limits` | as above | |

Returns `ok`, `status`, `compared`, and:

| Field | What it holds |
| --- | --- |
| `noOverlap` | `true` when both snapshots have keyed records and not one key appears in both, so nothing was compared. Renaming every id, or auditing the wrong two files, looks exactly like this. The result is `unknown`, never `ok`. |
| `stampOnly` | `{ id, from, to }`: the review date moved later and no value, source or reviewer changed. |
| `bulkBump` | `{ summary, count, withEvidence, withoutEvidence, date, ids }`: more than `bulkThreshold` records moved to the same new UTC day. Read `summary` first. |
| `future` | `{ id, value }`: a review date later than `now`. |
| `backward` | `{ id, from, to }`: a review date moved earlier. |
| `extendedDeadlines` | `{ id, from, to }`: the expiry moved later and no source field changed. |
| `unknown` | `{ id, side, field, reason, value? }`: a date that cannot be judged. Never a pass. |
| `unknownSummary` | `unknown` counted per `{ field, reason, count }`, so thousands of entries can be read at a glance. |
| `unknownFields` | Configured names (`reviewedField`, `sourceFields`, `reviewerField`, `expiryField`, `valueFields`, `ignoreFields`) that appear in no readable record in either snapshot. A misspelled name lands here and the result is never `ok`. |
| `added`, `removed` | Keys only in `after` or only in `before`. Informational. |
| `duplicateKeys`, `suspectKeys`, `invalid` | As in `compareMirror`. |

`status` is `flagged` when `stampOnly`, `bulkBump`, `future`, `backward`, `extendedDeadlines` or `duplicateKeys` has anything in it. Otherwise it is `unknown` when `noOverlap` is `true` or `unknown`, `invalid`, `suspectKeys` or `unknownFields` has anything in it. Otherwise it is `ok`.

## Exact rules

### What is read

- A dataset is an **array of records** or a **plain object keyed by id**. In an object, the property name is the id and the order Proxy traps report keys in never matters, because keys are sorted.
- A record must be a **plain object** (its prototype is `null` or `Object.prototype`, from any realm). A class instance, `Map`, `Date` or array in a record slot is reported as `invalid`.
- Only **own enumerable string-keyed properties** are read (or, with `fields`, the named own properties). Inherited properties, symbol keys and non-enumerable properties are ignored. `toJSON`, `then`, `toString` and `valueOf` are never called.
- A **getter** is run once per read. A getter or Proxy trap that throws makes that record `invalid` with reason `unreadable`; the other records are still compared.
- An object property whose value is `undefined` is treated as absent, the way JSON treats it.
- Values may be strings, finite or non-finite numbers, booleans, bigints, `null`, `Date`s, arrays and plain objects, nested. A function, symbol, class instance, `Map`, typed array or other exotic object inside a record makes the record `invalid` with reason `unsupported-value`. A cycle is `cycle`. Nesting deeper than `maxDepth` is `too-deep`.
- A `Date` is recognized by its internal slot, so a `Date` from another realm works and an object that merely has a `getTime` method does not.
- An object with **at least one own enumerable property** is plain data, if its prototype is plain. An object with **no own enumerable property** is checked for being a built-in whose prototype was replaced with `null` or `Object.prototype`. A `Map`, `Set`, `RegExp`, `ArrayBuffer`, typed array, `Promise`, `WeakMap`, boxed primitive or `Error` found that way is `unsupported-value`, and a Date found that way is a Date. The check calls a captured built-in method that only succeeds on a real instance; it never reads `Symbol.toStringTag`, `constructor` or the prototype, copies nothing, and costs about 0.2 ms of CPU per empty-looking object such as `{}` (measured at 170 to 250 µs on a heavily loaded machine; no quiet-machine figure has been verified). The cost is linear in the number of such objects, so 100,000 records with an empty `tags: {}` or `meta: {}` column on each side cost roughly 20 to 50 seconds of CPU, and a populated object, `[]`, `null` or `''` costs nothing extra. If a column like that is not what you are checking, select the columns you do check with `fields`: unselected values are never read, and the probe is skipped (5,000 records took 2.1 s with the empty column read and 0.1 s with `fields: ['name']`). `ignoreFields` does not help, because an ignored field is still read. An empty object whose prototype is neither `null` nor this realm's untouched `Object.prototype` cannot be ruled out, so it is also `unsupported-value`; that includes an empty object from another realm, while an object with properties from another realm is fine.
- **The remaining exotic-object gap.** Proxies are read through their traps, and host objects or built-ins disguised with a replaced prototype **and** their own enumerable properties are read as plain data. This is a documented limit, not a promised check.
- Reading a value never runs a getter on a prototype and never reads a property to classify it. Nothing is copied or cloned to classify it either, so classifying an object cannot run an excluded getter, cannot rewrite another record, and costs no memory proportional to its contents. Every property that is read is read once: the key, each selected field and the reviewed field are each looked up a single time, and the value used is the one from that lookup. The only caller code that can run is an own getter on a property being read (once), a Proxy trap, and, for a real `Promise`, the `constructor` lookup that `then` performs.
- A Promise is recognized by calling `then`, which then looks up `constructor`. `then` is only called when that lookup cannot run caller code: the object has no own `constructor` (or an own data one holding `undefined`) and its prototype is `null` or the untouched `Object.prototype`. Otherwise the object is `unsupported-value`, never plain data. On Node before 24, which has no `Error.isError`, an Error is recognized through `Object.prototype.toString`, used only under the same kind of precondition (no own `Symbol.toStringTag`, a `null` or untouched `Object.prototype`); otherwise the object is `unsupported-value`. If your Proxy has a `get` trap, that fallback path can run it.
- A key field is left out of the compared fields unless you ask for it: name it in `fields`, or use it as `reviewedField`. Then it is read like any other field.
- Results never alias your input. Reported values are copies (objects have a `null` prototype).

### How values are compared

- Strings are compared exactly: NFC and NFD differ, a trailing space differs, a zero-width character differs.
- Types are strict: `1.25` and `"1.25"` differ, `1` and `1n` differ, `null` and `0` differ.
- Numbers: `0` equals `-0`. `NaN` equals `NaN`. With `numberTolerance`, two finite numbers are equal when `|a - b| <= tolerance + 8 * Number.EPSILON * max(|a|, |b|, tolerance)`. The second term is a few units of binary rounding error, so a difference that is exactly the tolerance in decimal (`1.25` and `1.15` at `0.1`) is equal, while a real extra cent or tenth is still different. It is not added when `numberTolerance` is `0`. Infinities are equal only to the same infinity. Without a tolerance the comparison is exact, so `1.25` and `1.0000001` differ.
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
- A record whose **key** cannot be read (a getter or Proxy trap on the key field threw) has no identity, so it is `invalid` with reason `unreadable`. It might be any record the other side lacks, so those ids are not claimed as `missing` or `extra` while unreadable records could account for all of them: `[{ id: 'a' }]` against a mirror whose only record has a throwing `id` getter is `unknown`, not `missing: ['a']`. When more ids are absent than there are unreadable records, the surplus is real evidence and they are all listed.
- In an object-keyed dataset, a record that also carries the key field must agree with its property name, otherwise it is `key-mismatch`. If your records carry an unrelated field that happens to be called `id` (a numeric database id), pass `key` naming a field they do not have, for example `key: 'recordKey'`; the real `id` field is then compared like any other field. The `key-mismatch` detail names the `key` option for this reason.

### `stampHidesDrift`

Needs `reviewedField`. It is reported for a record when other compared fields differ and both copies carry a present, equal review value. Two strings that parse as the same ISO 8601 instant count as equal. If the review values differ, the review field itself shows up in `changed` and `stampHidesDrift` stays empty, because the stamps are not hiding anything.

### Hand-typed constants

- A **numeric** `value` is found by numeric value at token boundaries, so `1.25` also finds `1.250` and `$1.25` and `1.25x`.
- A number token is digits with optional `,` or `_` thousands groups of exactly three digits, an optional `.` fraction and an optional exponent. `1,250` and `1_250` are 1250, and `1_000_000` (TypeScript, Python, Rust, Java) is one million. A comma that does not start a three-digit group ends the token, so `chase,1.25,0.5` has three numbers. An underscore that does not start a three-digit group is glued to the number (`1_2`, `1_250_x`), so nothing is found there. Only the whole-number part takes separators; `0.000_001` is not read.
- **Dots as range or ellipsis.** A `.` right after another `.` is punctuation, not a decimal point: `5` is found in `range 1..5`, `100` in `{1..100}`, `2025` in `2020..2025` and `wait...5`, and `0.5` is not found in any of them. A single dot still starts a fraction (`.5` after a space or bracket is 0.5), so `x.5` is skipped as before.
- It does **not** match inside a longer number or identifier: `11.256`, `21.25`, `1.255`, `0.125`, a dotted run such as `1.25.3` or `10.1.25.7`, `v1.25`, `x_1.25`, `abc1.25`, `1.25_x`, or a zero-padded run such as `08` or `007`. Letters after a number are fine (`1.25x`, `1.25c`). A number wrapped in underscores, as Markdown italics (`_1.25_`), is read as part of an identifier and skipped; add the literal text to `forms` (`"_1.25_"`) if you need it.
- **Unspaced scripts do not glue.** Letters of scripts that are written without spaces between words (Han, Hiragana, Katakana, Hangul, Thai, Lao, Khmer, Myanmar) do not glue to a number or to a literal form beside them, so `1.25` is found in `每点价值1.25美分`, `還元率1.25倍`, `ポイントあたり1.25円`, `값은1.25입니다` and `อัตรา1.25`. Other scripts glue like Latin letters: `abc1.25`, `значение1.25` and `القيمة1.25` are skipped, and a decimal digit of any script, Thai digits included, still makes a longer number.
- A `-` is part of the number when it follows the start of the text, whitespace, an opening bracket or an operator. So `-1.25` is minus 1.25 and does not match a registered `1.25`, while `x-1.25` reads as 1.25.
- A **string** `value`, and every entry in `forms`, is found as exact, case-sensitive text, and shares the number boundary rules above. A match may not begin or end strictly inside a number: `250` is not found in `1,250`, `8` and `1e` are not found in `1e+8`, `1.25` is found in `1.25,0.5`. A form that starts or ends with a digit must start or end exactly where a number starts or ends, with no letter, digit, underscore or non-ASCII decimal digit glued on (`v1.25`, `1.25_x` and `1.25６` are not hits). A form that starts or ends with anything else only has to not touch another letter, digit or underscore. A form is literal text and ignores sign: the form `1.25` is found inside `-1.25`, while the number `1.25` is not (it is minus 1.25). Register `-1.25` as its own value if you need the sign.
- **Commas.** A comma followed by exactly three digits (and then a non-digit) continues a number as a thousands separator, so `1,250` is one number, 1250, and `1,250,5` is 1250 and 5. Any other comma ends the number, so `1,25` is 1 and 25, `1.25,0.5` is 1.25 and 0.5, and `12,34,567` is 12 and 34567. A list written like `1,250` is therefore read as one number; write a space after the comma. Text you cannot reformat is not supported when it packs three-digit integers between bare commas: in the minified JSON array `[100,200,300]` or the CSV row `ur,125,300,12` the digits run together (read as 100200300 and 125300), so `200` and `300` are not found. Cells with decimals or other digit counts are fine. Parse such data and compare it with `compareMirror` instead of scanning it as text.
- A non-ASCII decimal digit (full-width, Arabic-Indic, Devanagari and so on) next to a number makes it part of a longer number, so nothing is found. Only ASCII digits spell a number.
- If a number hit and a literal hit for the same constant overlap, the longer one is kept, and the number wins a tie. Nothing else is suppressed: two overlapping literal hits (`foo-bar` and `bar-baz` in `foo-bar-baz`) are both reported. The same text listed more than once, for one constant or several, is one pattern, so repeating it adds no work; each constant that lists it still gets its hit.
- Scanning is linear in the length of the text for a fixed registry (an Aho-Corasick automaton for literal forms, one pass for numbers). Sorting the matches adds a log factor in the number of matches. Many heavily overlapping forms multiply the number of raw hits by the registry size.
- Tiny integers are noisy. A registered `8` matches every standalone `8`. Prefer a `forms` entry with context such as `"8 points"`.
- Registry mistakes throw `ParityError` with code `bad-registry`: duplicate ids, an empty id or form, a non-finite number, a value that is not a number or non-empty string, a hole in the array, an entry key other than `id`, `value` and `forms` (so `form` or `note` is refused and named, never silently dropped), and an empty registry (a registry file that failed to load must not look like "no hand-typed copies"). Empty text is fine and gives `[]`.
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

**Expiry values.** When `expiryField` is set, every expiry value that is present in `after` must be a usable date (same rules as above), whether or not it moved. A garbage, numeric, zoneless, empty or **boolean** one is `unknown` (reasons `unparseable-date`, `not-a-string`, `zoneless-timestamp`, `missing`), even when it is unchanged. A record with no expiry field at all is not reported. A data source that writes `false` for "no deadline" will produce one `unknown` entry per such record: drop or replace those values before the audit (for example `eol: r.eol === false ? undefined : r.eol`), or read `unknownSummary` for the counts.

**Records with no stamp.** A record whose `reviewedField` is absent in `after` is `unknown` with reason `missing`, once per record. That is the honest answer (nothing can be judged for it) and it keeps `ok` false. If a data source stamps only some records, audit only those, or read `unknownSummary` (`{ field, reason, count }`) instead of the full list.

**`stampOnly`:** the stamp moved later and there is no evidence.

**`bulkBump`:** more than `bulkThreshold` records moved later to the same new **UTC calendar day**, whether or not each also changed. Grouping is by day so a script that writes a different timestamp on every record is still caught. `withEvidence` says how many of the group also changed something. A bulk bump is a request to look closer, not a finding that anything is wrong. Read `summary` first: it says how many of the records also changed a value, source or reviewer (`withEvidence`) and how many did not (`withoutEvidence`, which are also in `stampOnly`). A bump with `withoutEvidence: 0` is an automated but evidenced update, such as a bot refreshing many records at once; it still sets `status` to `flagged`, because a person should confirm the bot's change is real. If you accept that for a source, waive only the evidenced bulk bumps and keep every other finding failing:

```ts
import type { StampAudit } from 'parity-kit';

const acceptEvidencedBulk = (a: StampAudit) =>
  a.ok ||
  (a.bulkBump.every((b) => b.withoutEvidence === 0) && !a.noOverlap &&
    a.stampOnly.length === 0 && a.future.length === 0 && a.backward.length === 0 &&
    a.extendedDeadlines.length === 0 && a.unknown.length === 0 && a.unknownFields.length === 0 &&
    a.duplicateKeys.length === 0 && a.suspectKeys.length === 0 && a.invalid.length === 0);
```

Checking only `stampOnly` and `bulkBump` is not enough: missing stamps, invalid records and future dates would then pass.

**`backward`:** the stamp moved earlier. **`extendedDeadlines`:** the expiry moved later and no source field changed. A removed expiry is `unknown` (`expiry-removed`), and a newly added expiry is not reported.

**Records:** only a record present exactly once and readable in both snapshots is compared. A record that is new in `after` is still checked for a future date or an unusable stamp, but a new record cannot be a stamp-only move. If both snapshots have records and no key is shared, nothing could be compared, so `noOverlap` is `true` and the status is `unknown` (an empty snapshot allowed by `allowEmpty` is not that case). One shared key is enough to clear `noOverlap`; the kit does not judge how large the overlap should be.

## Limits and errors

Everything wrong with **the whole call** throws `ParityError` (it has a `code`):

| Code | When |
| --- | --- |
| `bad-options` | A misspelled or unknown option, a wrong type, a missing required option, an invalid `now`. |
| `bad-input` | An argument that is not an array or plain object (`null`, a string, a `Map`), or text that is not a string. |
| `unreadable-input` | Reading the argument itself threw (a revoked Proxy, a throwing `length`). |
| `too-large` | A limit was passed. |
| `bad-registry` | A malformed hand-typed-constant registry. |

Everything wrong with **one record** is reported in `invalid` instead, so one bad record never hides the others. Reasons: `empty-dataset`, `hole`, `not-an-object`, `not-a-plain-object`, `missing-key`, `bad-key`, `key-too-long`, `key-unnormalizable`, `key-mismatch`, `unreadable`, `unsupported-value`, `too-deep`, `cycle`.

An **empty canonical set** (or empty snapshot) is reported as `invalid` with reason `empty-dataset` unless `allowEmpty: true`, because an empty file loaded by mistake would otherwise pass.

Limits (`limits: { maxRecords, maxNodes, maxDepth, maxKeyLength }`):

| Limit | Default | Meaning |
| --- | --- | --- |
| `maxRecords` | 1,000,000 | Most records in one dataset. |
| `maxNodes` | 10,000,000 | Most values read in one call, counting every probe for a named field whether or not the record has it. Arrays and objects are capped at a fifth of this. |
| `maxKeyLength` | 4,096 (at most 1,048,576) | Longest string key, in UTF-16 units. A longer key, or a key with a run of more than 32 combining marks, counted after compatibility decomposition (Unicode normalization is quadratic in such a run), makes its record `invalid` with `key-too-long` or `key-unnormalizable`; it is never analyzed for look-alikes. Key lengths count against `maxNodes`. In an id-keyed object the name is checked before its getter runs. |
| `maxDepth` | 64 (at most 1000) | Most levels of arrays and objects inside one field of a record. A container directly in a field is level 1, so `maxDepth: 1` allows `{ v: {} }` and `{ v: [1, 2] }` but not `{ v: { x: {} } }`. |

Reading is iterative over records and bounded by these limits, so a 100,000-level nested value or a value that shares sub-objects to blow up exponentially ends in `too-deep` or `too-large`, not a stack overflow or a hang. Comparison itself never recurses deeper than `maxDepth`.

## What it does not do

- **It does not know which copy is right.** `canonical` is the copy you call canonical. If the canonical set is the wrong one, the mirror will be reported as wrong.
- **It does not prove a human rechecked anything.** It flags stamps that moved with no evidence of a recheck in the data. A stamp that moved alongside a changed value passes, even if the change was cosmetic or made by a script. A reviewer name that changes counts as evidence even if nobody reviewed.
- **It does not check that a value is true or current.** It checks that copies agree and that dates moved for a visible reason.
- It does not report a value that changed while its review date did not move. That is a different question.
- It cannot tell that a field you did not name should have been ignored. In the audit, a field that changes on every edit by itself (`updatedAt`, a version counter, an ETag) counts as evidence of a recheck unless you list it in `ignoreFields`, so such a field makes a stamp-only bump look earned. A misspelled `ignoreFields` name is reported in `unknownFields`, and the audit is then `unknown`, never `ok`.
- It does not read files, call APIs, parse CSV or YAML, or schedule anything. You load the data and pass it in.
- It compares JSON-shaped data. Class instances, `Map`, `Set`, functions and symbols are reported as invalid, not converted.
- It cannot tell a built-in with a replaced prototype and its own enumerable properties from a plain object (see "What is read").
- Look-alike key detection uses a short list of letters and the Unicode normalization built into your runtime. It will not catch every homoglyph.
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

## Recipes

### A mirror that carries only some of the records

There is no subset option, on purpose: a record that quietly dropped out of the mirror must still be reported. Filter the canonical set to the ids the mirror is meant to carry, taking that list from somewhere other than the mirror itself (a build manifest, a constant in your code). Records the mirror has that the canonical set lacks are still reported as `extra`.

```ts
const shipped = new Set(['chase-ur', 'amex-mr']);
const result = compareMirror(
  programs.filter((p) => shipped.has(p.id)),
  extension,
);
```

### Two translation files: do the keys they share still agree?

Passing whole nested locale files makes each top-level section a record and reports every translation as `different`. Compare what a translation must keep instead: build one record per message key, keep only the keys both files have and the translated (non-empty) ones, and compare the placeholders and tags each message contains.

```ts
const tokens = (text: string) => (text.match(/\{[^}]*\}|<\/?\w+>/g) ?? []).sort().join(' ');
const rows = (messages: Record<string, string>, keys: string[]) =>
  keys.map((id) => ({ id, tokens: tokens(messages[id] ?? '') }));

const en: Record<string, string> = { greeting: 'Hello {name}', save: 'Save <b>now</b>', draft: 'Draft' };
const fr: Record<string, string> = { greeting: 'Bonjour', save: 'Enregistrer <b>maintenant</b>', draft: '' };
const shared = Object.keys(en).filter((key) => Object.hasOwn(fr, key) && fr[key] !== '');
const result = compareMirror(rows(en, shared), rows(fr, shared));
// result.changed: the French greeting dropped {name}
```

Keys one file lacks, and empty strings that mean "not translated yet", are a separate question; this check leaves them out on purpose.

### Case-sensitive keys

By default two keys that differ only by case (`&AElig;` and `&aelig;`) are look-alikes and make the result `unknown`. For key sets where case carries meaning, such as HTML entity names, pass `foldCase: false`. The trade-off: uppercase look-alike letters from another alphabet (a Cyrillic `А` for a Latin `A`) are then no longer grouped. A renamed key still shows up as `missing` plus `extra`, so nothing passes.

```ts
const entities = [{ id: '&AElig;', cp: 198 }, { id: '&aelig;', cp: 230 }];
const strict = compareMirror(entities, entities.map((e) => ({ ...e })), { foldCase: false });
// strict.ok is true; without foldCase: false the result is unknown with one suspectKeys group
```

### Known look-alike keys and known findings

Some real data keeps two keys that differ only by a no-break space, or one record with a date that is known to be wrong. The kit has no allow list or baseline: a waiver is a decision a person made, so it belongs in your repository where it can be reviewed. Filter the result yourself, and keep every other list failing:

```ts
import type { MirrorResult } from 'parity-kit';

const knownTwins = new Set(['saving ...']); // the `skeleton` of each reviewed group in result.suspectKeys
const acceptKnownTwins = (r: MirrorResult) =>
  r.ok ||
  (r.missing.length === 0 && r.extra.length === 0 && r.changed.length === 0 &&
    r.stampHidesDrift.length === 0 && r.duplicateKeys.length === 0 && r.invalid.length === 0 &&
    r.unknownFields.length === 0 && !r.noFieldsCompared &&
    r.suspectKeys.every((group) => knownTwins.has(group.skeleton)));
```

The same pattern works for `auditReviewStamps`: drop the entries whose `id` is on a reviewed list (for example `audit.future.filter((f) => !knownFutureIds.has(f.id))`) and require every other list to be empty, as in the bulk-bump gate above.

## Development

```sh
npm ci
npm run verify      # lint, typecheck, tests, build, packaging checks
npm run attw        # check the packed types resolve for ESM consumers
npm run audit:dependencies
```

See `ENGINEERING.md` for the design rules and `CONTRIBUTING.md` for how to change behavior.
