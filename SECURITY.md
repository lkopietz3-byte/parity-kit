# Security policy

## Posture

parity-kit is a pure TypeScript library. It reads no files, makes no network
calls, runs no child processes and reads no clock unless the caller passes
one. It compares data the caller hands it.

Because the data may come from a feed, a browser extension or a pull request,
every input is treated as hostile:

- A dataset is read once into an inert snapshot. Only own enumerable properties
  are read, each getter runs once, and `toJSON`, `then`, `toString` and
  `valueOf` are never called.
- Proxy traps and getters that throw make that record `invalid`; they never
  crash the call or pass silently.
- Work is bounded by `maxRecords`, `maxNodes` and `maxDepth`, so deep nesting,
  shared-structure blow-ups and huge arrays end in a documented result or a
  `ParityError`.
- Text scanning is linear in the length of the text, with no unanchored
  backtracking regular expressions.
- Reported values are copies with `null`-prototype objects; keys such as
  `__proto__` are data and cannot pollute a prototype.

This package is private and is not published. If you find a way to make a
check pass that should fail, or to hang or crash it with a crafted input,
report it to the owner directly and include a minimal reproduction.

## Bug bounty

There is no bug bounty program for this project.
