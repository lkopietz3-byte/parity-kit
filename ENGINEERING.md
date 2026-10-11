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
- `src/keys.ts` finds look-alike keys.
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
  throws internally and costs tens of microseconds per empty-looking object;
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
- **Classification never copies and never reads unselected data.** No
  `structuredClone`, no property `Get`.
- **One read per property.** A record's key, each selected field, the reviewed
  field and `constructor` are looked up once; the descriptor captured then is
  the value used, and classification reuses it (`ShapeFacts`). `test/hostile.test.ts` counts descriptor reads through a Proxy.
- **Our errors are recognized by identity.** Caller code can throw anything.
  `catch` blocks test `isOwnError(value)` (a `WeakSet` membership check, which
  runs no traps) before any `instanceof`, and thrown values are never coerced:
  `describeError` reads only an own data property `message` that is a string.
- **Bounded work.** `maxRecords`, `maxNodes` (and a lower cap on arrays and
  objects, which allocate) and `maxDepth` (at most 1000) bound every read.
  Recursion happens only after the depth check, so stack use is bounded.
  Cycles are detected with an ancestor set.
- **Linear scans.** Look-alike grouping is one pass over the keys. Text
  scanning is one pass for numbers plus an Aho-Corasick pass for literal
  forms. No regular expression retries over untrusted text; the only
  regular expressions run on single characters or short field names.
- **Numbers are exact unless told otherwise.** `-0` equals `0`, `NaN` equals
  `NaN`, a tolerance applies only to finite numbers, a string never equals a
  number.
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
- `test/scaling.test.ts` holds the 100,000-record and 1 MB cases, and ratio
  checks on CPU time (four times the input must cost well under sixteen times
  the time).

Each regression test must fail on the source it fixes. Never edit a fixture or
an expected verdict to make a test pass.

## Are the types wrong? (attw)

`npm run attw` runs [`arethetypeswrong`](https://github.com/arethetypeswrong/arethetypeswrong.github.io)
against the packed tarball (`cjs-resolves-to-esm` is ignored on purpose: this
package is ESM-only, and a CommonJS consumer uses Node's `require(esm)`
support on Node 20.19+ / 22.12+).

## Release status

The package is private and UNLICENSED. There is no release process: do not
publish, tag or push without the owner's decision. `verify:package` checks that
the manifest stays private, has no `repository`, `homepage` or `bugs` field,
and that no LICENSE file ships.
