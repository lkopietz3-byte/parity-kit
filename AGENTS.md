# parity-kit: agent instructions

Check that every copy of a fact still matches its source of truth, and that a review date was earned by an actual recheck. Compares a canonical record set to its mirrors, finds hand-typed copies of registered constants in text, and audits review stamps between two snapshots. Zero-dependency, framework-agnostic TypeScript.

## Read first
- `ENGINEERING.md` holds this package's invariants and design rules; read it before changing behavior.
- `SECURITY.md` covers the security posture; follow it for anything touching input handling.
- `README.md` states the exact rules and the "What it does not do" list. Keep them true.

## Commands (from package.json)
- `npm run verify`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run attw` checks the packed types; `npm run audit:dependencies` audits the lockfile.
- `npm run verify:package` packs and installs the tarball offline; run `npm run build` first.
- `npm run bench` builds, then scores the kit on the labeled corpus in `bench/` and fails if any count moves from `bench/expected.json`. A count that moves is a changed verdict: name the items before refreshing the pin (`bench/README.md`).

## Rules
- Run `npm run verify` and read its output before calling work done. Report any step that did not run.
- Build cleans `dist/` first; never trust a stale `dist/` for declaration or package checks.
- Never weaken lint, tests or `api-surface.json` to get green. Never edit a fixture or an expected verdict to make a test pass; if a verdict must change, say so and name the input. Public API changes are deliberate (`node scripts/verify-package.mjs --update-api`) and must be called out.
- This package is private and UNLICENSED. Do not add a LICENSE file, a repository, homepage or bugs field, or run `npm publish`. Do not push, tag or open pull requests without explicit permission.
- Runtime `dependencies` stay empty; add dev tooling only. Nothing in `src` may import `node:` modules.
- Keep unrelated uncommitted work intact; commit by explicit path and never stage or reset the whole tree.

## Code Review Rules

- Fail only on positive evidence. "Can't tell" (an unreadable record, a missing or unparseable date, an empty dataset, a look-alike key) is its own state: reported as `invalid`, `unknown` or `suspectKeys`, never a silent pass and never a false fail. `ok` is true only when nothing at all is reported.
- A malformed input must not return permission. A bad option or a non-dataset argument throws `ParityError`; one bad record is reported in `invalid` and the rest are still compared.
- Read hostile values once, into a snapshot, before comparing: own enumerable data and accessor properties only, getters run once, no `toJSON`, no `then`, no inherited properties, no recursion past `maxDepth`. Everything that scans text or records must stay linear; add a scaling test for any new scan.
- Never read the clock. `now` is an argument; without it nothing about the future is judged.
- Claims stay small: the kit flags copies that disagree and stamps that moved without evidence in the data. It does not know which copy is right and does not prove a human rechecked anything. No legal or regulatory claims.
