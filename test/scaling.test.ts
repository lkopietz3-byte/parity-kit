import { describe, expect, it, vi } from 'vitest'
import { auditReviewStamps, compareMirror, findHandTypedConstants } from '../src/index.js'
import { cpuMs, program, programs } from './helpers.js'

vi.setConfig({ testTimeout: 600_000 })

// Scaling tests. CPU time is measured (not wall time) and the best of three
// runs is used. Four times the input must cost well under sixteen times the
// time; linear work is about four.

function ratio(small: () => void, large: () => void): number {
  const a = cpuMs(small)
  const b = cpuMs(large)
  return b / Math.max(a, 1)
}

describe('100k records', () => {
  it('compareMirror reads 100k records on each side and finds one drifted record', () => {
    const canonical = programs(100_000)
    const mirror = programs(100_000)
    mirror[77_777] = program(77_777, { baselineCpp: 99 })
    const r = compareMirror(canonical, mirror, { reviewedField: 'reviewedOn' })
    expect(r.compared).toBe(100_000)
    expect(r.changed).toMatchObject([{ id: 'prog-77777', field: 'baselineCpp', mirror: 99 }])
    expect(r.stampHidesDrift).toHaveLength(1)
    expect(r.status).toBe('flagged')
  })

  it('compareMirror is honest about 100k identical records', () => {
    expect(compareMirror(programs(100_000), programs(100_000)).ok).toBe(true)
  })

  it('compareMirror time grows about linearly with the records', () => {
    const small = [programs(30_000), programs(30_000)] as const
    const large = [programs(120_000), programs(120_000)] as const
    const r = ratio(() => compareMirror(small[0], small[1]), () => compareMirror(large[0], large[1]))
    expect(r).toBeLessThan(10)
  })

  it('compareMirror with 100k look-alike keys stays linear', () => {
    const make = (n: number): Array<{ id: string }> => Array.from({ length: n }, (_, i) => ({ id: `K${i}` }))
    const r = ratio(() => compareMirror(make(30_000), make(30_000)), () => compareMirror(make(120_000), make(120_000)))
    expect(r).toBeLessThan(10)
  })

  it('compareMirror with every record missing from the mirror is linear', () => {
    const a = programs(100_000)
    const r = compareMirror(a, [])
    expect(r.missing).toHaveLength(100_000)
  })

  it('auditReviewStamps flags a 100k stamp-only bump', () => {
    const before = programs(100_000).map((p) => ({ ...p, source: 's' }))
    const after = before.map((p) => ({ ...p, reviewedOn: '2026-10-10' }))
    const r = auditReviewStamps(before, after, { reviewedField: 'reviewedOn', sourceFields: ['source'] })
    expect(r.stampOnly).toHaveLength(100_000)
    expect(r.bulkBump).toMatchObject([{ count: 100_000, withEvidence: 0 }])
  })

  it('auditReviewStamps time grows about linearly with the records', () => {
    const build = (n: number): [unknown[], unknown[]] => {
      const before = programs(n).map((p) => ({ ...p, source: 's' }))
      return [before, before.map((p) => ({ ...p, baselineCpp: 2, reviewedOn: '2026-10-10' }))]
    }
    const small = build(30_000)
    const large = build(120_000)
    const o = { reviewedField: 'reviewedOn', sourceFields: ['source'] }
    const r = ratio(() => auditReviewStamps(small[0], small[1], o), () => auditReviewStamps(large[0], large[1], o))
    expect(r).toBeLessThan(10)
  })

  it('an id-keyed object with 100k keys', () => {
    const obj: Record<string, unknown> = {}
    for (const p of programs(100_000)) obj[p.id] = p
    expect(compareMirror(obj, programs(100_000)).ok).toBe(true)
  })
})

describe('1 MB of text', () => {
  const registry = [
    { id: 'cpp', value: 1.25, forms: ['1.25 cents', '1,25'] },
    { id: 'name', value: 'chase-ur' },
    { id: 'limit', value: 120000 },
  ]

  function prose(chars: number): string {
    const unit = 'Chase Ultimate Rewards points are worth 1.25 cents each, about 11.256 or 21.25 elsewhere; see chase-ur, v1.25, 1.25.3 and $120,000.\nNext line 1,25 here.\r\n'
    return unit.repeat(Math.ceil(chars / unit.length)).slice(0, chars)
  }

  it('scans 1 MB with matches and reports lines and columns', () => {
    const text = prose(1_000_000)
    const start = process.cpuUsage()
    const m = findHandTypedConstants(text, registry)
    const used = process.cpuUsage(start)
    expect(m.length).toBeGreaterThan(5000)
    expect(m[0]).toMatchObject({ id: 'cpp', line: 1, column: 41 })
    expect((used.user + used.system) / 1000).toBeLessThan(5000)
    for (const hit of m.slice(0, 50)) expect(text.slice(hit.index, hit.index + hit.text.length)).toBe(hit.text)
  })

  it('time grows about linearly with the text', () => {
    const small = prose(250_000)
    const large = prose(1_000_000)
    expect(ratio(() => findHandTypedConstants(small, registry), () => findHandTypedConstants(large, registry))).toBeLessThan(10)
  })

  const adversarial: Array<[string, (n: number) => string]> = [
    ['one long digit run', (n) => '1'.repeat(n)],
    ['dotted digits', (n) => '1.'.repeat(n / 2)],
    ['digit-comma groups', (n) => '1,111'.repeat(n / 5)],
    ['near misses of the form', (n) => '1.2'.repeat(n / 3)],
    ['repeated form prefix', (n) => 'chase-u'.repeat(n / 7)],
    ['dashes', (n) => '-'.repeat(n)],
    ['exponent-like runs', (n) => '1e1e1e'.repeat(n / 6)],
    ['all newlines', (n) => '\n'.repeat(n)],
    ['carriage returns', (n) => '\r'.repeat(n)],
  ]
  it.each(adversarial)('stays linear on %s', (_name, make) => {
    const r = ratio(() => findHandTypedConstants(make(200_000), registry), () => findHandTypedConstants(make(800_000), registry))
    expect(r).toBeLessThan(10)
  })

  it('stays linear when forms overlap heavily', () => {
    const forms = Array.from({ length: 12 }, (_, i) => 'a'.repeat(i + 1))
    const reg = [{ id: 'a', value: 'zzz', forms }]
    const r = ratio(() => findHandTypedConstants('a'.repeat(200_000), reg), () => findHandTypedConstants('a'.repeat(800_000), reg))
    expect(r).toBeLessThan(10)
  })

  it('finds a hand-typed value at the very end of 1 MB', () => {
    const text = `${'x '.repeat(500_000)}1.25`
    expect(findHandTypedConstants(text, registry)).toMatchObject([{ id: 'cpp', index: 1_000_000, line: 1, column: 1_000_001 }])
  })

  it('a registry with 5,000 constants over 1 MB', () => {
    const reg = Array.from({ length: 5000 }, (_, i) => ({ id: `c${i}`, value: i + 0.5, forms: [`rate-${i}`] }))
    const text = prose(1_000_000)
    expect(() => findHandTypedConstants(text, reg)).not.toThrow()
  })

  it('compareMirror compares 1 MB string values; a 1 MB key is refused, not analyzed', () => {
    const big = 'x'.repeat(1_000_000)
    expect(compareMirror([{ id: 'a', v: big }], [{ id: 'a', v: big }]).ok).toBe(true)
    const r = compareMirror([{ id: 'a', v: big }], [{ id: 'a', v: `${big}y` }])
    expect(r.changed).toHaveLength(1)
    const k = compareMirror([{ id: big }], [{ id: big }])
    expect(k.invalid.map((i) => i.reason)).toEqual(['key-too-long', 'key-too-long'])
    expect(k.ok).toBe(false)
  })
})

describe('hostile keys', () => {
  it('a key built to make normalization quadratic is refused quickly, whatever maxNodes says', () => {
    for (const n of [16_000, 32_000, 100_000]) {
      const id = `a${'\u0315'.repeat(n)}${'\u0300'.repeat(n)}`
      let r: ReturnType<typeof compareMirror> | undefined
      const ms = cpuMs(() => {
        r = compareMirror([{ id }], [{ id }], { limits: { maxNodes: 10, maxKeyLength: 1_000_000 } })
      }, 1)
      expect(r?.invalid.map((i) => i.reason)).toEqual(['key-unnormalizable', 'key-unnormalizable'])
      expect(ms).toBeLessThan(500)
    }
  })

  it('the same key under the default limits is refused as too long', () => {
    const id = `a${'\u0315'.repeat(16_000)}${'\u0300'.repeat(16_000)}`
    expect(compareMirror([{ id }], [{ id }]).invalid.map((i) => i.reason)).toEqual(['key-too-long', 'key-too-long'])
  })

  it('many long keys are charged against maxNodes', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ id: `${'k'.repeat(1000)}${i}` }))
    expect(() => compareMirror(many, many, { limits: { maxNodes: 20_000 } })).toThrowError(
      expect.objectContaining({ code: 'too-large' }) as Error,
    )
  })

  it('a hundred thousand ordinary keys stay linear', () => {
    const make = (n: number): Array<{ id: string }> => Array.from({ length: n }, (_, i) => ({ id: `key-${i}` }))
    expect(ratio(() => compareMirror(make(20_000), make(20_000)), () => compareMirror(make(80_000), make(80_000)))).toBeLessThan(10)
  })
})

describe('duplicate forms and memory', () => {
  it('a thousand copies of one form do not multiply the hits or the memory', () => {
    const registry = [{ id: 'x', value: '-', forms: Array.from({ length: 1000 }, () => '-') }]
    const before = process.memoryUsage().heapUsed
    const m = findHandTypedConstants('-'.repeat(2000), registry)
    const grown = process.memoryUsage().heapUsed - before
    expect(m).toHaveLength(2000)
    expect(grown).toBeLessThan(40 * 1024 * 1024)
  })

  it('many distinct overlapping forms on a long text stay linear in the text', () => {
    const forms = Array.from({ length: 30 }, (_, i) => '-'.repeat(i + 1))
    const reg = [{ id: 'x', value: 'zzz', forms }]
    const r = ratio(() => findHandTypedConstants('-'.repeat(20_000), reg), () => findHandTypedConstants('-'.repeat(80_000), reg))
    expect(r).toBeLessThan(10)
  })
})

describe('empty objects', () => {
  it('100k records with empty-object fields stay linear', () => {
    const build = (n: number): Array<{ id: string; tags: object; meta: object }> => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, tags: {}, meta: Object.create(null) as object }))
    const small = build(1500)
    const large = build(6000)
    expect(ratio(() => compareMirror(small, small), () => compareMirror(large, large))).toBeLessThan(10)
  })
})

describe('field-name lists', () => {
  const names = (n: number): string[] => Array.from({ length: n }, (_, i) => `field-${i}`)

  it('compareMirror option lists stay linear', () => {
    const run = (n: number) => () => compareMirror([{ id: 'a', v: 1 }], [{ id: 'a', v: 1 }], { fields: ['v', ...names(n)], ignoreFields: names(n) })
    expect(ratio(run(8000), run(32_000))).toBeLessThan(10)
  })

  it('auditReviewStamps option lists stay linear', () => {
    const run = (n: number) => () =>
      auditReviewStamps([{ id: 'a', reviewedOn: '2026-06-08' }], [{ id: 'a', reviewedOn: '2026-06-08' }], {
        reviewedField: 'reviewedOn',
        sourceFields: names(n),
        valueFields: names(n),
        ignoreFields: names(n).map((x) => `${x}-ignored`),
      })
    expect(ratio(run(8000), run(32_000))).toBeLessThan(10)
  })

  it('many source fields over many records stay linear in the records', () => {
    const build = (n: number): [unknown[], unknown[]] => {
      const before = Array.from({ length: n }, (_, i) => ({ id: `r${i}`, reviewedOn: '2026-06-08', s1: 1, s2: 2, s3: 3 }))
      return [before, before.map((r) => ({ ...r, s2: 9, reviewedOn: '2026-10-10' }))]
    }
    const small = build(20_000)
    const large = build(80_000)
    const o = { reviewedField: 'reviewedOn', sourceFields: ['s1', 's2', 's3'] }
    expect(ratio(() => auditReviewStamps(small[0], small[1], o), () => auditReviewStamps(large[0], large[1], o))).toBeLessThan(10)
  })
})
