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

parity-kit is a public MIT package. After 0.1.0, every release goes only through
`.github/workflows/release.yml`: push a `v*` tag whose version matches `package.json`
and the workflow runs the checks and publishes with npm trusted publishing. Do not push
tags without the owner's decision. Before tagging, update `CHANGELOG.md` and run
`npm run verify`, `npm run attw` and `npm pack --dry-run`. The release job also requires a
successful `Verify` workflow run on the tagged commit (so tag a commit that went through the
pull request or `main` checks), runs the checks once, and publishes with `--ignore-scripts`
so the test suite does not run a second time.

### First publish (0.1.0)

npm's documentation does not say whether a name that has never been published can be given
a trusted publisher, so 0.1.0 has two possible paths, and only the owner takes them (an agent
never runs `npm trust`, `npm login` or `npm publish`):

1. On tag day the owner first tries to set up trusted publishing for the new name:

   ```bash
   npm trust github parity-kit --file release.yml --repo lkopietz3-byte/parity-kit --allow-publish --yes
   ```

   If npm accepts it, there is a pending trusted publisher for `release.yml`. Push the `v0.1.0`
   tag on the green `main` commit and the workflow publishes 0.1.0 with provenance. An unused
   setting expires, so do this on the day of the tag.
2. If npm refuses because the package does not exist, the owner runs `npm publish` once, by
   hand, from a clean checkout of the tagged commit (`git clone`, `git checkout v0.1.0`,
   `npm ci`; the `prepublishOnly` script runs `npm run verify`). That publish has no provenance.
   The owner then sets up trusted publishing for `release.yml` the same day with the `npm trust`
   command above, now that the package exists. Version 0.1.1 and every later one publish from
   the tag with provenance. Pushing the `v0.1.0` tag afterward is safe: the workflow skips a
   version that is already on the registry.

The README links to `bench/` files under `blob/main`, which resolve once the release branch
is merged to `main`.

Security problems go through GitHub private vulnerability reporting, not a
public issue (see `SECURITY.md`).
