import { describe, expect, it, vi } from 'vitest'
import { auditReviewStamps, compareMirror, findHandTypedConstants } from '../src/index.js'
import { COST_RATIO_LIMIT, GROWTH_LIMIT, costRatio, growthRatio } from './growth.js'
import { cpuMs, program, programs } from './helpers.js'

vi.setConfig({ testTimeout: 600_000 })

// Scaling tests. Every "stays linear" test goes through growthRatio (test/growth.ts): CPU time is
// measured (not wall time), repeated until the small input costs a measurable amount, and the best
// of five runs is used. Four times the input must cost under GROWTH_LIMIT times the CPU; linear work
// is about four, quadratic about sixteen. Sizes below are the 4x steps each test is about.

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
    const r = growthRatio(
      (n) => {
        const a = programs(n)
        const b = programs(n)
        return () => compareMirror(a, b)
      },
      { small: 30_000, large: 120_000 },
    )
    expect(r).toBeLessThan(GROWTH_LIMIT)
  })

  it('compareMirror with 100k look-alike keys stays linear', () => {
    const make = (n: number): Array<{ id: string }> => Array.from({ length: n }, (_, i) => ({ id: `K${i}` }))
    const r = growthRatio(
      (n) => {
        const a = make(n)
        const b = make(n)
        return () => compareMirror(a, b)
      },
      { small: 30_000, large: 120_000 },
    )
    expect(r).toBeLessThan(GROWTH_LIMIT)

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
    const o = { reviewedField: 'reviewedOn', sourceFields: ['source'] }
    const r = growthRatio(
      (n) => {
        const [before, after] = build(n)
        return () => auditReviewStamps(before, after, o)
      },
      { small: 30_000, large: 120_000 },
    )
    expect(r).toBeLessThan(GROWTH_LIMIT)
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
    const r = growthRatio(
      (n) => {
        const text = prose(n)
        return () => findHandTypedConstants(text, registry)
      },
      { small: 250_000, large: 1_000_000 },
    )
    expect(r).toBeLessThan(GROWTH_LIMIT)
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
    ['PK4-4 dots and ranges', (n) => '1..5...'.repeat(n / 7)],
    ['PK4-4 a long run of dots', (n) => '.'.repeat(n)],
    ['PF-7 underscore groups', (n) => '1_000_000_'.repeat(n / 10)],
    ['PF-7 underscore runs', (n) => '1_'.repeat(n / 2)],
    ['hostile-F7 digits between unspaced-script letters', (n) => '价值1.25美分'.repeat(n / 8)],
    ['hostile-F7 Thai and Hangul runs', (n) => 'อัตรา1값은'.repeat(n / 8)],
  ]
  it.each(adversarial)('stays linear on %s', (_name, make) => {
    const r = growthRatio(
      (n) => {
        const text = make(n)
        return () => findHandTypedConstants(text, registry)
      },
      { small: 200_000, large: 800_000 },
    )
    expect(r).toBeLessThan(GROWTH_LIMIT)
  })

  it('stays linear when forms overlap heavily', () => {
    const forms = Array.from({ length: 12 }, (_, i) => 'a'.repeat(i + 1))
    const reg = [{ id: 'a', value: 'zzz', forms }]
    const r = growthRatio(
      (n) => {
        const text = 'a'.repeat(n)
        return () => findHandTypedConstants(text, reg)
      },
      { small: 200_000, large: 800_000 },
    )
    expect(r).toBeLessThan(GROWTH_LIMIT)
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
  it('overlength keys are refused without being scanned (no trim, no whitespace scan)', () => {
    const blank = ' '.repeat(1_000_000)
    const arrayRecords = Array.from({ length: 400 }, () => ({ id: blank }))
    const objectRecords: Record<string, object> = {}
    objectRecords[blank] = { v: 1 }
    const ms = cpuMs(() => {
      const r = compareMirror(arrayRecords, arrayRecords)
      expect(r.invalid).toHaveLength(800)
    }, 1)
    expect(ms).toBeLessThan(150)
    const ms2 = cpuMs(() => {
      for (let i = 0; i < 400; i += 1) compareMirror(objectRecords, objectRecords)
    }, 1)
    expect(ms2).toBeLessThan(150)
  })

  it('overlength key cost does not grow with the key length', () => {
    const run = (n: number) => {
      const key = ' '.repeat(n)
      const records = Array.from({ length: 300 }, () => ({ id: key }))
      return () => {
        for (let i = 0; i < 20; i += 1) compareMirror(records, records)
      }
    }
    expect(growthRatio(run, { small: 250_000, large: 1_000_000 })).toBeLessThan(GROWTH_LIMIT)
  })

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

  it('a key whose compatibility decomposition builds a long combining run is refused quickly', () => {
    const id = `e${'\u0301\uFF9E'.repeat(128_000)}`
    let r: ReturnType<typeof compareMirror> | undefined
    const ms = cpuMs(() => {
      r = compareMirror([{ id }], [{ id }], { limits: { maxKeyLength: 1_048_576 } })
    }, 1)
    expect(r?.invalid.map((i) => i.reason)).toEqual(['key-unnormalizable', 'key-unnormalizable'])
    expect(ms).toBeLessThan(500)
  })

  it('a throwing getter on an overlength property name is refused quickly', () => {
    const long = `e${'\u0301'.repeat(64_000)}`
    const make = (): Record<string, unknown> =>
      Object.defineProperty({}, long, {
        enumerable: true,
        get() {
          throw new Error('boom')
        },
      })
    let r: ReturnType<typeof compareMirror> | undefined
    const ms = cpuMs(() => {
      r = compareMirror(make(), make())
    }, 1)
    expect(r?.invalid.map((i) => i.reason)).toEqual(['key-too-long', 'key-too-long'])
    expect(ms).toBeLessThan(200)
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
    const r = growthRatio(
      (n) => {
        const a = make(n)
        const b = make(n)
        return () => compareMirror(a, b)
      },
      { small: 20_000, large: 80_000 },
    )
    expect(r).toBeLessThan(GROWTH_LIMIT)
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
    const r = growthRatio(
      (n) => {
        const text = '-'.repeat(n)
        return () => findHandTypedConstants(text, reg)
      },
      { small: 20_000, large: 80_000 },
    )
    expect(r).toBeLessThan(GROWTH_LIMIT)
  })
})

describe('empty objects', () => {
  it('100k records with empty-object fields stay linear', () => {
    const build = (n: number): Array<{ id: string; tags: object; meta: object }> => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, tags: {}, meta: Object.create(null) as object }))
    const r = growthRatio(
      (n) => {
        const records = build(n)
        return () => compareMirror(records, records)
      },
      { small: 1500, large: 6000 },
    )
    expect(r).toBeLessThan(GROWTH_LIMIT)
  })

  it('run9:first5:F04: an empty-object column costs about what an empty-array column costs', () => {
    // Before the fix every empty object paid about fifteen thrown TypeErrors (one per built-in it was
    // probed against) and the column cost about thirty times the same data with [] in this test.
    const records = (empty: () => unknown): Array<{ id: string; name: string; tags: unknown }> =>
      Array.from({ length: 2000 }, (_, i) => ({ id: `r${i}`, name: `n${i}`, tags: empty() }))
    const objects = records(() => ({}))
    const arrays = records(() => [])
    const ratio = costRatio(
      () => compareMirror(objects, objects),
      () => compareMirror(arrays, arrays),
    )
    expect(ratio).toBeLessThan(COST_RATIO_LIMIT)
  })
})

describe('field-name lists', () => {
  const names = (n: number): string[] => Array.from({ length: n }, (_, i) => `field-${i}`)

  it('compareMirror option lists stay linear', () => {
    const run = (n: number) => {
      const list = names(n)
      return () => compareMirror([{ id: 'a', v: 1 }], [{ id: 'a', v: 1 }], { fields: ['v', ...list], ignoreFields: list })
    }
    expect(growthRatio(run, { small: 8000, large: 32_000 })).toBeLessThan(GROWTH_LIMIT)
  })

  it('auditReviewStamps option lists stay linear', () => {
    const run = (n: number) => {
      const list = names(n)
      const ignored = list.map((x) => `${x}-ignored`)
      return () =>
        auditReviewStamps([{ id: 'a', reviewedOn: '2026-06-08' }], [{ id: 'a', reviewedOn: '2026-06-08' }], {
          reviewedField: 'reviewedOn',
          sourceFields: list,
          valueFields: list,
          ignoreFields: ignored,
        })
    }
    expect(growthRatio(run, { small: 8000, large: 32_000 })).toBeLessThan(GROWTH_LIMIT)
  })

  it('many source fields over many records stay linear in the records', () => {
    const build = (n: number): [unknown[], unknown[]] => {
      const before = Array.from({ length: n }, (_, i) => ({ id: `r${i}`, reviewedOn: '2026-06-08', s1: 1, s2: 2, s3: 3 }))
      return [before, before.map((r) => ({ ...r, s2: 9, reviewedOn: '2026-10-10' }))]
    }
    const o = { reviewedField: 'reviewedOn', sourceFields: ['s1', 's2', 's3'] }
    const r = growthRatio(
      (n) => {
        const [before, after] = build(n)
        return () => auditReviewStamps(before, after, o)
      },
      { small: 20_000, large: 80_000 },
    )
    expect(r).toBeLessThan(GROWTH_LIMIT)
  })
})
