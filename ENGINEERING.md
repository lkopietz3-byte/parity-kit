# Engineering contract

This package is a pure TypeScript/ESM data checker. It has no UI, storage,
network, scheduling or file access. The source entry is `src/index.ts`; the
package export resolves to generated `dist/index.js`. Nothing in `src`
imports a `node:` module, so it is browser-safe.

## Layout

- `src/snapshot.ts` reads hostile input once into an inert snapshot (records,
  fields, nested values) and compares snapshots. Everything that touches a
  caller's object lives here.
- `src/options.ts` reads and validates option objects and size budgets.
- `src/keys.ts` finds look-alike keys. `foldCase` and `foldInvisible` turn two of its folds off.
- `src/dates.ts` is the strict ISO 8601 parser (no `Date` parsing).
- `src/mirror.ts`, `src/constants.ts`, `src/stamps.ts` are the three public
  functions.

## Invariants and critical paths

- **Fail only on positive evidence.** A difference is reported when the data
  shows it. When something cannot be read or judged, it is reported in its own
  list (`invalid`, `unknown`, `suspectKeys`) and `ok` is false. It is never a
  silent pass and never reported as a difference that was not observed.
- **`ok` means nothing was reported.** `status` splits the cases: `flagged`
  (positive evidence), `unknown` (could not check), `ok`.
- **Whole-call problems throw, record problems are reported.** A bad option, an
  argument that is not a dataset, an unreadable argument, or a passed limit
  throws `ParityError` (with a `code`). A bad record becomes an `invalid` entry
  and the rest are still compared. A record whose key can be read keeps its
  identity, so it is never reported as `missing`.
  A record whose key cannot be read has no identity (`invalid`, reason
  `unreadable`): the ids the other side lacks are not reported as `missing` or
  `extra` while that many unreadable records could account for them, because
  the unreadable one may be the counterpart. Past that count the surplus is
  evidence and everything absent is listed, so at most as many listed ids as there
  are unreadable records may really be present: the claim is that at least one is
  missing, which is why the result is `flagged` and not `unknown`.
- **A run that checked nothing is never `ok`.** What is wrong with the options
  alone throws: `fields: []`, or a `fields` list that `ignoreFields` cancels
  entirely, is `bad-options`. What depends on the data is reported, not thrown
  (the same call can be fine on other data): when `ignoreFields` removes every
  field of every matched record, `compareMirror` is `unknown` with
  `noFieldsCompared`; when both audit snapshots have keyed records and share no
  key, `auditReviewStamps` is `unknown` with `noOverlap`. Records that carry
  only an id are an honest presence check and stay `ok`. The key column is
  equal by construction, so it counts neither as examined nor as suppressed
  (`gate-review:F3`). A `fields` list that `ignoreFields` cancels is refused
  unless a `reviewedField` that is not ignored still gives something to
  compare (`gate-review:F7`). In an object-keyed dataset the key field's name
  always counts as present (a committed row pins it), so `fields: ['id']`
  there is a presence check (`gate-hostile:F5`). A name given in
  `ignoreFields` is checked like any other configured name (`unknownFields`),
  because ignoring less means more fields count as evidence in the audit: a typo
  there fails open. Registry entries accept only `id`, `value` and `forms`, and a
  registry must not be empty, for the same reason.
- **Options are read as written or refused.** An option object throws `bad-options` for an
  unknown name, a symbol key, or an own property that is not enumerable. Skipping any of them
  would turn the check it configures off without a word (`fields` defined as non-enumerable
  compared every field). Registry entries are the one place that keeps the older rule: an unknown
  enumerable key is refused, a hidden or symbol key is not read (two committed rows pin that). A registry entry's
  property descriptors are all captured first (no getter runs), an unknown enumerable key is refused,
  and only then do the getters run, always in the order `id`, `value`, `forms`, so the order a
  Proxy lists its keys in cannot change what a getter sees (`release-gate:R1`).
- **Read once, then compare.** A record is read into a snapshot: own enumerable
  string-keyed properties only (or the named own properties), data values
  taken from the descriptor and getters run exactly once, keys sorted so a
  Proxy's `ownKeys` order cannot matter. Inherited properties, symbol keys,
  `toJSON`, `then`, `toString` and `valueOf` are not used. What was validated
  is what is compared and reported.
- **Plain data only, and a deliberately small classifier.** Records and nested
  objects must be plain (prototype `null`, or a prototype whose prototype is
  `null`, from any realm). Nothing is classified by a property the caller
  controls. An object with a non-plain prototype is a Date (recognized with
  `Date.prototype.getTime`, which only succeeds on a real Date) or unsupported.
  An object with a plain prototype and **at least one own enumerable property
  is plain data**, whatever else it carries (a hidden non-enumerable property
  does not change that). Only an object with **no own enumerable property**
  is probed for being a built-in whose prototype was replaced (`src/brand.ts`:
  captured built-in methods that only succeed on a real instance). That probe
  throws internally and costs about 0.2 ms of CPU per empty-looking object
  (measured on a loaded machine; no quiet-machine figure is verified);
  it does not change any global (no `Error.stackTraceLimit`), and it is linear.
  The probe also refuses an empty object whose prototype is neither `null` nor
  this realm's untouched `Object.prototype` (an empty object from another
  realm is therefore unsupported), because a Promise cannot be ruled out there.
  This is the last exotic-object class the kit fixes: Proxies are read through
  their traps, and built-ins or host objects disguised with a replaced
  prototype and own enumerable properties are read as plain data. Further finds
  of that kind are documented, not fixed.
- **Probes that cannot be pure have a precondition.** Recognizing a Promise
  calls `then`, which looks up `constructor`: it is called only when the
  object has no own `constructor` (or an own data one holding `undefined`) and
  its prototype is `null` or the untouched `Object.prototype`. Without
  `Error.isError` (Node before 24), recognizing an Error uses the captured
  `Object.prototype.toString`, which looks up `Symbol.toStringTag`: it is used
  only with no own tag and a `null` or untouched `Object.prototype`. Anything
  else is `unsupported-value`, never plain data. A probe failure means "plain"
  only when the failure is the brand check itself.
- **A selected hidden property is read, but never makes an object populated.** With
  `fields`, a named own property is read whether or not it is enumerable. Only an
  enumerable one (or any other enumerable property of the record) counts as "populated",
  so a built-in with a replaced prototype and a hidden own property that `fields` names
  still gets the built-in probe.
- **Descriptors are classified by own properties.** A data descriptor is one with an own
  `value`. `'value' in desc` is never used: it walks the prototype chain, and a polluted
  `Object.prototype.value` would turn a getter into a data property.
- **A polluted `Object.prototype` reaches no report.** Every object the kit builds for a
  report or reads back from itself is made so an inherited name cannot matter: result
  objects add optional properties with spreads, never by assignment (an inherited read-only
  or accessor `value`, `id`, `path` or `detail` would throw), internal records are read with
  own-property reads, and the descriptor that copies a value into a report has a `null`
  prototype (an inherited `get` or `set` would be taken for an accessor). The pollution
  matrix in `gate-false-pass:GFP-05` pins `get`, `set`, `value`, `id`, `path` and `detail`.
  Two kinds remain by design: a polluted `Object.prototype.constructor` makes an empty `{}`
  `unsupported-value` (the conservative reading, because a Promise cannot be ruled out), and
  a polluted `Array.prototype.constructor` makes the array methods the kit uses throw a
  `TypeError` (the species lookup). Both fail closed; neither returns a verdict.
- **Aliased objects are read once per appearance.** The same object under two fields is
  snapshotted twice, so a getter on it runs twice. Remembering objects by identity would let
  shared structure make snapshots and comparisons exponential, which `maxNodes` exists to
  prevent, so this is a stated limit, not a defect.
- **Classification never copies and never reads unselected data.** No
  `structuredClone`, no property `Get`.
- **One read per property.** A record's key, each selected field, the reviewed
  field and `constructor` are looked up once; the descriptor captured then is
  the value used, and classification reuses it (`ShapeFacts`). `test/hostile.test.ts` counts descriptor reads through a Proxy.
- **Our errors are recognized by identity.** Caller code can throw anything.
  `catch` blocks test `isOwnError(value)` (a `WeakSet` membership check, which
  runs no traps) before any `instanceof`, and thrown values are never coerced:
  `describeError` reads only an own data property `message` that is a string.
- **Bounded work.** `maxRecords` (own enumerable string keys of an id-keyed object; the read stops
  and throws as soon as the enumerable count passes it, so a refused dataset costs
  `maxRecords + 1` descriptor reads and not one per key, `release-gate:R2`),
  `maxNodes` (and a lower cap on arrays and
  objects, which allocate) and `maxDepth` (at most 1000) bound every read.
  Recursion happens only after the depth check, so stack use is bounded.
  Cycles are detected with an ancestor set. A string key that is analyzed is charged to
  the node budget by the size of its compatibility decomposition when that
  exceeds its length (a refused key costs nothing, and its scan stops at the
  refusal), and `suspectKeys[].skeleton` is clipped, so key normalization and the
  report are both bounded by the input (`gate-false-pass:GFP-02`).
- **Linear scans.** Look-alike grouping is one pass over the keys. Text
  scanning is one pass for numbers plus an Aho-Corasick pass for literal
  forms. No regular expression retries over untrusted text; the only
  regular expressions run on single characters or short field names.
- **Numbers are exact unless told otherwise.** `-0` equals `0`, `NaN` equals
  `NaN`, a tolerance applies only to finite numbers, a string never equals a
  number. A tolerance above zero allows `min(8 * EPSILON * max(|a|, |b|, tolerance), tolerance / 1000)`
  on top of itself, so a difference that is exactly the tolerance in decimal is
  equal; at tolerance `0` nothing is added. The cap is what keeps the allowance
  from growing with the numbers: uncapped it passes real differences near 1e15.
  `gate-review:F1` pins it at magnitudes up to 1e17.
- **No clock.** `now` is an argument. Without it, future dates are not judged
  and nothing reads the time. A bare date gets a 14-hour future grace (UTC+14
  is the furthest-ahead civil offset); an explicit-offset timestamp gets none.
  Do not unify the two without re-deriving the 14 hours.
- **Dates are strict.** A zoneless timestamp is `unknown`, never guessed. See
  the README for the accepted forms.
- **Reports are copies.** Reported values are rebuilt with `null`-prototype
  objects; they never alias the input.

## Setup and verification

Declared dependencies are TypeScript, Vitest and lint tooling in
`package-lock.json`. For a clean environment use `npm ci`. Run sequentially:

```sh
npm run verify
```

`verify` runs lint, typecheck, tests, the build and `verify:package`, which
packs the tarball, installs it offline into a temporary project, imports it
by name, compares the exported names to `api-surface.json` and compiles a
strict type probe against the shipped declarations.

Tests:

- `test/verdict-table.test.ts` is the verdict regression table: honest inputs
  that must pass and bad inputs that must be flagged, one row per finding.
- `test/hostile.test.ts` holds hostile-value cases (Proxies, getters, inherited
  hooks, cross-realm values).
- `test/docs-snippets.test.ts` type-checks every ```ts block in `README.md` in a strict
  project against `src/` and runs it with small stand-ins for `process`, `console` and
  `node:fs`. A block added to the README must be added to its table.
- `test/scaling.test.ts` holds the 100,000-record and 1 MB cases, and ratio
  checks on CPU time (four times the input must cost well under sixteen times
  the time).
- `test/differential.test.ts` checks `compareMirror` against `deep-diff` and
  `microdiff` (dev dependencies only) on seeded datasets, states four
  properties that need no reference, and pins every known disagreement in a
  ruling table that `docs/differential.md` explains. The generator lives in the
  test file and nowhere else.
- `test/bench-regression.test.ts` runs the quick subset of `bench/` (labeled
  real and seeded data, about 180,000 verdicts) against `src/` and requires the
  confusion matrices in `bench/expected.json` exactly. `npm run bench` runs all
  of it against `dist/`; CI runs that after the build. A count that moves is a
  changed verdict: say which items moved before refreshing the pin.
- `test/what-a-diff-cannot-answer.test.ts` runs every js block of
  `docs/what-a-diff-cannot-answer.md` and compares what it prints with the text
  under it.

Each regression test must fail on the source it fixes. Never edit a fixture or
an expected verdict to make a test pass.

## Are the types wrong? (attw)

`npm run attw` runs [`arethetypeswrong`](https://github.com/arethetypeswrong/arethetypeswrong.github.io)
against the packed tarball (`cjs-resolves-to-esm` is ignored on purpose: this
package is ESM-only, and a CommonJS consumer uses Node's `require(esm)`
support on Node 20.19+ / 22.12+).

## Release status

parity-kit is a public MIT package. `verify:package` checks that the manifest
is not private, says `MIT`, names the repository, homepage and bugs URLs, and
that the tarball ships `LICENSE`, `README.md`, `METHOD.md` and `CHANGELOG.md`
beside `dist/` and nothing else.

Publishing happens when a `v*` tag is pushed.
`.github/workflows/release.yml` refuses to run off a tag, refuses a tag that does not
match the `package.json` version, requires a successful `Verify` workflow run on the tagged
commit (the Node 20 to 24 consumer matrix included), runs the audit, `npm run verify` and
`npm run attw` once, skips a version that is already on the registry, and publishes with
trusted publishing (`id-token: write`, no stored token, no npm cache) and `--ignore-scripts`,
so the tested `dist/` is what ships and the suite does not run again.

The 0.1.0 path is the one exception to "only through the workflow". npm's docs do not say
whether a never-published name can be given a trusted publisher. On tag day the owner first
tries `npm trust github parity-kit --file release.yml --repo lkopietz3-byte/parity-kit --allow-publish --yes`.
If npm refuses because the package does not exist, the owner (never an agent) runs
`npm publish` once from a clean checkout of the tagged commit, which gives 0.1.0 no
provenance, then sets up trusted publishing the same day, so 0.1.1 onward publish from the
tag with provenance. Every later release goes only through `release.yml`; nobody runs
`npm publish` by hand again (`CONTRIBUTING.md` has the steps).
