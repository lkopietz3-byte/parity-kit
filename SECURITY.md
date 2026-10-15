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

## Reporting a vulnerability

Please report suspected vulnerabilities privately, not in a public issue. Use
[GitHub private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
on the repository: open the Security tab of
https://github.com/lkopietz3-byte/parity-kit and choose "Report a vulnerability".

The cases that matter most are a crafted input that makes a check pass when it
should fail, and one that hangs or crashes a call. Please include the affected
version, a minimal reproduction and the impact you expect.

## Bug bounty

There is no bug bounty program for this project.
