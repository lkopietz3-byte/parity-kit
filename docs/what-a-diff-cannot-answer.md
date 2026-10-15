# What a diff cannot answer

A generic object diff answers one question: what differs between these two
values. parity-kit answers a different one: can I trust that this copy still
matches its source, and was this review date earned? The two questions overlap
on the first case below and then part ways.

Twelve cases follow. Each one runs the same data through `deep-diff` 1.0.2 and
`microdiff` 1.6.0 (the two are used as stand-ins for any generic diff) and
through parity-kit 0.1.0, and prints what each says. Two cases are ties, and
the rest show something the diff has no way to say. Every block is run by
`test/what-a-diff-cannot-answer.test.ts`, which also compares each printed
result with the text under it, so this page cannot drift from the code.

To run a case yourself, install `parity-kit`, `deep-diff` and `microdiff` in a
scratch project, save the block as `case.mjs` and run `node case.mjs`.

Where a case says "the check a team writes around a diff", it is a few lines of
the kind that are easy to write: pick the fields to compare, or ignore a list of
fields. A diff library has no field list of its own; the cases show what happens
once you add one.

## 1. A value that really differs: a diff is as good

The mirror says 1.0 and the source says 1.25. This is the diff libraries' home ground.

```js
import { compareMirror } from 'parity-kit';
import deepDiff from 'deep-diff';
import microdiff from 'microdiff';

const canonical = [{ id: 'chase-ur', baselineCpp: 1.25 }];
const mirror = [{ id: 'chase-ur', baselineCpp: 1.0 }];

console.log('deep-diff :', deepDiff.diff(canonical, mirror).length, 'difference');
console.log('microdiff :', microdiff(canonical, mirror).length, 'difference');
const kit = compareMirror(canonical, mirror);
console.log('parity-kit:', kit.status, JSON.stringify(kit.changed.map((c) => [c.id, c.field, c.canonical, c.mirror])));
```

```text
deep-diff : 1 difference
microdiff : 1 difference
parity-kit: flagged [["chase-ur","baselineCpp",1.25,1]]
```

A tie. All three find the one difference. Use whichever is already in your project; the kit adds nothing here except that it already knows which side is the source.

## 2. Identical copies: a diff is as good

Nothing differs.

```js
import { compareMirror } from 'parity-kit';
import deepDiff from 'deep-diff';
import microdiff from 'microdiff';

const canonical = [{ id: 'chase-ur', baselineCpp: 1.25 }];
const mirror = [{ id: 'chase-ur', baselineCpp: 1.25 }];

console.log('deep-diff :', (deepDiff.diff(canonical, mirror) ?? []).length, 'differences');
console.log('microdiff :', microdiff(canonical, mirror).length, 'differences');
const kit = compareMirror(canonical, mirror);
console.log('parity-kit:', JSON.stringify({ status: kit.status, ok: kit.ok, compared: kit.compared }));
```

```text
deep-diff : 0 differences
microdiff : 0 differences
parity-kit: {"status":"ok","ok":true,"compared":1}
```

A tie again. The kit also reports how many records it compared, which is 1 here; the next cases show why that number matters.

## 3. A misspelled field name compared nothing

You want to check `baselineCpp` only, and you mistype it. "The check a team writes around a diff" is a field list and a diff of the picked fields.

```js
import { compareMirror } from 'parity-kit';
import deepDiff from 'deep-diff';
import microdiff from 'microdiff';

const pick = (records, fields) => records.map((r) => Object.fromEntries(fields.map((f) => [f, r[f]])));
const compareFields = (a, b, fields) => deepDiff.diff(pick(a, fields), pick(b, fields)) ?? [];

const canonical = [{ id: 'chase-ur', baselineCpp: 1.25 }];
const mirror = [{ id: 'chase-ur', baselineCpp: 1.0 }];

console.log('wrapper, spelled right:', compareFields(canonical, mirror, ['baselineCpp']).length, 'difference');
console.log('wrapper, misspelled   :', compareFields(canonical, mirror, ['baselineCp']).length, 'differences  <- a pass');
const kit = compareMirror(canonical, mirror, { fields: ['baselineCp'] });
console.log('parity-kit, misspelled:', kit.status, JSON.stringify({ ok: kit.ok, unknownFields: kit.unknownFields }));
```

```text
wrapper, spelled right: 1 difference
wrapper, misspelled   : 0 differences  <- a pass
parity-kit, misspelled: unknown {"ok":false,"unknownFields":["baselineCp"]}
```

Both sides of the pick are `undefined`, so the wrapper sees two equal records and passes, while the copy is wrong. The kit looks for the name in the data, finds no record that has it, and reports `unknownFields` instead of an `ok`.

## 4. An empty field list compared nothing

The field list came from `Object.keys` of a schema that turned out to be empty.

```js
import { compareMirror } from 'parity-kit';
import deepDiff from 'deep-diff';
import microdiff from 'microdiff';

const pick = (records, fields) => records.map((r) => Object.fromEntries(fields.map((f) => [f, r[f]])));
const compareFields = (a, b, fields) => deepDiff.diff(pick(a, fields), pick(b, fields)) ?? [];

const canonical = [{ id: 'chase-ur', baselineCpp: 1.25 }];
const mirror = [{ id: 'chase-ur', baselineCpp: 1.0 }];
const fields = Object.keys({});

console.log('wrapper, no fields:', compareFields(canonical, mirror, fields).length, 'differences  <- a pass');
try {
  compareMirror(canonical, mirror, { fields });
} catch (error) {
  console.log('parity-kit, no fields:', error.name, error.code);
}
```

```text
wrapper, no fields: 0 differences  <- a pass
parity-kit, no fields: ParityError bad-options
```

The kit refuses to compare nothing: it throws `ParityError` with the code `bad-options`, so a green gate cannot come from an empty list.

## 5. A misspelled ignore list let an unearned stamp pass

The record's `lastReviewed` moved and so did an automatic `updatedAt`, and nothing else did. The wrapper treats any changed field outside the stamp and an ignore list as evidence that someone rechecked.

```js
import { auditReviewStamps } from 'parity-kit';
import deepDiff from 'deep-diff';

const before = [{ id: 'chase-ur', baselineCpp: 1.25, lastReviewed: '2026-01-01', updatedAt: '2026-01-01T00:00:00Z' }];
const after = [{ id: 'chase-ur', baselineCpp: 1.25, lastReviewed: '2026-10-01', updatedAt: '2026-10-01T00:00:00Z' }];

const evidence = (ignore) =>
  (deepDiff.diff(before, after) ?? []).filter((d) => !['lastReviewed', ...ignore].includes(String(d.path.at(-1)))).length;
console.log('wrapper, ignore updatedAt  :', evidence(['updatedAt']), 'evidence');
console.log('wrapper, ignore "updatedat":', evidence(['updatedat']), 'evidence  <- the stamp looks earned');

for (const ignoreFields of [['updatedAt'], ['updatedat']]) {
  const audit = auditReviewStamps(before, after, { reviewedField: 'lastReviewed', sourceFields: [], ignoreFields });
  console.log('parity-kit', JSON.stringify(ignoreFields), audit.status, JSON.stringify({ stampOnly: audit.stampOnly.length, unknownFields: audit.unknownFields }));
}
```

```text
wrapper, ignore updatedAt  : 0 evidence
wrapper, ignore "updatedat": 1 evidence  <- the stamp looks earned
parity-kit ["updatedAt"] flagged {"stampOnly":1,"unknownFields":[]}
parity-kit ["updatedat"] unknown {"stampOnly":0,"unknownFields":["updatedat"]}
```

With the typo the auto-touched field counts as evidence and the bump looks earned. The kit reports the name that matched no field, so the answer is `unknown` and not a pass. Spelled right, it flags the bump as `stampOnly`.

## 6. A review date moved and nothing else did

The stamp went from January to October. Was it earned?

```js
import { auditReviewStamps } from 'parity-kit';
import deepDiff from 'deep-diff';
import microdiff from 'microdiff';

const before = [{ id: 'chase-ur', baselineCpp: 1.25, lastReviewed: '2026-01-01' }];
const after = [{ id: 'chase-ur', baselineCpp: 1.25, lastReviewed: '2026-10-01' }];

console.log('deep-diff :', JSON.stringify(deepDiff.diff(before, after).map((d) => d.path.join('.'))));
console.log('microdiff :', JSON.stringify(microdiff(before, after).map((d) => d.path.join('.'))));
const audit = auditReviewStamps(before, after, { reviewedField: 'lastReviewed', sourceFields: [] });
console.log('parity-kit:', audit.status, JSON.stringify(audit.stampOnly));
```

```text
deep-diff : ["0.lastReviewed"]
microdiff : ["0.lastReviewed"]
parity-kit: flagged [{"id":"chase-ur","from":"2026-01-01","to":"2026-10-01"}]
```

A diff reports that a date changed. It has no idea the date is a review stamp, so it cannot say that no value, source or reviewer changed with it. The kit reports `stampOnly`: the date moved with no evidence in the data.

## 7. A shared review date sits on top of a changed value

The mirror claims the same review day as the source, and its value differs.

```js
import { compareMirror } from 'parity-kit';
import deepDiff from 'deep-diff';
import microdiff from 'microdiff';

const canonical = [{ id: 'chase-ur', baselineCpp: 1.25, lastReviewed: '2026-06-08' }];
const mirror = [{ id: 'chase-ur', baselineCpp: 1.0, lastReviewed: '2026-06-08' }];

console.log('deep-diff :', JSON.stringify(deepDiff.diff(canonical, mirror).map((d) => d.path.join('.'))));
console.log('microdiff :', JSON.stringify(microdiff(canonical, mirror).map((d) => d.path.join('.'))));
const kit = compareMirror(canonical, mirror, { reviewedField: 'lastReviewed' });
console.log('parity-kit:', kit.status, JSON.stringify(kit.stampHidesDrift));
```

```text
deep-diff : ["0.baselineCpp"]
microdiff : ["0.baselineCpp"]
parity-kit: flagged [{"id":"chase-ur","reviewedValue":"2026-06-08","fields":["baselineCpp"]}]
```

The diff finds the value. What it cannot say is that the two copies carry the same "reviewed on" date, so the date vouches for a copy that is wrong. `stampHidesDrift` names the record, the shared date and the fields that differ.

## 8. Ten and eleven records re-stamped on one day

The same bump applied to 10 and to 11 records, with no evidence. The default threshold is "more than 10 records on the same day".

```js
import { auditReviewStamps } from 'parity-kit';
import deepDiff from 'deep-diff';
import microdiff from 'microdiff';

const make = (n, stamp) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, cpp: 1 + i / 100, lastReviewed: stamp }));

for (const n of [10, 11]) {
  const before = make(n, '2026-01-01');
  const after = make(n, '2026-10-01');
  const audit = auditReviewStamps(before, after, { reviewedField: 'lastReviewed', sourceFields: [] });
  console.log(`${n} records: deep-diff ${deepDiff.diff(before, after).length}, microdiff ${microdiff(before, after).length} differences; parity-kit stampOnly ${audit.stampOnly.length}, bulkBump ${audit.bulkBump.length}`);
  if (audit.bulkBump[0]) console.log('  ', audit.bulkBump[0].summary);
}
```

```text
10 records: deep-diff 10, microdiff 10 differences; parity-kit stampOnly 10, bulkBump 0
11 records: deep-diff 11, microdiff 11 differences; parity-kit stampOnly 11, bulkBump 1
   11 records moved to 2026-10-01; 0 of 11 also changed a value, source or reviewer
```

A diff counts differences and cannot tell a bulk re-stamp from a hundred reviews. Every record here is flagged `stampOnly`; at 11 the kit also names the batch. The threshold of 10 is a default you can change (`bulkThreshold`), not a standard.

## 9. Every id was renamed between the two snapshots

A migration added `-v2` to every id and bumped every stamp. The wrapper pairs records by id and checks each pair, which is the obvious way to write it.

```js
import { auditReviewStamps } from 'parity-kit';
import deepDiff from 'deep-diff';

const before = [
  { id: 'chase-ur', cpp: 1.25, lastReviewed: '2026-01-01' },
  { id: 'amex-mr', cpp: 1.2, lastReviewed: '2026-01-01' },
];
const after = before.map((r) => ({ ...r, id: `${r.id}-v2`, lastReviewed: '2026-10-01' }));

const old = new Map(before.map((r) => [r.id, r]));
const pairs = after.filter((r) => old.has(r.id));
console.log('wrapper:', pairs.length, 'pairs checked,', pairs.filter((r) => r.lastReviewed !== old.get(r.id).lastReviewed).length, 'bumps found  <- a pass');
console.log('deep-diff, by position:', deepDiff.diff(before, after).length, 'differences');
const audit = auditReviewStamps(before, after, { reviewedField: 'lastReviewed', sourceFields: [] });
console.log('parity-kit:', audit.status, JSON.stringify({ compared: audit.compared, noOverlap: audit.noOverlap, added: audit.added.length, removed: audit.removed.length }));
```

```text
wrapper: 0 pairs checked, 0 bumps found  <- a pass
deep-diff, by position: 4 differences
parity-kit: unknown {"compared":0,"noOverlap":true,"added":2,"removed":2}
```

The wrapper checks zero pairs and finds zero problems. The diff by position shows noise and no explanation. The kit says that nothing could be compared (`noOverlap`), so the answer is `unknown`, never `ok`.

## 10. Two keys that look the same

The source id is `Café` as one character; the mirror's is `Café` as `e` plus a combining accent. They print identically.

```js
import { compareMirror } from 'parity-kit';
import deepDiff from 'deep-diff';

const canonical = [{ id: 'Caf\u00e9', price: 5 }];
const mirror = [{ id: 'Cafe\u0301', price: 5 }];
const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));

console.log('deep-diff :', JSON.stringify(deepDiff.diff(byId(canonical), byId(mirror)).map((d) => d.kind)), '(deleted and new: two records that never meet)');
const kit = compareMirror(canonical, mirror);
console.log('parity-kit:', kit.status, JSON.stringify({ missing: kit.missing.map(encodeURIComponent), extra: kit.extra.map(encodeURIComponent) }));
console.log('           ', kit.suspectKeys.length, 'look-alike group:', JSON.stringify(kit.suspectKeys.map((g) => g.keys.map((k) => `${k.side}:${encodeURIComponent(k.key)}`))));
```

```text
deep-diff : ["D","N"] (deleted and new: two records that never meet)
parity-kit: flagged {"missing":["Caf%C3%A9"],"extra":["Cafe%CC%81"]}
            1 look-alike group: [["canonical:Caf%C3%A9","mirror:Cafe%CC%81"]]
```

Both report a missing and an extra record. Only the kit says that the two keys would look the same to a person, so the "missing" record is probably the extra one in disguise. It lists them and never merges them.

## 11. Floating point noise against a stated tolerance

The mirror holds the sum of two floats and the source holds the number you expect.

```js
import { compareMirror } from 'parity-kit';
import deepDiff from 'deep-diff';
import microdiff from 'microdiff';

const canonical = [{ id: 'a', value: 0.3 }];
const mirror = [{ id: 'a', value: 0.1 + 0.2 }];

console.log('deep-diff :', deepDiff.diff(canonical, mirror).length, 'difference');
console.log('microdiff :', microdiff(canonical, mirror).length, 'difference');
console.log('parity-kit, exact           :', compareMirror(canonical, mirror).status);
console.log('parity-kit, numberTolerance :', compareMirror(canonical, mirror, { numberTolerance: 1e-9 }).status);
```

```text
deep-diff : 1 difference
microdiff : 1 difference
parity-kit, exact           : flagged
parity-kit, numberTolerance : ok
```

The two JavaScript diff libraries have no tolerance, so every rounding difference is a difference. The kit is exact by default and takes an explicit `numberTolerance`. (Python's DeepDiff has `significant_digits`; this case is about the JavaScript libraries only.)

## 12. A constant typed into prose

The source registry holds 1.25 and a documentation page repeats it by hand.

```js
import { findHandTypedConstants } from 'parity-kit';

const registry = [{ id: 'chase-ur.baselineCpp', value: 1.25 }];
const docs = 'Chase Ultimate Rewards points are worth 1.25 cents each.\nSee v1.25.3 for the changelog.';

// A diff has nothing to run on here: the copy is a sentence, not an object.
const hits = findHandTypedConstants(docs, registry);
console.log('parity-kit:', hits.length, 'hit', JSON.stringify(hits.map(({ id, text, line, column }) => ({ id, text, line, column }))));
```

```text
parity-kit: 1 hit [{"id":"chase-ur.baselineCpp","text":"1.25","line":1,"column":41}]
```

A diff compares values with values. A number typed inside a sentence is not a value, so there is nothing for it to compare. The kit finds the copy by position and does not report the `1.25` inside the version `v1.25.3`.

## Where a diff is the better tool

The kit reports a changed field as a whole value: `{ id, field, canonical, mirror }`.
If you need the exact path of a change deep inside a nested structure, or a patch
you can apply (`fast-json-patch`, `deep-diff`'s `applyChange`), use a diff. If your
data is not plain JSON, note case R8 in [differential.md](differential.md): the
two libraries here call two different `Map`s equal, and the kit refuses them.

None of the twelve cases shows that the kit is right about which copy is the
source. It is told which one is canonical and takes it as given.
