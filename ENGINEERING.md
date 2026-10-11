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
- **Plain data only.** Records and nested objects must be plain (prototype
  `null`, or a prototype whose prototype is `null`, from any realm). Nothing
  is classified by a property the caller controls: no `Symbol.toStringTag`,
  `constructor`, `toJSON` or inherited getter is read. Built-ins are
  recognized by calling captured built-in methods that only succeed on a real
  instance (`src/brand.ts`); that includes Dates (`Date.prototype.getTime`),
  which become date values. A failed probe throws internally and is slow, so
  the sweep runs only for an object with no enumerable own properties, a
  non-enumerable own property, or a non-plain prototype, and typed arrays are
  always caught by `ArrayBuffer.isView`. The documented gap: a built-in with a
  replaced prototype and its own enumerable properties reads as a plain object.
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
