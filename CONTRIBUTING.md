# Contributing

## Setup

```bash
npm ci
```

## Before you commit

```bash
npm run verify
```

`verify` runs lint, typecheck, tests, the build, and the packaging checks
in one command. It must pass locally before you commit.

## Fixing a bug

A behavior fix needs a regression test that fails on the old code first.
Add the case to `test/verdict-table.test.ts` (or `test/hostile.test.ts` for a
hostile-value case), confirm it fails against the current source, then make
your fix and confirm it passes. Commit the test and the fix together, with a
message that says what was wrong. Never edit a fixture or an expected verdict
to get green; if a verdict has to change, say so in the message and name the input.

## Changing the public API

`api-surface.json` lists the exported names. A change to it is deliberate:
run `node scripts/verify-package.mjs --update-api` and call it out in the
commit message and `CHANGELOG.md`.

## Publishing

parity-kit is a public MIT package. It is published only by pushing a `v*` tag
whose version matches `package.json`; `.github/workflows/release.yml` then runs
the checks and publishes with npm trusted publishing. Never run `npm publish`
by hand, and do not push tags without the owner's decision. Before tagging,
update `CHANGELOG.md` and run `npm run verify`, `npm run attw` and
`npm pack --dry-run`.

Security problems go through GitHub private vulnerability reporting, not a
public issue (see `SECURITY.md`).
