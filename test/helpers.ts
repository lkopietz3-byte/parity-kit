import type { MirrorResult } from '../src/index.js'

export interface Program {
  id: string
  name: string
  baselineCpp: number
  reviewedOn: string
  [field: string]: unknown
}

/** A believable record: a points program with a valuation and a review date. */
export function program(i: number, over: Partial<Program> = {}): Program {
  return {
    id: `prog-${String(i).padStart(5, '0')}`,
    name: `Program ${i}`,
    baselineCpp: 1 + (i % 7) * 0.25,
    reviewedOn: '2026-06-08',
    ...over,
  }
}

export function programs(count: number): Program[] {
  const out: Program[] = []
  for (let i = 0; i < count; i += 1) out.push(program(i))
  return out
}

/** Everything a MirrorResult can report, empty. */
export function emptyMirror(): Omit<MirrorResult, 'compared'> {
  return {
    ok: true,
    status: 'ok',
    noFieldsCompared: false,
    missing: [],
    extra: [],
    changed: [],
    stampHidesDrift: [],
    duplicateKeys: [],
    unknownFields: [],
    suspectKeys: [],
    invalid: [],
  }
}

/** CPU milliseconds used by `fn`, best of `runs`. */
export function cpuMs(fn: () => void, runs = 3): number {
  let best = Infinity
  for (let r = 0; r < runs; r += 1) {
    const start = process.cpuUsage()
    fn()
    const used = process.cpuUsage(start)
    best = Math.min(best, (used.user + used.system) / 1000)
  }
  return best
}

/** A deep copy of JSON-shaped data (the tests only use JSON-shaped data here). */
export function structuredCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
