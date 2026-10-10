// Strict NodeNext type probe: compiled (never run) by scripts/verify-package.mjs
// against the installed .d.ts files, the way a TypeScript consumer's own
// tsconfig (strict, NodeNext) would see this package. No @types/node here
// (this kit has none as a dev dependency), so no `node:` imports.
import {
  ParityError,
  auditReviewStamps,
  compareMirror,
  findHandTypedConstants,
  type ChangedField,
  type HandTypedMatch,
  type InvalidEntry,
  type Key,
  type MirrorOptions,
  type MirrorResult,
  type RegisteredConstant,
  type StampAudit,
  type StampOptions,
  type Status,
  type SuspectKeyGroup,
} from 'parity-kit';

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

const options: MirrorOptions = { reviewedField: 'reviewedOn', ignoreFields: ['note'], numberTolerance: 0 };
const mirror: MirrorResult = compareMirror(
  [{ id: 'a', v: 1, reviewedOn: '2026-06-08' }],
  [{ id: 'a', v: 2, reviewedOn: '2026-06-08' }],
  options,
);
const status: Status = mirror.status;
const missing: Key[] = mirror.missing;
const changed: ChangedField[] = mirror.changed;
const invalid: InvalidEntry[] = mirror.invalid;
const suspects: SuspectKeyGroup[] = mirror.suspectKeys;
assertEqual(status, 'flagged', 'mirror status');
assertEqual(missing.length, 0, 'missing');
assertEqual(changed.length, 1, 'changed');
assertEqual(invalid.length + suspects.length, 0, 'invalid and suspect');

const registry: RegisteredConstant[] = [{ id: 'cpp', value: 1.25, forms: ['1.25 cents'] }];
const hits: HandTypedMatch[] = findHandTypedConstants('worth 1.25 cents', registry);
assertEqual(hits.length, 1, 'hand-typed hits');
assertEqual(hits[0]?.column, 7, 'hit column');

const stampOptions: StampOptions = { reviewedField: 'reviewedOn', sourceFields: ['source'], bulkThreshold: 5 };
const audit: StampAudit = auditReviewStamps(
  [{ id: 'a', source: 's', reviewedOn: '2026-06-08' }],
  [{ id: 'a', source: 's', reviewedOn: '2026-10-10' }],
  stampOptions,
);
assertEqual(audit.stampOnly.length, 1, 'stampOnly');

try {
  compareMirror(null, []);
} catch (error) {
  assertEqual(error instanceof ParityError, true, 'ParityError');
}

console.log('consumer-probe.mts: type probe assembled without error');
