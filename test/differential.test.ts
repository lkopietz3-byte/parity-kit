import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import microdiff from 'microdiff'
import { auditReviewStamps, compareMirror, ParityError } from '../src/index.js'
import type { MirrorResult } from '../src/index.js'

vi.setConfig({ testTimeout: 120_000 })

// Differential cross-check. On data where "what differs" has one obvious
// meaning (JSON-shaped records), compareMirror must agree with two mature
// object-diff libraries about which (id, field) pairs differ and which ids
// exist on one side only. Every place the three are known to disagree is in
// the ruling table at the bottom and in docs/differential.md.
//
// deep-diff and microdiff are dev dependencies only. The generator below
// lives in this file (fixed seed) and is never shipped.

const require = createRequire(import.meta.url)
interface DeepDiffEntry {
  kind: string
  path?: Array<string | number>
}
const deepDiff = (require('deep-diff') as { diff: (a: unknown, b: unknown) => DeepDiffEntry[] | undefined }).diff

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type Rec = { [field: string]: Json }

// ---------------------------------------------------------------------------
// A seeded generator (mulberry32). Same seed, same datasets, on every machine.
// ---------------------------------------------------------------------------

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
type Rand = () => number
const int = (r: Rand, n: number): number => Math.floor(r() * n)
const pick = <T>(r: Rand, list: readonly T[]): T => list[int(r, list.length)] as T

const STRINGS = ['', ' ', 'a', 'A', 'abc', 'e\u0301', '\u00e9', '1.25', '2026-06-08', '日本語', 'x y', 'null', '0']
const NUMBERS = [0, 1, -1, 2, 7, 0.1, 0.2, 0.3, 1.25, 1.2500000001, 1e21, -3.5, 100]
const FIELDS = ['a', 'b', 'c', 'd', 'e']
// Field names that look odd or mean something to a program. The empty name is left out of both lists on purpose:
// deep-diff does not see a new property with that name (ruling R17).
const ODD_FIELDS = ['a b', '0', '1', '\u00e9', 'e\u0301', '\u202e', 'x.y', '[0]', 'id2']
// Names that also exist on Object.prototype. microdiff does not see a new property with one of these names
// (ruling R19), so datasets built from them are compared with deep-diff only.
const INHERITED_FIELDS = ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']
const INNER = ['x', 'y', 'z']

/** Own data property, also for names such as `__proto__` that a plain assignment would treat as the prototype. */
function setField(target: Rec, name: string, v: Json): void {
  Object.defineProperty(target, name, { value: v, enumerable: true, writable: true, configurable: true })
}

function value(r: Rand, depth: number): Json {
  const kind = int(r, depth >= 2 ? 5 : 7)
  switch (kind) {
    case 0:
      return null
    case 1:
      return r() < 0.5
    case 2:
    case 3:
      return pick(r, NUMBERS)
    case 4:
      return pick(r, STRINGS)
    case 5: {
      const items: Json[] = []
      for (let i = int(r, 4); i > 0; i -= 1) items.push(value(r, depth + 1))
      return items
    }
    default: {
      const out: { [key: string]: Json } = {}
      for (let i = int(r, 4); i > 0; i -= 1) out[pick(r, INNER)] = value(r, depth + 1)
      return out
    }
  }
}

function record(r: Rand, names: readonly string[]): Rec {
  const out: Rec = {}
  for (const f of names) if (r() < 0.7) setField(out, f, value(r, 0))
  if (Object.keys(out).length === 0) setField(out, names[0] as string, value(r, 0))
  return out
}

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** Change one value somewhere inside `v`, or replace it. */
function mutateValue(r: Rand, v: Json): Json {
  if (Array.isArray(v) && v.length > 0 && r() < 0.6) {
    const next = copy(v)
    const i = int(r, next.length)
    next[i] = mutateValue(r, next[i] as Json)
    return next
  }
  if (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length > 0 && r() < 0.6) {
    const next = copy(v)
    const k = pick(r, Object.keys(next))
    next[k] = mutateValue(r, next[k] as Json)
    return next
  }
  if (Array.isArray(v) && r() < 0.5) return [...copy(v), value(r, 2)]
  return value(r, 1)
}

function mutateRecord(r: Rand, rec: Rec, pool: readonly string[]): Rec {
  const out = copy(rec)
  const op = int(r, 5)
  const names = Object.keys(out)
  if (op === 0 && names.length > 0) {
    const f = pick(r, names)
    setField(out, f, mutateValue(r, out[f] as Json))
  } else if (op === 1 && names.length > 1) {
    delete out[pick(r, names)]
  } else if (op === 2) {
    setField(out, pick(r, pool), value(r, 0))
  } else if (op === 3 && names.length > 0) {
    // Same content, keys in another order: must never count as a difference.
    return Object.fromEntries(Object.entries(out).reverse())
  }
  return out
}

interface Dataset {
  canonical: Array<Rec & { id: string }>
  mirror: Array<Rec & { id: string }>
}

function dataset(r: Rand, names: readonly string[] = FIELDS): Dataset {
  const count = 1 + int(r, 7)
  const canonical: Dataset['canonical'] = []
  for (let i = 0; i < count; i += 1) canonical.push({ id: `r${i}`, ...record(r, names) })
  let mirror: Dataset['mirror'] = []
  for (const rec of canonical) {
    if (r() < 0.1) continue // missing from the mirror
    const { id, ...rest } = rec
    mirror.push({ id, ...(r() < 0.5 ? mutateRecord(r, rest, names) : copy(rest)) })
  }
  for (let i = int(r, 3) === 0 ? 1 + int(r, 2) : 0; i > 0; i -= 1) mirror.push({ id: `x${i}-${count}`, ...record(r, names) })
  mirror = mirror
    .map((rec) => ({ rec, k: r() }))
    .sort((p, q) => p.k - q.k)
    .map((p) => p.rec)
  return { canonical, mirror }
}

// ---------------------------------------------------------------------------
// What each side says differs, reduced to the same shape.
// ---------------------------------------------------------------------------

interface Verdict {
  missing: string[]
  extra: string[]
  changed: string[]
}

const byId = (rows: Array<Rec & { id: string }>): Record<string, Rec> => {
  const out: Record<string, Rec> = Object.create(null) as Record<string, Rec>
  for (const { id, ...rest } of rows) out[id] = rest
  return out
}

function fromPaths(entries: Array<{ side: 'canonical' | 'mirror' | 'both'; path: Array<string | number> }>): Verdict {
  const v: Verdict = { missing: [], extra: [], changed: [] }
  for (const e of entries) {
    const [id, field] = e.path
    if (e.path.length === 1) {
      if (e.side === 'canonical') v.missing.push(String(id))
      else v.extra.push(String(id))
    } else {
      v.changed.push(`${String(id)}|${String(field)}`)
    }
  }
  for (const list of [v.missing, v.extra, v.changed]) list.sort()
  v.changed = [...new Set(v.changed)]
  return v
}

function viaDeepDiff(d: Dataset): Verdict {
  const entries = (deepDiff(byId(d.canonical), byId(d.mirror)) ?? []).map((e) => ({
    // deep-diff: N = new in the right side, D = deleted from the left side
    side: e.kind === 'D' ? ('canonical' as const) : e.kind === 'N' ? ('mirror' as const) : ('both' as const),
    path: e.path ?? [],
  }))
  return fromPaths(entries)
}

function viaMicrodiff(d: Dataset): Verdict {
  const entries = microdiff(byId(d.canonical), byId(d.mirror)).map((e) => ({
    side: e.type === 'REMOVE' ? ('canonical' as const) : e.type === 'CREATE' ? ('mirror' as const) : ('both' as const),
    path: e.path,
  }))
  return fromPaths(entries)
}

function viaKit(d: Dataset): { verdict: Verdict; result: MirrorResult } {
  const result = compareMirror(d.canonical, d.mirror)
  const verdict: Verdict = {
    missing: result.missing.map(String).sort(),
    extra: result.extra.map(String).sort(),
    changed: [...new Set(result.changed.map((c) => `${String(c.id)}|${c.field}`))].sort(),
  }
  return { verdict, result }
}

// ---------------------------------------------------------------------------
// The agreement test
// ---------------------------------------------------------------------------

const SEED = 20261014
const DATASETS = 15_000

describe('differential: compareMirror vs deep-diff and microdiff', () => {
  it(`agrees on what differs across ${DATASETS} seeded datasets`, () => {
    const r = rng(SEED)
    const tally = { datasets: 0, missing: 0, extra: 0, changed: 0, clean: 0 }
    const disagreements: string[] = []
    for (let n = 0; n < DATASETS; n += 1) {
      const d = dataset(r)
      const kit = viaKit(d)
      const a = viaDeepDiff(d)
      const b = viaMicrodiff(d)
      tally.datasets += 1
      tally.missing += kit.verdict.missing.length
      tally.extra += kit.verdict.extra.length
      tally.changed += kit.verdict.changed.length
      if (kit.result.ok) tally.clean += 1
      const k = JSON.stringify(kit.verdict)
      if (k !== JSON.stringify(a)) disagreements.push(`#${n} deep-diff ${JSON.stringify(a)} vs kit ${k}`)
      if (k !== JSON.stringify(b)) disagreements.push(`#${n} microdiff ${JSON.stringify(b)} vs kit ${k}`)
      // The kit's own status must follow its report.
      const anything = kit.verdict.missing.length + kit.verdict.extra.length + kit.verdict.changed.length > 0
      expect(kit.result.ok).toBe(!anything)
      expect(kit.result.invalid).toEqual([])
    }
    expect(disagreements.slice(0, 5)).toEqual([])
    // The generator must actually reach every kind of difference, or agreement means nothing.
    // The seed is fixed, so these totals are exact; a change here means the generator changed.
    expect(tally).toEqual({ datasets: DATASETS, missing: 6114, extra: 7309, changed: 15775, clean: 2410 })
  })
})

describe('differential: field names with a special meaning', () => {
  it.each([
    ['odd spellings (a space, digits, accents written two ways, a right-to-left override, dots, brackets)', ODD_FIELDS, true],
    ['names that exist on Object.prototype (deep-diff only; see R19)', [...ODD_FIELDS, ...INHERITED_FIELDS], false],
  ] as const)('agrees on 5000 seeded datasets with %s', (_name, names, withMicrodiff) => {
    const r = rng(SEED + (withMicrodiff ? 9 : 10))
    const disagreements: string[] = []
    let changed = 0
    for (let n = 0; n < 5000; n += 1) {
      const d = dataset(r, names)
      const kit = viaKit(d)
      changed += kit.verdict.changed.length
      const k = JSON.stringify(kit.verdict)
      const a = viaDeepDiff(d)
      if (k !== JSON.stringify(a)) disagreements.push(`#${n} deep-diff ${JSON.stringify(a)} vs kit ${k}`)
      if (withMicrodiff) {
        const b = viaMicrodiff(d)
        if (k !== JSON.stringify(b)) disagreements.push(`#${n} microdiff ${JSON.stringify(b)} vs kit ${k}`)
      }
      expect(kit.result.invalid).toEqual([])
    }
    expect(disagreements.slice(0, 5)).toEqual([])
    expect(changed).toBeGreaterThan(5000)
  })
})

// ---------------------------------------------------------------------------
// Properties that need no reference implementation
// ---------------------------------------------------------------------------

describe('properties of compareMirror', () => {
  const rounds = 1000

  it('comparing a dataset with a copy of itself is ok', () => {
    const r = rng(SEED + 1)
    for (let n = 0; n < rounds; n += 1) {
      const d = dataset(r)
      const result = compareMirror(d.canonical, copy(d.canonical))
      expect(result.status).toBe('ok')
      expect(result.compared).toBe(d.canonical.length)
    }
  })

  it('swapping canonical and mirror swaps missing and extra and keeps the changed fields', () => {
    const r = rng(SEED + 2)
    for (let n = 0; n < rounds; n += 1) {
      const d = dataset(r)
      const forward = compareMirror(d.canonical, d.mirror)
      const backward = compareMirror(d.mirror, d.canonical, { allowEmpty: true })
      expect(new Set(forward.missing)).toEqual(new Set(backward.extra))
      expect(new Set(forward.extra)).toEqual(new Set(backward.missing))
      const fields = (x: MirrorResult): string[] => [...new Set(x.changed.map((c) => `${String(c.id)}|${c.field}`))].sort()
      expect(fields(forward)).toEqual(fields(backward))
    }
  })

  it('a field name that no record has is never ok, and an empty selection never runs', () => {
    const r = rng(SEED + 3)
    for (let n = 0; n < rounds; n += 1) {
      const d = dataset(r)
      const typo = compareMirror(d.canonical, copy(d.canonical), { fields: ['no-such-field'] })
      expect(typo.ok).toBe(false)
      expect(typo.unknownFields).toEqual(['no-such-field'])
      expect(() => compareMirror(d.canonical, copy(d.canonical), { fields: [] })).toThrow(ParityError)
    }
  })

  it('renaming every id between two audit snapshots is never ok', () => {
    const r = rng(SEED + 4)
    for (let n = 0; n < rounds; n += 1) {
      const count = 1 + int(r, 6)
      const before = Array.from({ length: count }, (_, i) => ({ id: `r${i}`, v: int(r, 5), lastReviewed: '2026-01-01' }))
      const after = before.map((rec) => ({ ...rec, id: `${rec.id}-v2`, lastReviewed: '2026-10-01' }))
      const audit = auditReviewStamps(before, after, { reviewedField: 'lastReviewed', sourceFields: [] })
      expect(audit.ok).toBe(false)
      expect(audit.compared).toBe(0)
    }
  })
})

// ---------------------------------------------------------------------------
// Rulings: where the kit and a generic diff are known to disagree.
// Each row runs one record pair through all three and pins the outcome.
// The same rows, with the reasoning, are in docs/differential.md.
// ---------------------------------------------------------------------------

type Outcome = 'same' | 'different' | 'refused'
interface Ruling {
  id: string
  /** The value of a field `v`, or, when `record` is set, the whole record body. */
  canonical: unknown
  mirror: unknown
  record?: boolean
  options?: { numberTolerance?: number }
  kit: Outcome
  deepDiff: Outcome
  microdiff: Outcome
}

const noop = (): number => 1
const sameFn = (): number => 2
const cyclic = (): Record<string, unknown> => {
  const o: Record<string, unknown> = {}
  o['self'] = o
  return o
}

const RULINGS: Ruling[] = [
  { id: 'R1 negative zero vs zero', canonical: -0, mirror: 0, kit: 'same', deepDiff: 'same', microdiff: 'different' },
  { id: 'R2 NaN vs NaN', canonical: NaN, mirror: NaN, kit: 'same', deepDiff: 'same', microdiff: 'same' },
  { id: 'R3 undefined property vs absent property', canonical: { w: undefined, x: 1 }, mirror: { x: 1 }, kit: 'same', deepDiff: 'different', microdiff: 'different' },
  { id: 'R4 two invalid Dates', canonical: new Date(NaN), mirror: new Date(NaN), kit: 'same', deepDiff: 'different', microdiff: 'same' },
  { id: 'R5 same instant, two Date objects', canonical: new Date(5), mirror: new Date(5), kit: 'same', deepDiff: 'same', microdiff: 'same' },
  { id: 'R6 a Date vs its ISO string', canonical: new Date(5), mirror: new Date(5).toISOString(), kit: 'different', deepDiff: 'different', microdiff: 'different' },
  { id: 'R7 a hole in an array', canonical: [1, , 3], mirror: [1, undefined, 3], kit: 'refused', deepDiff: 'different', microdiff: 'different' }, // eslint-disable-line no-sparse-arrays
  { id: 'R8 Maps with different contents', canonical: new Map([[1, 2]]), mirror: new Map([[1, 3]]), kit: 'refused', deepDiff: 'same', microdiff: 'same' },
  { id: 'R9 a class instance vs a plain object with the same fields', canonical: new (class Point { x = 1 })(), mirror: { x: 1 }, kit: 'refused', deepDiff: 'same', microdiff: 'same' },
  { id: 'R10 two different functions', canonical: noop, mirror: sameFn, kit: 'refused', deepDiff: 'different', microdiff: 'different' },
  { id: 'R11 a boxed number vs the number', canonical: 1, mirror: Object(1), kit: 'refused', deepDiff: 'different', microdiff: 'different' },
  { id: 'R12 a cycle on both sides', canonical: cyclic(), mirror: cyclic(), kit: 'refused', deepDiff: 'different', microdiff: 'different' },
  { id: 'R13 1.2500000001 vs 1.25 with numberTolerance 1e-6', canonical: 1.25, mirror: 1.2500000001, options: { numberTolerance: 1e-6 }, kit: 'same', deepDiff: 'different', microdiff: 'different' },
  { id: 'R14 key order inside a nested object', canonical: { a: 1, b: 2 }, mirror: { b: 2, a: 1 }, kit: 'same', deepDiff: 'same', microdiff: 'same' },
  { id: 'R15 array order', canonical: [1, 2], mirror: [2, 1], kit: 'different', deepDiff: 'different', microdiff: 'different' },
  { id: 'R16 a string vs the number it spells', canonical: '1', mirror: 1, kit: 'different', deepDiff: 'different', microdiff: 'different' },
  // JSON.parse is the only way to get a property named '' without a computed key; deep-diff treats the empty name as "no key".
  { id: 'R17 a property named "" that only the mirror has', canonical: {}, mirror: JSON.parse('{"":1}') as unknown, record: true, kit: 'different', deepDiff: 'same', microdiff: 'different' },
  { id: 'R18 a property named "" with a different value', canonical: JSON.parse('{"":1}') as unknown, mirror: JSON.parse('{"":2}') as unknown, record: true, kit: 'different', deepDiff: 'different', microdiff: 'different' },
  { id: 'R19 a property named constructor that only the mirror has', canonical: {}, mirror: JSON.parse('{"constructor":1}') as unknown, record: true, kit: 'different', deepDiff: 'different', microdiff: 'same' },
]

const wrap = (row: Ruling, value: unknown): object => (row.record === true ? (value as object) : { v: value })

function kitOutcome(row: Ruling): Outcome {
  const r = compareMirror([{ id: 'x', ...wrap(row, row.canonical) }], [{ id: 'x', ...wrap(row, row.mirror) }], row.options)
  if (r.invalid.length > 0) return 'refused'
  return r.changed.length > 0 ? 'different' : 'same'
}

function libOutcome(run: (x: unknown, y: unknown) => number, row: Ruling): Outcome {
  return run(wrap(row, row.canonical), wrap(row, row.mirror)) > 0 ? 'different' : 'same'
}

describe('rulings: known disagreements with generic diffs', () => {
  it.each(RULINGS.map((row) => [row.id, row] as const))('%s', (_name, row) => {
    expect(kitOutcome(row)).toBe(row.kit)
    expect(libOutcome((x, y) => deepDiff(x, y)?.length ?? 0, row)).toBe(row.deepDiff)
    expect(libOutcome((x, y) => microdiff(x as object, y as object).length, row)).toBe(row.microdiff)
  })

  it('every disagreement in the table is named in docs/differential.md', () => {
    const doc = readFileSync(join(import.meta.dirname, '..', 'docs', 'differential.md'), 'utf8')
    for (const row of RULINGS) expect(doc).toContain(row.id.split(' ')[0] as string)
  })
})
