import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  auditReviewStamps,
  compareMirror,
  findHandTypedConstants,
  type MirrorOptions,
  type StampOptions,
} from '../src/index.js'
import { GROWTH_LIMIT, growthRatio } from './growth.js'
import { cpuMs, program, programs, structuredCopy } from './helpers.js'

// Verdict regression table. Honest inputs must pass; bad inputs must be
// flagged with the named finding. Rows are never edited to get green.

const reviewed = { reviewedField: 'reviewedOn' } satisfies MirrorOptions

// ---------------------------------------------------------------------------
// compareMirror: honest mirrors pass
// ---------------------------------------------------------------------------

describe('compareMirror: an honest mirror passes', () => {
  const canon = [program(1), program(2), program(3)]
  const honest: Array<[string, unknown, unknown, MirrorOptions?]> = [
    ['identical arrays', canon, structuredCopy(canon)],
    ['same records in another order', canon, [...structuredCopy(canon)].reverse()],
    ['keys of a record in another order', canon, canon.map((r) => Object.fromEntries(Object.entries(r).reverse()))],
    ['array vs id-keyed object', canon, Object.fromEntries(canon.map((r) => [r.id, structuredCopy(r)]))],
    ['id-keyed object whose records repeat the id', Object.fromEntries(canon.map((r) => [r.id, r])), Object.fromEntries(canon.map((r) => [r.id, r]))],
    ['null-prototype records', canon, canon.map((r) => Object.assign(Object.create(null) as object, r))],
    ['a numeric id', [{ id: 7, v: 1 }], [{ id: 7, v: 1 }]],
    ['-0 equals 0', [{ id: 'a', v: 0 }], [{ id: 'a', v: -0 }]],
    ['NaN equals NaN', [{ id: 'a', v: NaN }], [{ id: 'a', v: NaN }]],
    ['nested arrays and objects', [{ id: 'a', t: { a: [1, { b: 'x' }], c: null } }], [{ id: 'a', t: { c: null, a: [1, { b: 'x' }] } }]],
    ['a property that is undefined is absent', [{ id: 'a', v: 1 }], [{ id: 'a', v: 1, w: undefined }]],
    ['equal Dates', [{ id: 'a', d: new Date('2026-06-08T00:00:00Z') }], [{ id: 'a', d: new Date('2026-06-08T00:00:00Z') }]],
    ['two invalid Dates', [{ id: 'a', d: new Date(NaN) }], [{ id: 'a', d: new Date(NaN) }]],
    ['a Date from another realm', [{ id: 'a', d: new Date(5) }], [{ id: 'a', d: vm.runInNewContext('new Date(5)') }]],
    ['a whole record set from another realm', canon, vm.runInNewContext(JSON.stringify(canon))],
    ['a tolerance absorbs rounding', [{ id: 'a', v: 1.25 }], [{ id: 'a', v: 1.2500004 }], { numberTolerance: 1e-6 }],
    ['an ignored field may differ', [{ id: 'a', v: 1, note: 'x' }], [{ id: 'a', v: 1, note: 'y' }], { ignoreFields: ['note'] }],
    ['an unlisted field may differ when fields is set', [{ id: 'a', v: 1, note: 'x' }], [{ id: 'a', v: 1, note: 'y' }], { fields: ['v'] }],
    ['a different key field name', [{ slug: 'a', v: 1 }], [{ slug: 'a', v: 1 }], { key: 'slug' }],
    ['both empty with allowEmpty', [], [], { allowEmpty: true }],
    ['same review date and same values', canon, structuredCopy(canon), reviewed],
    ['a mirror that tracks a legitimate update', [program(1, { baselineCpp: 1.5, reviewedOn: '2026-07-01' })], [program(1, { baselineCpp: 1.5, reviewedOn: '2026-07-01' })], reviewed],
    ['look-alike keys that are the same key', [{ id: 'café', v: 1 }], [{ id: 'café', v: 1 }]],
  ]
  it.each(honest)('%s', (_name, a, b, options) => {
    const r = compareMirror(a, b, options)
    expect(r.status).toBe('ok')
    expect(r.ok).toBe(true)
    expect(r.missing).toEqual([])
    expect(r.extra).toEqual([])
    expect(r.changed).toEqual([])
    expect(r.invalid).toEqual([])
    expect(r.suspectKeys).toEqual([])
    expect(r.duplicateKeys).toEqual([])
  })

  it('counts the records it compared', () => {
    expect(compareMirror(canon, structuredCopy(canon)).compared).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// compareMirror: drift and set differences are flagged
// ---------------------------------------------------------------------------

describe('compareMirror: drift is flagged', () => {
  it('1.25 vs 1.0 with the same review date: changed AND the stamp hides it', () => {
    const canonical = [program(1, { id: 'chase-ur', baselineCpp: 1.25, reviewedOn: '2026-06-08' })]
    const mirror = [program(1, { id: 'chase-ur', baselineCpp: 1.0, reviewedOn: '2026-06-08' })]
    const r = compareMirror(canonical, mirror, reviewed)
    expect(r.ok).toBe(false)
    expect(r.status).toBe('flagged')
    expect(r.changed).toEqual([{ id: 'chase-ur', field: 'baselineCpp', change: 'different', canonical: 1.25, mirror: 1 }])
    expect(r.stampHidesDrift).toEqual([{ id: 'chase-ur', reviewedValue: '2026-06-08', fields: ['baselineCpp'] }])
  })

  it('1.25 vs 1.0 with different review dates: changed, but no stamp is hiding it', () => {
    const r = compareMirror(
      [program(1, { id: 'a', baselineCpp: 1.25, reviewedOn: '2026-06-08' })],
      [program(1, { id: 'a', baselineCpp: 1.0, reviewedOn: '2026-05-01' })],
      reviewed,
    )
    expect(r.status).toBe('flagged')
    expect(r.changed.map((c) => c.field)).toEqual(['baselineCpp', 'reviewedOn'])
    expect(r.stampHidesDrift).toEqual([])
  })

  it('treats the same instant written two ways as the same review date', () => {
    const r = compareMirror(
      [{ id: 'a', v: 1, reviewedOn: '2026-06-09' }],
      [{ id: 'a', v: 2, reviewedOn: '2026-06-09T01:00:00+01:00' }],
      reviewed,
    )
    expect(r.stampHidesDrift.map((s) => s.id)).toEqual(['a'])
  })

  it('does not call a missing review date a hidden stamp', () => {
    const r = compareMirror([{ id: 'a', v: 1 }], [{ id: 'a', v: 2 }], reviewed)
    expect(r.stampHidesDrift).toEqual([])
    expect(r.status).toBe('flagged')
  })

  it('exact by default: 1.25 vs 1.0000001 differs', () => {
    expect(compareMirror([{ id: 'a', v: 1.25 }], [{ id: 'a', v: 1.2500001 }]).changed).toHaveLength(1)
  })

  it('a tolerance too small to cover the gap still flags it', () => {
    const r = compareMirror([{ id: 'a', v: 1.25 }], [{ id: 'a', v: 1.0 }], { numberTolerance: 0.1 })
    expect(r.changed).toHaveLength(1)
  })

  it('a tolerance never makes a string equal a number', () => {
    expect(compareMirror([{ id: 'a', v: 1.25 }], [{ id: 'a', v: '1.25' }], { numberTolerance: 5 }).changed).toHaveLength(1)
  })

  const typeDiffs: Array<[string, unknown, unknown]> = [
    ['number vs numeric string', 1.25, '1.25'],
    ['number vs bigint', 1, 1n],
    ['null vs 0', null, 0],
    ['null vs empty string', null, ''],
    ['false vs 0', false, 0],
    ['Infinity vs a big number', Infinity, 1e308],
    ['NaN vs null', NaN, null],
    ['Date vs its ISO string', new Date('2026-06-08T00:00:00Z'), '2026-06-08T00:00:00.000Z'],
    ['array vs object', [1], { 0: 1 }],
    ['[1,2] vs [2,1]', [1, 2], [2, 1]],
    ['[] vs {}', [], {}],
    ['a longer array', [1], [1, 1]],
    ['nested difference', { a: { b: 1 } }, { a: { b: 2 } }],
    ['NFC vs NFD in a value', 'café', 'café'],
    ['zero-width in a value', 'abc', 'abc​'],
    ['trailing space in a value', 'abc', 'abc '],
    ['look-alike letter in a value', 'a', 'а'],
    ['lone surrogate vs replacement', '\ud800', '�'],
    ['different Dates', new Date(1), new Date(2)],
  ]
  it.each(typeDiffs)('flags a value difference: %s', (_name, a, b) => {
    const r = compareMirror([{ id: 'a', v: a }], [{ id: 'a', v: b }])
    expect(r.status).toBe('flagged')
    expect(r.changed.map((c) => c.field)).toEqual(['v'])
  })

  it('a field present in only one copy is reported as such', () => {
    const r = compareMirror([{ id: 'a', v: 1, w: null }], [{ id: 'a', v: 1, x: 2 }])
    expect(r.changed).toEqual([
      { id: 'a', field: 'w', change: 'missing-in-mirror', canonical: null, mirror: undefined },
      { id: 'a', field: 'x', change: 'extra-in-mirror', canonical: undefined, mirror: 2 },
    ])
  })

  it('reports a missing record', () => {
    const r = compareMirror([program(1), program(2)], [program(1)])
    expect(r.missing).toEqual([program(2).id])
    expect(r.extra).toEqual([])
    expect(r.status).toBe('flagged')
  })

  it('reports an extra record', () => {
    const r = compareMirror([program(1)], [program(1), program(2)])
    expect(r.extra).toEqual([program(2).id])
    expect(r.missing).toEqual([])
    expect(r.status).toBe('flagged')
  })

  it('an empty mirror misses every record', () => {
    const r = compareMirror([program(1), program(2)], [])
    expect(r.missing).toHaveLength(2)
  })

  it('a mirror with no overlap is all missing and all extra', () => {
    const r = compareMirror([program(1)], [program(2)])
    expect(r.missing).toEqual([program(1).id])
    expect(r.extra).toEqual([program(2).id])
  })

  it('a null-prototype record with drift is flagged like any other', () => {
    const drifted = Object.assign(Object.create(null) as object, { id: 'a', v: 2 })
    expect(compareMirror([{ id: 'a', v: 1 }], [drifted]).changed).toHaveLength(1)
  })

  it('a record whose own key is __proto__ is data, not a prototype', () => {
    const canonical = JSON.parse('[{"id":"a","__proto__":{"v":1}}]') as unknown
    const mirror = JSON.parse('[{"id":"a","__proto__":{"v":2}}]') as unknown
    const r = compareMirror(canonical, mirror)
    expect(r.changed.map((c) => c.field)).toEqual(['__proto__'])
    expect(({} as Record<string, unknown>)['v']).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// compareMirror: keys
// ---------------------------------------------------------------------------

describe('compareMirror: look-alike keys are reported, never merged', () => {
  const lookAlikes: Array<[string, string, string]> = [
    ['NFC vs NFD', 'café', 'café'],
    ['a trailing space', 'chase-ur', 'chase-ur '],
    ['a leading space', 'chase-ur', ' chase-ur'],
    ['a no-break space', 'chase ur', 'chase ur'],
    ['a zero-width space', 'chase-ur', 'chase​-ur'],
    ['a zero-width joiner', 'chase-ur', 'chase-‍ur'],
    ['a byte order mark', 'chase-ur', '﻿chase-ur'],
    ['a soft hyphen', 'chase-ur', 'chase­-ur'],
    ['upper case', 'chase-ur', 'Chase-UR'],
    ['a Cyrillic a', 'amex-gold', 'amеx-gold'],
    ['a Cyrillic c', 'chase-ur', 'сhase-ur'],
    ['a Greek omicron', 'bonvoy', 'bοnvoy'],
    ['a non-breaking hyphen', 'chase-ur', 'chase‑ur'],
    ['an en dash', 'chase-ur', 'chase\u2013ur'],
    ['full-width letters', 'chase', 'ｃｈａｓｅ'],
    ['a ligature', 'office', 'oﬃce'],
  ]
  it.each(lookAlikes)('%s: missing + extra + suspectKeys', (_name, a, b) => {
    const r = compareMirror([{ id: a, v: 1 }], [{ id: b, v: 1 }])
    expect(r.status).toBe('flagged')
    expect(r.missing).toEqual([a])
    expect(r.extra).toEqual([b])
    expect(r.compared).toBe(0)
    expect(r.suspectKeys).toHaveLength(1)
    expect(r.suspectKeys[0]?.keys).toEqual([
      { side: 'canonical', key: a },
      { side: 'mirror', key: b },
    ])
  })

  it('the number 1 and the string "1" are different keys and look alike', () => {
    const r = compareMirror([{ id: 1, v: 1 }], [{ id: '1', v: 1 }])
    expect(r.missing).toEqual([1])
    expect(r.extra).toEqual(['1'])
    expect(r.suspectKeys).toHaveLength(1)
  })

  it('look-alikes inside the canonical set alone are reported', () => {
    const r = compareMirror([{ id: 'a' }, { id: 'A' }], [{ id: 'a' }, { id: 'A' }])
    expect(r.suspectKeys).toHaveLength(1)
    expect(r.ok).toBe(false)
    expect(r.status).toBe('unknown')
  })

  it('foldCase false lets keys that differ only by case stand', () => {
    const r = compareMirror([{ id: 'a' }, { id: 'A' }], [{ id: 'a' }, { id: 'A' }], { foldCase: false })
    expect(r.suspectKeys).toEqual([])
    expect(r.ok).toBe(true)
  })

  it('a space is not a look-alike for nothing, or for a hyphen', () => {
    const ids = [{ id: 'chase ur' }, { id: 'chaseur' }, { id: 'chase-ur' }]
    expect(compareMirror(ids, ids).suspectKeys).toEqual([])
  })

  it('distinct keys are not look-alikes', () => {
    expect(compareMirror([{ id: 'chase-ur' }, { id: 'chase-sapphire' }], [{ id: 'chase-ur' }, { id: 'chase-sapphire' }]).suspectKeys).toEqual([])
  })

  it('reports a duplicate key and does not compare that id', () => {
    const r = compareMirror(
      [{ id: 'a', v: 1 }],
      [{ id: 'a', v: 1 }, { id: 'a', v: 2 }],
    )
    expect(r.duplicateKeys).toEqual([{ side: 'mirror', id: 'a', positions: [0, 1] }])
    expect(r.status).toBe('flagged')
    expect(r.missing).toEqual([])
    expect(r.compared).toBe(0)
  })

  it('reports a duplicate key in the canonical set', () => {
    const r = compareMirror([{ id: 'a' }, { id: 'a' }], [{ id: 'a' }])
    expect(r.duplicateKeys).toEqual([{ side: 'canonical', id: 'a', positions: [0, 1] }])
  })

  it('an object-keyed record whose id field disagrees with its property is invalid', () => {
    const r = compareMirror({ a: { id: 'b', v: 1 } }, { a: { id: 'a', v: 1 } })
    expect(r.invalid).toMatchObject([{ side: 'canonical', position: 'a', id: 'a', reason: 'key-mismatch' }])
    expect(r.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// compareMirror: records that cannot be read are "can't tell", not a pass
// ---------------------------------------------------------------------------

describe('compareMirror: unreadable records are invalid, never a pass', () => {
  class Klass {
    id = 'a'
  }
  const cyc: Record<string, unknown> = { id: 'a' }
  cyc['self'] = cyc
  const sparse = new Array<unknown>(2)
  sparse[0] = { id: 'a' }
  const bad: Array<[string, unknown, string]> = [
    ['null', null, 'not-an-object'],
    ['a string', 'a', 'not-an-object'],
    ['a number', 7, 'not-an-object'],
    ['an array', ['a'], 'not-an-object'],
    ['a class instance', new Klass(), 'not-a-plain-object'],
    ['a Map', new Map([['id', 'a']]), 'not-a-plain-object'],
    ['a Date', new Date(), 'not-a-plain-object'],
    ['a record without a key', { v: 1 }, 'missing-key'],
    ['a record with an undefined key', { id: undefined, v: 1 }, 'missing-key'],
    ['a null key', { id: null }, 'bad-key'],
    ['an empty key', { id: '' }, 'bad-key'],
    ['a blank key', { id: '   ' }, 'bad-key'],
    ['a NaN key', { id: NaN }, 'bad-key'],
    ['an Infinity key', { id: Infinity }, 'bad-key'],
    ['an object key', { id: { x: 1 } }, 'bad-key'],
    ['a boolean key', { id: true }, 'bad-key'],
    ['a function value', { id: 'a', f: () => 1 }, 'unsupported-value'],
    ['an own toJSON method', { id: 'a', toJSON: () => ({ id: 'a' }) }, 'unsupported-value'],
    ['a symbol value', { id: 'a', s: Symbol('x') }, 'unsupported-value'],
    ['a Map value', { id: 'a', m: new Map() }, 'unsupported-value'],
    ['a class-instance value', { id: 'a', k: new Klass() }, 'unsupported-value'],
    ['a Date-like object', { id: 'a', d: { getTime: () => 5 } }, 'unsupported-value'],
    ['a cyclic record', cyc, 'cycle'],
    ['a sparse array inside a record', { id: 'a', list: new Array<number>(3) }, 'hole'],
    ['a throwing getter', { id: 'a', get v(): number { throw new Error('boom') } }, 'unreadable'],
    ['a record that is a revoked proxy', (() => { const p = Proxy.revocable({}, {}); p.revoke(); return p.proxy })(), 'unreadable'],
    ['a record whose ownKeys trap throws', new Proxy({ id: 'a' }, { ownKeys() { throw new Error('no keys') } }), 'unreadable'],
    ['a record whose descriptor trap throws', new Proxy({ id: 'a' }, { getOwnPropertyDescriptor() { throw new Error('no desc') } }), 'unreadable'],
  ]
  it.each(bad)('%s', (_name, record, reason) => {
    const r = compareMirror([record], [record], { allowEmpty: true })
    expect(r.ok).toBe(false)
    expect(r.invalid.map((i) => i.reason)).toContain(reason)
    expect(r.status === 'unknown' || r.status === 'flagged').toBe(true)
  })

  it('a hole in the records array is invalid', () => {
    const r = compareMirror(sparse, sparse)
    expect(r.invalid.map((i) => `${i.side}:${String(i.position)}:${i.reason}`)).toEqual(['canonical:1:hole', 'mirror:1:hole'])
  })

  it('one bad record does not hide a real difference in another', () => {
    const r = compareMirror([{ id: 'a', v: 1 }, null], [{ id: 'a', v: 2 }, null])
    expect(r.changed).toHaveLength(1)
    expect(r.invalid).toHaveLength(2)
  })

  it('a bad record with a readable id does not make that id missing', () => {
    const r = compareMirror([{ id: 'a', f: () => 1 }], [{ id: 'a', f: () => 1 }])
    expect(r.missing).toEqual([])
    expect(r.extra).toEqual([])
    expect(r.invalid).toHaveLength(2)
  })

  it('an invalid mirror record is never reported as matching', () => {
    const r = compareMirror([{ id: 'a', v: 1 }], [{ id: 'a', v: () => 1 }])
    expect(r.ok).toBe(false)
    expect(r.compared).toBe(0)
  })

  it('an empty canonical set is reported unless allowEmpty is set', () => {
    const r = compareMirror([], [])
    expect(r.ok).toBe(false)
    expect(r.invalid).toMatchObject([{ side: 'canonical', position: null, reason: 'empty-dataset' }])
  })

  it('an empty mirror under a real canonical set is all missing, not a pass', () => {
    expect(compareMirror([{ id: 'a' }], []).ok).toBe(false)
    expect(compareMirror({}, {}, { allowEmpty: true }).ok).toBe(true)
  })

  it('values nested deeper than maxDepth are invalid, not a stack overflow', () => {
    let deep: unknown = 'leaf'
    for (let i = 0; i < 100_000; i += 1) deep = [deep]
    const r = compareMirror([{ id: 'a', deep }], [{ id: 'a', deep }])
    expect(r.invalid.map((i) => i.reason)).toEqual(['too-deep', 'too-deep'])
    expect(r.ok).toBe(false)
  })

  it('nesting within maxDepth is compared normally', () => {
    let deep: unknown = 'leaf'
    for (let i = 0; i < 30; i += 1) deep = { x: deep }
    expect(compareMirror([{ id: 'a', deep }], [{ id: 'a', deep }]).ok).toBe(true)
  })

  it('a raised maxDepth is honored up to the hard cap', () => {
    let deep: unknown = 'leaf'
    for (let i = 0; i < 200; i += 1) deep = [deep]
    expect(compareMirror([{ id: 'a', deep }], [{ id: 'a', deep }], { limits: { maxDepth: 300 } }).ok).toBe(true)
    expect(() => compareMirror([], [], { limits: { maxDepth: 5000 } })).toThrow(/maxDepth/)
  })

  it('a wide shared structure cannot blow up the work (value budget)', () => {
    let shared: unknown = 1
    for (let i = 0; i < 40; i += 1) shared = [shared, shared]
    expect(() => compareMirror([{ id: 'a', shared }], [{ id: 'a', shared }], { limits: { maxNodes: 200_000 } })).toThrowError(
      expect.objectContaining({ code: 'too-large' }) as Error,
    )
  })

  it('the same structure at the default limits also ends in too-large (it takes a few seconds)', () => {
    let shared: unknown = 1
    for (let i = 0; i < 40; i += 1) shared = [shared, shared]
    expect(() => compareMirror([{ id: 'a', shared }], [{ id: 'a', shared }])).toThrowError(
      expect.objectContaining({ code: 'too-large' }) as Error,
    )
  }, 60_000)
})

// ---------------------------------------------------------------------------
// compareMirror: arguments that are wrong as a whole throw ParityError
// ---------------------------------------------------------------------------

describe('compareMirror: whole-call problems throw ParityError', () => {
  const badInputs: Array<[string, unknown, string]> = [
    ['null', null, 'bad-input'],
    ['undefined', undefined, 'bad-input'],
    ['a string', 'id', 'bad-input'],
    ['a number', 5, 'bad-input'],
    ['a Map', new Map(), 'bad-input'],
    ['a Set', new Set(), 'bad-input'],
    ['a function', () => [], 'bad-input'],
    ['a class instance', new (class Foo {})(), 'bad-input'],
    ['a Promise', Promise.resolve([]), 'bad-input'],
    ['a typed array', new Uint8Array(2), 'bad-input'],
    ['an array with a length that throws', new Proxy([], { get(_t, p) { if (p === 'length') throw new Error('x'); return undefined }, getOwnPropertyDescriptor() { throw new Error('x') } }), 'unreadable-input'],
    ['a revoked proxy', (() => { const p = Proxy.revocable([], {}); p.revoke(); return p.proxy })(), 'unreadable-input'],
    ['an object whose ownKeys throws', new Proxy({}, { ownKeys() { throw new Error('x') } }), 'unreadable-input'],
    ['a sparse array claiming a billion slots', new Array(1_000_000_000), 'too-large'],
  ]
  it.each(badInputs)('canonical = %s', (_name, input, code) => {
    expect(() => compareMirror(input, [])).toThrowError(expect.objectContaining({ name: 'ParityError', code }) as Error)
    expect(() => compareMirror([], input)).toThrowError(expect.objectContaining({ name: 'ParityError', code }) as Error)
  })

  const badOptions: Array<[string, unknown]> = [
    ['an unknown option (typo)', { ignoreField: ['x'] }],
    ['options that are not an object', 'fast'],
    ['options that are an array', []],
    ['a numeric key', { key: 5 }],
    ['an empty key', { key: '' }],
    ['fields that are not an array', { fields: 'v' }],
    ['fields with a non-string', { fields: ['v', 5] }],
    ['fields with an empty name', { fields: [''] }],
    ['a negative tolerance', { numberTolerance: -1 }],
    ['a NaN tolerance', { numberTolerance: NaN }],
    ['an Infinity tolerance', { numberTolerance: Infinity }],
    ['a string tolerance', { numberTolerance: '0.1' }],
    ['allowEmpty that is not a boolean', { allowEmpty: 'yes' }],
    ['limits that are not an object', { limits: 5 }],
    ['an unknown limit', { limits: { maxRows: 5 } }],
    ['a zero maxRecords', { limits: { maxRecords: 0 } }],
    ['a fractional maxNodes', { limits: { maxNodes: 1.5 } }],
  ]
  it.each(badOptions)('%s', (_name, options) => {
    expect(() => compareMirror([{ id: 'a' }], [{ id: 'a' }], options as MirrorOptions)).toThrowError(
      expect.objectContaining({ name: 'ParityError', code: 'bad-options' }) as Error,
    )
  })

  it('an options getter that throws is a bad-options error', () => {
    const options = { get key(): string { throw new Error('x') } }
    expect(() => compareMirror([], [], options)).toThrowError(expect.objectContaining({ code: 'bad-options' }) as Error)
  })

  it('maxRecords is enforced', () => {
    expect(() => compareMirror(programs(11), programs(11), { limits: { maxRecords: 10 } })).toThrowError(
      expect.objectContaining({ code: 'too-large' }) as Error,
    )
  })

  it('maxNodes is enforced', () => {
    expect(() => compareMirror(programs(100), programs(100), { limits: { maxNodes: 50 } })).toThrowError(
      expect.objectContaining({ code: 'too-large' }) as Error,
    )
  })
})

// ---------------------------------------------------------------------------
// findHandTypedConstants
// ---------------------------------------------------------------------------

describe('findHandTypedConstants: token boundaries', () => {
  const reg = [{ id: 'cpp', value: 1.25 }]
  const found: Array<[string, string]> = [
    ['a plain number', 'earns 1.25 cents per point'],
    ['a trailing zero', 'earns 1.250 cents'],
    ['a dollar sign', 'costs $1.25 each'],
    ['brackets', 'value (1.25) here'],
    ['a unit glued on', 'a 1.25x multiplier'],
    ['a cent sign', 'worth 1.25¢'],
    ['a sentence end', 'it is 1.25.'],
    ['a comma after', 'rates 1.25, 2.5'],
    ['a csv cell', 'chase,1.25,0.5'],
    ['code', 'const cpp = 1.25;'],
    ['a json value', '{"baselineCpp":1.25}'],
    ['an operator before', 'pts*1.25'],
    ['a subtraction', 'x-1.25'],
    ['the start of the text', '1.25 is it'],
    ['the end of the text', 'is it 1.25'],
    ['a newline after', 'is 1.25\nnext'],
    ['an exponent spelling', 'about 125e-2 points'],
    ['an emoji before', '🙂1.25'],
  ]
  it.each(found)('finds 1.25 in %s', (_name, text) => {
    const m = findHandTypedConstants(text, reg)
    expect(m).toHaveLength(1)
    expect(m[0]?.id).toBe('cpp')
  })

  const notFound: Array<[string, string]> = [
    ['11.256', 'rate 11.256 here'],
    ['21.25', 'rate 21.25 here'],
    ['1.255', 'rate 1.255 here'],
    ['0.125', 'rate 0.125 here'],
    ['1.2', 'rate 1.2 here'],
    ['a version 1.25.3', 'version 1.25.3 here'],
    ['a version 3.1.25', 'version 3.1.25 here'],
    ['an address 10.1.25.7', 'host 10.1.25.7 here'],
    ['v1.25', 'tag v1.25 here'],
    ['an identifier x_1.25', 'x_1.25 here'],
    ['an identifier 1.25_x', '1.25_x here'],
    ['a longer exponent 1.25e3', 'size 1.25e3 here'],
    ['a negative number', 'delta -1.25 here'],
    ['thousands 1,1.25', 'sum 1,111.25 here'],
    ['a digit run', 'id 1125 here'],
    ['a date-like run', 'on 2026-06-08 here'],
    ['a dotted date 1.25.2026', 'on 1.25.2026 here'],
    ['letters before the digits', 'abc1.25 here'],
  ]
  it.each(notFound)('does not find 1.25 inside %s', (_name, text) => {
    expect(findHandTypedConstants(text, reg)).toEqual([])
  })

  it('finds a leading-dot number and a Unicode minus', () => {
    const half = [{ id: 'half', value: 0.5 }]
    expect(findHandTypedConstants('a .5, (.5), 0.5, x.5, 10.5, 1.5', half).map((x) => x.text)).toEqual(['.5', '.5', '0.5'])
    const neg = [{ id: 'neg', value: -1.25 }]
    expect(findHandTypedConstants('x = \u22121.25 and 1.25', neg).map((x) => x.text)).toEqual(['\u22121.25'])
  })

  it('reports line and column (1-based) for LF, CRLF and CR line ends', () => {
    const text = 'a\nbb 1.25\r\nccc 1.25\rd 1.25'
    const m = findHandTypedConstants(text, reg)
    expect(m.map((x) => [x.line, x.column, x.text])).toEqual([
      [2, 4, '1.25'],
      [3, 5, '1.25'],
      [4, 3, '1.25'],
    ])
    expect(m.map((x) => text.slice(x.index, x.index + x.text.length))).toEqual(['1.25', '1.25', '1.25'])
  })

  it('counts columns in UTF-16 code units', () => {
    expect(findHandTypedConstants('🙂 1.25', reg)[0]).toMatchObject({ line: 1, column: 4, index: 3 })
  })

  it('finds every occurrence, in order, tagged by constant', () => {
    const m = findHandTypedConstants('a 2 b 1.25 c 2 d 1.25', [
      { id: 'two', value: 2 },
      { id: 'cpp', value: 1.25 },
    ])
    expect(m.map((x) => x.id)).toEqual(['two', 'cpp', 'two', 'cpp'])
  })

  it('matches integers by value and by token, never inside a longer number', () => {
    const r = [{ id: 'eight', value: 8 }]
    expect(findHandTypedConstants('page 8, 08, 18, 8.5, 80 and 8', r).map((x) => x.index)).toEqual([5, 28])
  })

  it('matches a negative registry value only when it is typed negative', () => {
    const r = [{ id: 'delta', value: -1.25 }]
    expect(findHandTypedConstants('x = -1.25; y = 1.25; z-1.25', r).map((x) => x.text)).toEqual(['-1.25'])
  })

  it('reads thousands groups and exponents as the number they spell', () => {
    const r = [{ id: 'big', value: 1250 }]
    expect(findHandTypedConstants('1,250 and 1250 and 1.25e3 and 1,25 and 12,500', r).map((x) => x.text)).toEqual(['1,250', '1250', '1.25e3'])
  })

  it('finds a string constant as exact text on word boundaries', () => {
    const r = [{ id: 'prog', value: 'chase-ur' }]
    const m = findHandTypedConstants('use chase-ur, (chase-ur) not xchase-ur or chase-urx or Chase-UR', r)
    expect(m.map((x) => x.index)).toEqual([4, 15])
    expect(m.every((x) => x.kind === 'form')).toBe(true)
  })

  it('finds extra forms, and keeps the longer of an overlapping pair', () => {
    const r = [{ id: 'cpp', value: 1.25, forms: ['1.25 cents', '1,25'] }]
    const m = findHandTypedConstants('worth 1.25 cents or 1,25 or 1.25', r)
    expect(m.map((x) => [x.text, x.kind])).toEqual([
      ['1.25 cents', 'form'],
      ['1,25', 'form'],
      ['1.25', 'number'],
    ])
  })

  it('forms keep the number boundary rules', () => {
    const r = [{ id: 'cpp', value: 9, forms: ['1.25'] }]
    expect(findHandTypedConstants('11.256 and 1.25.3 and v1.25 and 1.25', r).map((x) => x.index)).toEqual([32])
  })

  it('finds nothing in empty text (an empty registry now throws, see DR-3)', () => {
    expect(findHandTypedConstants('', [{ id: 'a', value: 1 }])).toEqual([])
  })

  it('handles lone surrogates in the text', () => {
    expect(findHandTypedConstants('\ud800 1.25 \udc00', reg)).toHaveLength(1)
    expect(findHandTypedConstants('𐀀1.25', reg)).toEqual([])
  })

  it('two constants with the same value are both reported', () => {
    const m = findHandTypedConstants('1.25', [{ id: 'a', value: 1.25 }, { id: 'b', value: 1.25 }])
    expect(m.map((x) => x.id)).toEqual(['a', 'b'])
  })
})

describe('findHandTypedConstants: bad arguments throw ParityError', () => {
  const holes = new Array<unknown>(1)
  const cases: Array<[string, unknown, unknown, string]> = [
    ['text that is not a string', 5, [], 'bad-input'],
    ['text that is null', null, [], 'bad-input'],
    ['a registry that is not an array', '1.25', 'x', 'bad-registry'],
    ['a registry with a hole', '1.25', holes, 'bad-registry'],
    ['an entry that is not an object', '1.25', [5], 'bad-registry'],
    ['an entry without an id', '1.25', [{ value: 1 }], 'bad-registry'],
    ['an empty id', '1.25', [{ id: '', value: 1 }], 'bad-registry'],
    ['a duplicate id', '1.25', [{ id: 'a', value: 1 }, { id: 'a', value: 2 }], 'bad-registry'],
    ['a NaN value', '1.25', [{ id: 'a', value: NaN }], 'bad-registry'],
    ['an Infinity value', '1.25', [{ id: 'a', value: Infinity }], 'bad-registry'],
    ['an empty string value', '1.25', [{ id: 'a', value: '' }], 'bad-registry'],
    ['a value of the wrong type', '1.25', [{ id: 'a', value: true }], 'bad-registry'],
    ['forms that are not an array', '1.25', [{ id: 'a', value: 1, forms: '1' }], 'bad-registry'],
    ['an empty form', '1.25', [{ id: 'a', value: 1, forms: [''] }], 'bad-registry'],
    ['a throwing getter', '1.25', [{ id: 'a', get value(): number { throw new Error('x') } }], 'bad-registry'],
    ['a revoked proxy registry', '1.25', (() => { const p = Proxy.revocable([], {}); p.revoke(); return p.proxy })(), 'bad-registry'],
  ]
  it.each(cases)('%s', (_name, text, registry, code) => {
    expect(() => findHandTypedConstants(text as string, registry as never)).toThrowError(
      expect.objectContaining({ name: 'ParityError', code }) as Error,
    )
  })

  it('reads each registry getter once', () => {
    let reads = 0
    const entry = { id: 'a', get value(): number { reads += 1; return 1.25 } }
    findHandTypedConstants('1.25 1.25 1.25', [entry])
    expect(reads).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// auditReviewStamps
// ---------------------------------------------------------------------------

const audit = (before: unknown, after: unknown, options: Partial<StampOptions> = {}) =>
  auditReviewStamps(before, after, { reviewedField: 'reviewedOn', sourceFields: ['source'], ...options })

const rec = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  value: 1,
  source: 'https://example.test/a',
  reviewedOn: '2026-06-08',
  ...over,
})

describe('auditReviewStamps: an honest recheck passes', () => {
  const NOW = new Date('2026-10-10T12:00:00Z')
  const honest: Array<[string, unknown, unknown, Partial<StampOptions>?]> = [
    ['nothing changed', [rec('a')], [rec('a')]],
    ['a value changed and the date moved', [rec('a')], [rec('a', { value: 2, reviewedOn: '2026-09-01' })]],
    ['the source changed and the date moved', [rec('a')], [rec('a', { source: 'https://example.test/b', reviewedOn: '2026-09-01' })]],
    ['a field was added and the date moved', [rec('a')], [rec('a', { note: 'x', reviewedOn: '2026-09-01' })]],
    ['the reviewer changed and the date moved', [rec('a', { by: 'p' })], [rec('a', { by: 'q', reviewedOn: '2026-09-01' })], { reviewerField: 'by' }],
    ['a value changed and the date did not move', [rec('a')], [rec('a', { value: 2 })]],
    ['five records rechecked on one day, each with a change', [1, 2, 3, 4, 5].map((i) => rec(`r${i}`)), [1, 2, 3, 4, 5].map((i) => rec(`r${i}`, { value: i + 10, reviewedOn: '2026-09-01' }))],
    ['ten records moved to one date, exactly the default threshold', Array.from({ length: 10 }, (_, i) => rec(`r${i}`)), Array.from({ length: 10 }, (_, i) => rec(`r${i}`, { value: 9, reviewedOn: '2026-09-01' }))],
    ['a new record with a past date', [rec('a')], [rec('a'), rec('b', { reviewedOn: '2026-10-01' })]],
    ['a record removed', [rec('a'), rec('b')], [rec('a')]],
    ['the same instant written another way', [rec('a', { reviewedOn: '2026-06-09' })], [rec('a', { reviewedOn: '2026-06-09T01:00:00+01:00' })]],
    ['an auto-updated field listed in valueFields-free mode, ignored', [rec('a', { updatedAt: '1' })], [rec('a', { updatedAt: '2' })], { ignoreFields: ['updatedAt'] }],
    ['today as a bare date, with now supplied', [rec('a')], [rec('a', { value: 3, reviewedOn: '2026-10-10' })], { now: NOW }],
    ['tomorrow as a bare date, inside the 14-hour grace', [rec('a')], [rec('a', { value: 3, reviewedOn: '2026-10-11' })], { now: NOW }],
    ['a timestamp exactly at now', [rec('a')], [rec('a', { value: 3, reviewedOn: '2026-10-10T12:00:00Z' })], { now: NOW }],
    ['a deadline moved later with a new source', [rec('a', { expires: '2026-12-01' })], [rec('a', { source: 'https://example.test/c', expires: '2027-06-01', reviewedOn: '2026-09-01' })], { expiryField: 'expires' }],
    ['a deadline moved earlier', [rec('a', { expires: '2026-12-01' })], [rec('a', { expires: '2026-11-01' })], { expiryField: 'expires' }],
    ['a deadline that did not move', [rec('a', { expires: '2026-12-01' })], [rec('a', { expires: '2026-12-01' })], { expiryField: 'expires' }],
    ['a deadline added', [rec('a')], [rec('a', { expires: '2026-12-01' })], { expiryField: 'expires' }],
    ['both snapshots empty with allowEmpty', [], [], { allowEmpty: true }],
    ['id-keyed objects', { a: rec('a') }, { a: rec('a', { value: 5, reviewedOn: '2026-09-01' }) }],
    ['the same instant at another offset', [rec('a', { reviewedOn: '2026-06-08T23:30:00-05:00' })], [rec('a', { reviewedOn: '2026-06-09T04:30:00Z' })]],
    ['a leap day', [rec('a', { reviewedOn: '2024-02-28' })], [rec('a', { value: 2, reviewedOn: '2024-02-29' })]],
  ]
  it.each(honest)('%s', (_name, before, after, options) => {
    const r = audit(before, after, options)
    expect(r.status).toBe('ok')
    expect(r.ok).toBe(true)
    expect(r.stampOnly).toEqual([])
    expect(r.bulkBump).toEqual([])
    expect(r.future).toEqual([])
    expect(r.backward).toEqual([])
    expect(r.extendedDeadlines).toEqual([])
    expect(r.unknown).toEqual([])
    expect(r.invalid).toEqual([])
  })
})

describe('auditReviewStamps: unearned stamps are flagged', () => {
  it('a stamp-only bump of one record', () => {
    const r = audit([rec('a')], [rec('a', { reviewedOn: '2026-09-01' })])
    expect(r.status).toBe('flagged')
    expect(r.stampOnly).toEqual([{ id: 'a', from: '2026-06-08', to: '2026-09-01' }])
  })

  it('a stamp-only bump of 67 records on one date: every record and the bulk', () => {
    const before = Array.from({ length: 67 }, (_, i) => rec(`card-${i}`))
    const after = before.map((r) => ({ ...r, reviewedOn: '2026-10-10' }))
    const r = audit(before, after)
    expect(r.status).toBe('flagged')
    expect(r.stampOnly).toHaveLength(67)
    expect(r.bulkBump).toHaveLength(1)
    expect(r.bulkBump[0]).toMatchObject({ date: '2026-10-10', count: 67, withEvidence: 0 })
    expect(r.bulkBump[0]?.ids).toHaveLength(67)
  })

  it('a bulk bump where every record also changed is still a bulk bump, with the evidence counted', () => {
    const before = Array.from({ length: 11 }, (_, i) => rec(`r${i}`))
    const after = before.map((r, i) => ({ ...r, value: 100 + i, reviewedOn: '2026-10-10' }))
    const r = audit(before, after)
    expect(r.stampOnly).toEqual([])
    expect(r.bulkBump).toMatchObject([{ date: '2026-10-10', count: 11, withEvidence: 11 }])
    expect(r.status).toBe('flagged')
  })

  it('bulkThreshold is "more than", and is configurable', () => {
    const before = Array.from({ length: 4 }, (_, i) => rec(`r${i}`))
    const after = before.map((r, i) => ({ ...r, value: 100 + i, reviewedOn: '2026-10-10' }))
    expect(audit(before, after, { bulkThreshold: 4 }).bulkBump).toEqual([])
    expect(audit(before, after, { bulkThreshold: 3 }).bulkBump).toHaveLength(1)
    expect(audit(before, after, { bulkThreshold: 0 }).bulkBump).toHaveLength(1)
  })

  it('a script that stamps a different timestamp on every record is still one bulk bump', () => {
    const before = Array.from({ length: 30 }, (_, i) => rec(`r${i}`))
    const after = before.map((r, i) => ({ ...r, reviewedOn: `2026-10-10T09:00:${String(i).padStart(2, '0')}.${100 + i}Z` }))
    const r = audit(before, after)
    expect(r.bulkBump).toMatchObject([{ date: '2026-10-10', count: 30, withEvidence: 0 }])
    expect(r.stampOnly).toHaveLength(30)
  })

  it('the bulk day is the UTC day of the new stamp', () => {
    const before = Array.from({ length: 12 }, (_, i) => rec(`r${i}`))
    const after = before.map((r) => ({ ...r, value: 7, reviewedOn: '2026-10-10T23:30:00-05:00' }))
    expect(audit(before, after).bulkBump).toMatchObject([{ date: '2026-10-11', count: 12 }])
  })

  it('records moving to different dates are not one bulk bump', () => {
    const before = Array.from({ length: 12 }, (_, i) => rec(`r${i}`))
    const after = before.map((r, i) => ({ ...r, value: 100 + i, reviewedOn: `2026-09-${String(i + 1).padStart(2, '0')}` }))
    expect(audit(before, after).bulkBump).toEqual([])
  })

  it.each([
    ['a second later', '2026-06-08T10:00:00Z', '2026-06-08T10:00:01Z'],
    ['a millisecond later', '2026-06-08T10:00:00.000Z', '2026-06-08T10:00:00.001Z'],
    ['a fraction later', '2026-06-08T10:00:00.5Z', '2026-06-08T10:00:00.9Z'],
    ['the same wall clock in an earlier zone', '2026-06-08T10:00:00+02:00', '2026-06-08T10:00:00+01:00'],
    ['a date to a later timestamp the same day', '2026-06-08', '2026-06-08T00:00:01Z'],
    ['across a year end', '2025-12-31', '2026-01-01'],
    ['across a leap day', '2024-02-28', '2024-03-01'],
  ])('a stamp-only move is detected: %s', (_name, from, to) => {
    const r = audit([rec('a', { reviewedOn: from })], [rec('a', { reviewedOn: to })])
    expect(r.stampOnly).toEqual([{ id: 'a', from, to }])
  })

  it('a stamp that moved backward', () => {
    const r = audit([rec('a')], [rec('a', { reviewedOn: '2026-05-01' })])
    expect(r.status).toBe('flagged')
    expect(r.backward).toEqual([{ id: 'a', from: '2026-06-08', to: '2026-05-01' }])
    expect(r.stampOnly).toEqual([])
  })

  it('a backward move is flagged even when the value changed too', () => {
    expect(audit([rec('a')], [rec('a', { value: 9, reviewedOn: '2026-05-01' })]).backward).toHaveLength(1)
  })

  const NOW = '2026-10-10T12:00:00Z'
  it.each([
    ['a date two days ahead', '2026-10-12'],
    ['a date a year ahead', '2027-10-10'],
    ['a timestamp one second ahead', '2026-10-10T12:00:01Z'],
    ['an offset timestamp ahead', '2026-10-10T15:00:00+02:00'],
    ['a date just past the 14-hour grace', '2026-10-12'],
  ])('a future stamp: %s', (_name, reviewedOn) => {
    const r = audit([rec('a')], [rec('a', { value: 2, reviewedOn })], { now: NOW })
    expect(r.status).toBe('flagged')
    expect(r.future).toEqual([{ id: 'a', value: reviewedOn }])
  })

  it('a future stamp on a record that did not change, or is new, is flagged', () => {
    const r = audit([rec('a', { reviewedOn: '2027-01-01' })], [rec('a', { reviewedOn: '2027-01-01' }), rec('b', { reviewedOn: '2027-02-02' })], { now: NOW })
    expect(r.future.map((f) => f.id)).toEqual(['a', 'b'])
  })

  it('without now, the clock is never read and future stamps are not judged', () => {
    const r = audit([rec('a')], [rec('a', { value: 2, reviewedOn: '2999-01-01' })])
    expect(r.future).toEqual([])
    expect(r.ok).toBe(true)
  })

  it('an extended deadline with no source change', () => {
    const r = audit(
      [rec('a', { expires: '2026-12-01' })],
      [rec('a', { value: 2, expires: '2027-06-01', reviewedOn: '2026-09-01' })],
      { expiryField: 'expires' },
    )
    expect(r.status).toBe('flagged')
    expect(r.extendedDeadlines).toEqual([{ id: 'a', from: '2026-12-01', to: '2027-06-01' }])
  })

  it('an updatedAt that always changes hides a stamp-only bump unless ignored', () => {
    const before = [rec('a', { updatedAt: '1' })]
    const after = [rec('a', { updatedAt: '2', reviewedOn: '2026-09-01' })]
    expect(audit(before, after).stampOnly).toEqual([])
    expect(audit(before, after, { ignoreFields: ['updatedAt'] }).stampOnly).toHaveLength(1)
  })

  it('valueFields limits which fields count as evidence', () => {
    const before = [rec('a', { note: 'x' })]
    const after = [rec('a', { note: 'y', reviewedOn: '2026-09-01' })]
    expect(audit(before, after).stampOnly).toEqual([])
    expect(audit(before, after, { valueFields: ['value'] }).stampOnly).toHaveLength(1)
  })

  it('a changed source still counts as evidence under valueFields', () => {
    const before = [rec('a')]
    const after = [rec('a', { source: 'https://example.test/z', reviewedOn: '2026-09-01' })]
    expect(audit(before, after, { valueFields: ['value'] }).stampOnly).toEqual([])
  })

  it('a duplicate key in the new snapshot is flagged and not judged', () => {
    const r = audit([rec('a')], [rec('a', { reviewedOn: '2026-09-01' }), rec('a', { reviewedOn: '2026-09-02' })])
    expect(r.duplicateKeys).toEqual([{ side: 'after', id: 'a', positions: [0, 1] }])
    expect(r.status).toBe('flagged')
    expect(r.stampOnly).toEqual([])
  })

  it('a renamed look-alike key is added and removed and listed as suspect, never as ok', () => {
    const r = audit([rec('café')], [rec('café', { reviewedOn: '2026-09-01' })])
    expect(r.added).toEqual(['café'])
    expect(r.removed).toEqual(['café'])
    expect(r.suspectKeys).toHaveLength(1)
    expect(r.ok).toBe(false)
  })
})

describe('auditReviewStamps: dates that cannot be judged are unknown, never a pass', () => {
  const bad: Array<[string, unknown, string]> = [
    ['a missing stamp', undefined, 'missing'],
    ['a null stamp', null, 'missing'],
    ['an empty stamp', '', 'missing'],
    ['a number', 20260608, 'not-a-string'],
    ['a Date object', new Date('2026-06-08'), 'not-a-string'],
    ['a zoneless timestamp', '2026-06-08T10:00:00', 'zoneless-timestamp'],
    ['a zoneless timestamp without seconds', '2026-06-08T10:00', 'zoneless-timestamp'],
    ['a prose date', 'June 8, 2026', 'unparseable-date'],
    ['a US date', '06/08/2026', 'unparseable-date'],
    ['a basic-format date', '20260608', 'unparseable-date'],
    ['a space separator', '2026-06-08 10:00:00Z', 'unparseable-date'],
    ['a lowercase t', '2026-06-08t10:00:00Z', 'unparseable-date'],
    ['a lowercase z', '2026-06-08T10:00:00z', 'unparseable-date'],
    ['an offset without a colon', '2026-06-08T10:00:00+0200', 'unparseable-date'],
    ['hour 24', '2026-06-08T24:00:00Z', 'unparseable-date'],
    ['a leap second', '2026-06-08T10:00:60Z', 'unparseable-date'],
    ['month 13', '2026-13-01', 'unparseable-date'],
    ['day 32', '2026-01-32', 'unparseable-date'],
    ['Feb 29 in a common year', '2026-02-29', 'unparseable-date'],
    ['Feb 29 in 1900', '1900-02-29', 'unparseable-date'],
    ['year 0000', '0000-01-01', 'unparseable-date'],
    ['a one-digit month', '2026-6-08', 'unparseable-date'],
    ['trailing text', '2026-06-08 (approx)', 'unparseable-date'],
    ['leading whitespace', ' 2026-06-08', 'unparseable-date'],
    ['a trailing newline', '2026-06-08\n', 'unparseable-date'],
    ['a long fraction', '2026-06-08T10:00:00.1234567890Z', 'unparseable-date'],
    ['an empty fraction', '2026-06-08T10:00:00.Z', 'unparseable-date'],
    ['an offset of 24 hours', '2026-06-08T10:00:00+24:00', 'unparseable-date'],
    ['a fullwidth digit', '２026-06-08', 'unparseable-date'],
  ]
  it.each(bad)('an unusable stamp after the change: %s', (_name, value, reason) => {
    const r = audit([rec('a')], [{ ...rec('a'), reviewedOn: value }])
    expect(r.ok).toBe(false)
    expect(r.unknown.find((u) => u.side === 'after')?.reason).toBe(reason)
    expect(r.stampOnly).toEqual([])
    expect(r.future).toEqual([])
  })

  it('an unusable stamp before the change is unknown when the stamp moved', () => {
    const r = audit([rec('a', { reviewedOn: 'sometime' })], [rec('a', { reviewedOn: '2026-09-01' })])
    expect(r.unknown).toMatchObject([{ id: 'a', side: 'before', reason: 'unparseable-date', value: 'sometime' }])
    expect(r.stampOnly).toEqual([])
    expect(r.ok).toBe(false)
  })

  it('a stamp that is missing in both snapshots is not a pass', () => {
    const r = audit([{ id: 'a', value: 1, source: 's' }], [{ id: 'a', value: 1, source: 's' }])
    expect(r.ok).toBe(false)
    expect(r.unknown).toMatchObject([{ id: 'a', side: 'after', reason: 'missing' }])
  })

  it('a removed stamp is unknown, not backward', () => {
    const r = audit([rec('a')], [{ id: 'a', value: 1, source: 'https://example.test/a' }])
    expect(r.ok).toBe(false)
    expect(r.unknown.map((u) => u.reason)).toContain('missing')
    expect(r.backward).toEqual([])
  })

  it('a removed deadline is unknown', () => {
    const r = audit([rec('a', { expires: '2026-12-01' })], [rec('a')], { expiryField: 'expires' })
    expect(r.unknown).toMatchObject([{ id: 'a', side: 'after', field: 'expires', reason: 'expiry-removed', value: '2026-12-01' }])
    expect(r.ok).toBe(false)
  })

  it('an unparseable deadline that moved is unknown, not an extension', () => {
    const r = audit([rec('a', { expires: '2026-12-01' })], [rec('a', { expires: 'next spring' })], { expiryField: 'expires' })
    expect(r.unknown).toMatchObject([{ side: 'after', field: 'expires', reason: 'unparseable-date' }])
    expect(r.extendedDeadlines).toEqual([])
  })

  it('an empty snapshot is not a pass', () => {
    expect(audit([], [rec('a')]).ok).toBe(false)
    expect(audit([rec('a')], []).ok).toBe(false)
    expect(audit([], []).ok).toBe(false)
  })

  it('readable records are still judged when another record is unreadable', () => {
    const r = audit([rec('a'), null], [rec('a', { reviewedOn: '2026-09-01' }), null])
    expect(r.stampOnly).toHaveLength(1)
    expect(r.invalid).toHaveLength(2)
  })
})

describe('auditReviewStamps: whole-call problems throw ParityError', () => {
  const ok = { reviewedField: 'reviewedOn', sourceFields: ['source'] }
  const badOptions: Array<[string, unknown]> = [
    ['no options', undefined],
    ['no reviewedField', { sourceFields: [] }],
    ['no sourceFields', { reviewedField: 'reviewedOn' }],
    ['a misspelled option', { ...ok, reviewerFeild: 'by' }],
    ['sourceFields that are not an array', { ...ok, sourceFields: 'source' }],
    ['a field both evidence and ignored', { ...ok, ignoreFields: ['source'] }],
    ['a negative threshold', { ...ok, bulkThreshold: -1 }],
    ['a fractional threshold', { ...ok, bulkThreshold: 1.5 }],
    ['a NaN threshold', { ...ok, bulkThreshold: NaN }],
    ['a date-only now', { ...ok, now: '2026-10-10' }],
    ['a zoneless now', { ...ok, now: '2026-10-10T12:00:00' }],
    ['an invalid Date now', { ...ok, now: new Date(NaN) }],
    ['a NaN now', { ...ok, now: NaN }],
    ['a plain object now', { ...ok, now: {} }],
    ['a boolean now', { ...ok, now: true }],
  ]
  it.each(badOptions)('%s', (_name, options) => {
    expect(() => auditReviewStamps([rec('a')], [rec('a')], options as StampOptions)).toThrowError(
      expect.objectContaining({ name: 'ParityError', code: 'bad-options' }) as Error,
    )
  })

  it('now accepts a Date, epoch milliseconds, or a zoned timestamp, including from another realm', () => {
    const after = [rec('a', { value: 2, reviewedOn: '2026-10-12' })]
    for (const now of [new Date('2026-10-10T12:00:00Z'), Date.parse('2026-10-10T12:00:00Z'), '2026-10-10T12:00:00Z', vm.runInNewContext("new Date('2026-10-10T12:00:00Z')")]) {
      expect(audit([rec('a')], after, { now: now as Date }).future).toHaveLength(1)
    }
  })

  it('a snapshot that is not a dataset throws', () => {
    expect(() => audit(null, [])).toThrowError(expect.objectContaining({ code: 'bad-input' }) as Error)
    expect(() => audit([], 'x')).toThrowError(expect.objectContaining({ code: 'bad-input' }) as Error)
  })
})

// ---------------------------------------------------------------------------
// Fix round 1: rows added after review of 9bdd500
// ---------------------------------------------------------------------------

describe('findHandTypedConstants: literal forms share the number lexer boundaries', () => {
  const texts = (text: string, registry: Parameters<typeof findHandTypedConstants>[1]): string[] =>
    findHandTypedConstants(text, registry).map((m) => `${m.index}:${m.text}`)

  it('a string-valued 1.25 is found in a comma-separated list', () => {
    expect(texts('1.25,0.5', [{ id: 'a', value: '1.25' }])).toEqual(['0:1.25'])
    expect(texts('chase,1.25,0.5', [{ id: 'a', value: '1.25' }])).toEqual(['6:1.25'])
    expect(texts('1.25,0.5', [{ id: 'a', value: 1.25 }])).toEqual(['0:1.25'])
    expect(texts('1.25,0.5', [{ id: 'a', value: '0.5' }])).toEqual(['5:0.5'])
  })

  it('a form that is the tail of a thousands-grouped number is not found', () => {
    expect(texts('1,250', [{ id: 'a', value: 250, forms: ['250'] }])).toEqual([])
    expect(texts('1,250', [{ id: 'a', value: '250' }])).toEqual([])
    expect(texts('1,250', [{ id: 'a', value: '1' }])).toEqual([])
  })

  it('a form that is the head, tail or middle of an exponent number is not found', () => {
    expect(texts('1e+8', [{ id: 'a', value: 8, forms: ['8'] }])).toEqual([])
    expect(texts('1e+8', [{ id: 'a', value: '1' }])).toEqual([])
    expect(texts('1e+8', [{ id: 'a', value: '1e' }])).toEqual([])
  })

  it('a form is found when it is exactly a token, including a grouped or exponent token', () => {
    expect(texts('x 1,250 y', [{ id: 'a', value: 9, forms: ['1,250'] }])).toEqual(['2:1,250'])
    expect(texts('x 1e+8 y', [{ id: 'a', value: 9, forms: ['1e+8'] }])).toEqual(['2:1e+8'])
  })

  it('a form with non-digit edges still checks only its own edges', () => {
    expect(texts('rate 1.25 cents, 11.25 cents', [{ id: 'a', value: 9, forms: ['1.25 cents'] }])).toEqual(['5:1.25 cents'])
    expect(texts('$1.25 and 1.25.3 and v1.25 and 1.25_x', [{ id: 'a', value: '$1.25' }])).toEqual(['0:$1.25'])
  })

  it('pins the tokenization of commas: a three-digit group is thousands, anything else separates', () => {
    const v = (value: number): string[] => texts('1,250 | 1,25 | 1,250,5 | 12,34,567 | 1.25,0.5', [{ id: 'a', value }])
    expect(v(1250)).toEqual(['0:1,250', '15:1,250'])
    expect(v(250)).toEqual([])
    expect(v(1)).toEqual(['8:1'])
    expect(v(25)).toEqual(['10:25'])
    expect(v(5)).toEqual(['21:5'])
    expect(v(12)).toEqual(['25:12'])
    expect(v(34567)).toEqual(['28:34,567'])
    expect(v(1.25)).toEqual(['37:1.25'])
    expect(v(0.5)).toEqual(['42:0.5'])
  })

  it('an adjacent non-ASCII decimal digit is part of a longer number, so nothing is found', () => {
    for (const digit of ['６', '٣', '२']) {
      expect(texts(`1.25${digit}`, [{ id: 'a', value: 1.25 }])).toEqual([])
      expect(texts(`1.25${digit}`, [{ id: 'a', value: '1.25' }])).toEqual([])
      expect(texts(`1.25${digit}`, [{ id: 'a', value: 9, forms: ['1.25'] }])).toEqual([])
      expect(texts(`${digit}1.25`, [{ id: 'a', value: 1.25 }])).toEqual([])
      expect(texts(`${digit}1.25`, [{ id: 'a', value: '1.25' }])).toEqual([])
    }
  })

  it('a non-digit symbol after the number is still fine', () => {
    expect(texts('1.25¢ and 1.25%', [{ id: 'a', value: '1.25' }])).toEqual(['0:1.25', '10:1.25'])
  })
})

describe('compareMirror: the depth limit is inclusive', () => {
  const nest = (levels: number, leaf: unknown): unknown => {
    let v = leaf
    for (let i = 0; i < levels; i += 1) v = { x: v }
    return v
  }
  const reasons = (maxDepth: number, v: unknown): string[] =>
    compareMirror([{ id: 'a', v }], [{ id: 'a', v }], { limits: { maxDepth } }).invalid.map((i) => i.reason)

  it('maxDepth 1 allows a container directly in a field and rejects one inside it', () => {
    expect(reasons(1, {})).toEqual([])
    expect(reasons(1, [])).toEqual([])
    expect(reasons(1, { x: 1 })).toEqual([])
    expect(reasons(1, [1, 'a', null])).toEqual([])
    expect(reasons(1, { x: {} })).toEqual(['too-deep', 'too-deep'])
    expect(reasons(1, [[]])).toEqual(['too-deep', 'too-deep'])
  })

  it('maxDepth N allows exactly N levels of containers in a field', () => {
    for (const n of [1, 2, 3, 10, 64]) {
      expect(reasons(n, nest(n, 'leaf'))).toEqual([])
      expect(reasons(n, nest(n + 1, 'leaf'))).toEqual(['too-deep', 'too-deep'])
    }
  })

  it('the default depth is 64 levels', () => {
    expect(compareMirror([{ id: 'a', v: nest(64, 1) }], [{ id: 'a', v: nest(64, 1) }]).ok).toBe(true)
    expect(compareMirror([{ id: 'a', v: nest(65, 1) }], [{ id: 'a', v: nest(65, 1) }]).invalid).toHaveLength(2)
  })
})

describe('compareMirror and auditReviewStamps: a revoked or hostile options object is a bad-options error', () => {
  const revoked = (): object => {
    const p = Proxy.revocable({}, {})
    p.revoke()
    return p.proxy
  }
  const code = (fn: () => unknown): unknown => {
    try {
      fn()
    } catch (e) {
      return (e as { code?: string }).code ?? (e as Error).name
    }
    return 'no error'
  }

  it('revoked proxy options', () => {
    expect(code(() => compareMirror([{ id: 'a' }], [{ id: 'a' }], revoked() as MirrorOptions))).toBe('bad-options')
    expect(code(() => auditReviewStamps([{ id: 'a' }], [{ id: 'a' }], revoked() as StampOptions))).toBe('bad-options')
  })

  it('a revoked proxy as limits', () => {
    expect(code(() => compareMirror([{ id: 'a' }], [{ id: 'a' }], { limits: revoked() }))).toBe('bad-options')
  })

  it('options whose getPrototypeOf throws', () => {
    const p = new Proxy({}, { getPrototypeOf() { throw new Error('no prototype') } })
    expect(code(() => compareMirror([{ id: 'a' }], [{ id: 'a' }], p as MirrorOptions))).toBe('bad-options')
  })
})

describe('compareMirror: a record keeps its identity when its prototype cannot be read', () => {
  it('a Proxy whose getPrototypeOf throws is an unreadable record, not a missing one', () => {
    const p = new Proxy({ id: 'a', v: 1 }, { getPrototypeOf() { throw new Error('no prototype') } })
    const r = compareMirror([{ id: 'a', v: 1 }], [p])
    expect(r.missing).toEqual([])
    expect(r.extra).toEqual([])
    expect(r.invalid).toMatchObject([{ side: 'mirror', id: 'a', reason: 'unreadable' }])
    expect(r.status).toBe('unknown')
  })

  it('the same on the canonical side', () => {
    const p = new Proxy({ id: 'a', v: 1 }, { getPrototypeOf() { throw new Error('no prototype') } })
    const r = compareMirror([p], [{ id: 'a', v: 1 }])
    expect(r.extra).toEqual([])
    expect(r.missing).toEqual([])
    expect(r.status).toBe('unknown')
  })

  it('a class instance with a readable id is invalid but not missing', () => {
    class K {
      id = 'a'
    }
    const r = compareMirror([{ id: 'a' }], [new K()])
    expect(r.missing).toEqual([])
    expect(r.invalid).toMatchObject([{ id: 'a', reason: 'not-a-plain-object' }])
  })
})

// ---------------------------------------------------------------------------
// Fix round 1, batch 2
// ---------------------------------------------------------------------------

describe('findHandTypedConstants: duplicates and overlaps', () => {
  const texts = (text: string, registry: Parameters<typeof findHandTypedConstants>[1]): string[] =>
    findHandTypedConstants(text, registry).map((m) => `${m.id}@${m.index}:${m.text}`)

  it('two overlapping literal hits for the same constant are both reported', () => {
    expect(texts('foo-bar-baz', [{ id: 'x', value: 'foo-bar', forms: ['bar-baz'] }])).toEqual(['x@0:foo-bar', 'x@4:bar-baz'])
  })

  it('nested literal forms of one constant are all reported', () => {
    expect(texts('ab abc', [{ id: 'x', value: 'ab', forms: ['abc', 'ab abc'] }])).toEqual(['x@0:ab abc', 'x@0:ab', 'x@3:abc'])
  })

  it('a repeated form is reported once per place', () => {
    expect(texts('--', [{ id: 'x', value: '-', forms: ['-', '-', '-'] }])).toEqual(['x@0:-', 'x@1:-'])
  })

  it('the same value under two ids is still reported for each id', () => {
    expect(texts('ab', [{ id: 'x', value: 'ab' }, { id: 'y', value: 'ab', forms: ['ab'] }])).toEqual(['x@0:ab', 'y@0:ab'])
  })

  it('a number hit inside a longer literal hit of the same constant still collapses to the literal', () => {
    expect(texts('worth 1.25 cents', [{ id: 'x', value: 1.25, forms: ['1.25 cents'] }])).toEqual(['x@6:1.25 cents'])
  })

  it('a literal form that would end inside a longer number is not a hit; the number is', () => {
    expect(texts('x 1.250 y', [{ id: 'x', value: 1.25, forms: ['1.25'] }])).toEqual(['x@2:1.250'])
  })

  it('a literal hit and a number hit of the same range are reported once, as a number', () => {
    const m = findHandTypedConstants('1.25', [{ id: 'x', value: 1.25, forms: ['1.25'] }])
    expect(m.map((h) => h.kind)).toEqual(['number'])
  })
})

describe('compareMirror: explicitly requested key fields, work accounting, and expiry', () => {
  it('fields: ["id"] compares the id field when the records carry it', () => {
    const r = compareMirror({ a: {} }, { a: { id: 'a' } }, { fields: ['id'] })
    expect(r.ok).toBe(false)
    expect(r.changed).toEqual([{ id: 'a', field: 'id', change: 'extra-in-mirror', canonical: undefined, mirror: 'a' }])
  })

  it('without an explicit request the key field is still left out', () => {
    expect(compareMirror({ a: {} }, { a: { id: 'a' } }).ok).toBe(true)
  })

  it('a reviewedField that is the key field can be read', () => {
    const r = compareMirror([{ id: 'a', v: 1 }], [{ id: 'a', v: 2 }], { reviewedField: 'id' })
    expect(r.stampHidesDrift).toMatchObject([{ id: 'a', reviewedValue: 'a', fields: ['v'] }])
  })

  it('every selected-field probe is charged, present or absent', () => {
    const fields = Array.from({ length: 1000 }, (_, i) => `f${i}`)
    expect(() => compareMirror([{ id: 'a' }], [{ id: 'a' }], { fields, limits: { maxNodes: 2 } })).toThrowError(
      expect.objectContaining({ code: 'too-large' }) as Error,
    )
    const many = Array.from({ length: 2000 }, (_, i) => ({ id: `r${i}` }))
    expect(() => compareMirror(many, many, { fields, limits: { maxNodes: 100_000 } })).toThrowError(
      expect.objectContaining({ code: 'too-large' }) as Error,
    )
  })

  it('a modest number of selected fields still works at the default limits', () => {
    const fields = Array.from({ length: 20 }, (_, i) => `f${i}`)
    const many = Array.from({ length: 5000 }, (_, i) => ({ id: `r${i}`, f1: i }))
    const r = compareMirror(many, many, { fields })
    // Nothing differs; the 19 names that no record has are reported as unknown fields.
    expect(r.changed).toEqual([])
    expect(r.invalid).toEqual([])
    expect(r.unknownFields).toHaveLength(19)
  })
})

describe('auditReviewStamps: every present expiry value is checked, moved or not', () => {
  const o = { expiryField: 'expires' }
  const bad: Array<[string, unknown, string]> = [
    ['a garbage string', 'garbage', 'unparseable-date'],
    ['a number', 20261201, 'not-a-string'],
    ['a zoneless timestamp', '2026-12-01T00:00:00', 'zoneless-timestamp'],
    ['an empty string', '', 'missing'],
    ['null', null, 'missing'],
    ['an impossible date', '2026-02-30', 'unparseable-date'],
  ]
  it.each(bad)('an unchanged %s expiry is unknown', (_name, expires, reason) => {
    const r = audit([rec('a', { expires })], [rec('a', { expires })], o)
    expect(r.ok).toBe(false)
    expect(r.unknown).toMatchObject([{ id: 'a', side: 'after', field: 'expires', reason }])
    expect(r.extendedDeadlines).toEqual([])
  })

  it('a new record with a bad expiry is unknown', () => {
    const r = audit([rec('a')], [rec('a'), rec('b', { expires: 'soon' })], o)
    expect(r.unknown).toMatchObject([{ id: 'b', side: 'after', field: 'expires', reason: 'unparseable-date' }])
  })

  it('a bad expiry is reported once when it also moved', () => {
    const r = audit([rec('a', { expires: '2026-12-01' })], [rec('a', { expires: 'soon' })], o)
    expect(r.unknown.filter((u) => u.side === 'after')).toHaveLength(1)
  })

  it('a valid unchanged expiry stays ok', () => {
    expect(audit([rec('a', { expires: '2026-12-01' })], [rec('a', { expires: '2026-12-01' })], o).ok).toBe(true)
  })
})

describe('compareMirror: native objects whose prototype was replaced', () => {
  const swapped = (value: object, proto: object | null): object => Object.setPrototypeOf(value, proto) as object
  const natives: Array<[string, () => object]> = [
    ['a Map', () => new Map([[1, 2]])],
    ['a Set', () => new Set([1])],
    ['a RegExp', () => /x/u],
    ['an ArrayBuffer', () => new ArrayBuffer(4)],
    ['a Uint8Array', () => new Uint8Array([1])],
    ['a DataView', () => new DataView(new ArrayBuffer(2))],
    ['a WeakMap', () => new WeakMap()],
    ['a WeakSet', () => new WeakSet()],
    ['a Promise', () => Promise.resolve(1)],
    ['a boxed Number', () => Object(5) as object],
    ['a boxed Boolean', () => Object(true) as object],
    ['a boxed BigInt', () => Object(5n) as object],
    ['an Error', () => new Error('e')],
    ['a WeakRef', () => new WeakRef({})],
  ]
  for (const [name, make] of natives) {
    it(`${name} with a null prototype is an unsupported value`, () => {
      const r = compareMirror([{ id: 'a', v: swapped(make(), null) }], [{ id: 'a', v: {} }])
      expect(r.ok).toBe(false)
      expect(r.invalid.map((i) => i.reason)).toEqual(['unsupported-value'])
    })
    it(`${name} given Object.prototype is an unsupported value`, () => {
      const r = compareMirror([{ id: 'a', v: swapped(make(), Object.prototype) }], [{ id: 'a', v: {} }])
      expect(r.invalid.map((i) => i.reason)).toEqual(['unsupported-value'])
    })
    it(`${name} as an id-keyed record is not a plain record`, () => {
      const r = compareMirror({ a: swapped(make(), null) }, { a: {} })
      expect(r.ok).toBe(false)
      expect(r.invalid[0]?.reason).toBe('not-a-plain-object')
    })
  }

  it('a boxed String is unsupported on its own prototype; with a replaced prototype its enumerable index properties make it plain data (a documented gap)', () => {
    expect(compareMirror([{ id: 'a', v: Object('s') as object }], [{ id: 'a', v: {} }]).invalid.map((i) => i.reason)).toEqual(['unsupported-value'])
    const swapped = Object.setPrototypeOf(Object('s'), null) as object
    expect(compareMirror([{ id: 'a', v: swapped }], [{ id: 'a', v: { 0: 's' } }]).ok).toBe(true)
  })

  it('a null-prototype Date is a date by brand: equal to the same time, different from {}', () => {
    const mk = (t: number): object => swapped(new Date(t), null)
    expect(compareMirror([{ id: 'a', v: mk(0) }], [{ id: 'a', v: new Date(0) }]).ok).toBe(true)
    expect(compareMirror([{ id: 'a', v: mk(0) }], [{ id: 'a', v: mk(1) }]).ok).toBe(false)
    expect(compareMirror({ a: mk(0) }, { a: {} }).ok).toBe(false)
    expect(compareMirror([{ id: 'a', v: mk(0) }], [{ id: 'a', v: {} }]).ok).toBe(false)
  })

  it('two null-prototype Maps with different entries do not compare equal as empty objects', () => {
    const a = swapped(new Map([[1, 'x']]), null)
    const b = swapped(new Map([[1, 'y']]), null)
    expect(compareMirror([{ id: 'k', v: a }], [{ id: 'k', v: b }]).ok).toBe(false)
  })

  it('ordinary empty objects, null-prototype or not, are still equal', () => {
    expect(compareMirror([{ id: 'k', v: {}, w: Object.create(null) as object }], [{ id: 'k', v: Object.create(null) as object, w: {} }]).ok).toBe(true)
  })

  it('a real Promise is not touched in a way that leaves it unhandled', () => {
    const p = Promise.reject(new Error('later'))
    // The test handles its own rejection. Where util.types rules a Promise out by a slot check (run9:hunt:R9-2) the kit
    // never calls `then`, so it no longer marks the caller's rejected Promise as handled by accident; without util.types
    // the probe still calls `then(noop, noop)`, which leaves no new unhandled rejection either.
    p.catch(() => undefined)
    compareMirror([{ id: 'a', v: swapped(p, null) }], [{ id: 'a', v: {} }])
  })
})

// ---------------------------------------------------------------------------
// Fix round 2: rows added after review of 4c38569
// ---------------------------------------------------------------------------

describe('compareMirror: classifying an object never copies it or reads fields that were not selected', () => {
  it('an excluded getter on an object with no selected fields is never run, so it cannot rewrite another record', () => {
    let runs = 0
    const b = { v: 1 }
    const a = { get ignored(): number { runs += 1; b.v = 2; return 0 } }
    const r = compareMirror({ a: {}, b: { v: 2 } }, { a, b }, { fields: ['v'] })
    expect(runs).toBe(0)
    expect(r.ok).toBe(false)
    expect(r.changed).toMatchObject([{ id: 'b', field: 'v', canonical: 2, mirror: 1 }])
  })

  it('the same in an array dataset, with the excluded getter on a nested empty-looking value', () => {
    let runs = 0
    const target = { v: 1 }
    const empty = { get hidden(): number { runs += 1; target.v = 2; return 0 } }
    const r = compareMirror([{ id: 'a', e: {} }, { id: 'b', v: 2 }], [{ id: 'a', e: empty }, { id: 'b', ...target }], { fields: ['v'] })
    expect(runs).toBe(0)
    expect(r.changed).toMatchObject([{ id: 'b', field: 'v' }])
  })

  it('a large null-prototype ArrayBuffer is not copied, whatever the work limit', () => {
    const buffer = Object.setPrototypeOf(new ArrayBuffer(16 * 1024 * 1024), null) as object
    const before = process.memoryUsage().arrayBuffers
    const r = compareMirror([{ id: 'a', v: buffer }], [{ id: 'a', v: {} }], { limits: { maxNodes: 100 } })
    const grown = process.memoryUsage().arrayBuffers - before
    expect(r.ok).toBe(false)
    expect(grown).toBeLessThan(4 * 1024 * 1024)
  })
})

describe('compareMirror: a Promise whose probe fails after it was recognized is unsupported, never plain data', () => {
  const promiseWith = (proto: object | null, constructorValue: PropertyDescriptor | undefined): object => {
    const p = Object.setPrototypeOf(Promise.resolve(1), proto) as object
    if (constructorValue !== undefined) Object.defineProperty(p, 'constructor', constructorValue)
    return p
  }
  const verdict = (p: object): string[] =>
    compareMirror([{ id: 'a', v: p }], [{ id: 'a', v: {} }]).invalid.map((i) => i.reason)

  it('a null constructor', () => {
    expect(verdict(promiseWith(null, { value: null }))).toEqual(['unsupported-value'])
  })
  it('a string constructor', () => {
    expect(verdict(promiseWith(null, { value: 'x' }))).toEqual(['unsupported-value'])
  })
  it('a throwing constructor getter that is never run', () => {
    let runs = 0
    const p = promiseWith(null, { get() { runs += 1; throw new Error('no') } })
    expect(verdict(p)).toEqual(['unsupported-value'])
    expect(runs).toBe(0)
  })
  it('a constructor whose Symbol.species getter would throw', () => {
    const ctor = Object.defineProperty({}, Symbol.species, { get() { throw new Error('no') } })
    expect(verdict(promiseWith(null, { value: ctor }))).toEqual(['unsupported-value'])
  })
  it('a plain-prototype Promise with a bad constructor', () => {
    expect(verdict(promiseWith(Object.prototype, { value: null }))).toEqual(['unsupported-value'])
  })
  it('a Promise with no constructor at all, or a good one', () => {
    expect(verdict(promiseWith(null, undefined))).toEqual(['unsupported-value'])
    expect(verdict(promiseWith(Object.prototype, undefined))).toEqual(['unsupported-value'])
  })
  it('an ordinary empty object still passes', () => {
    expect(compareMirror([{ id: 'a', v: {} }], [{ id: 'a', v: Object.create(null) as object }]).ok).toBe(true)
  })
  it('an ordinary value with a data field named constructor is compared as data', () => {
    expect(compareMirror([{ id: 'a', v: { constructor: 'x' } }], [{ id: 'a', v: { constructor: 'x' } }]).ok).toBe(true)
    expect(compareMirror([{ id: 'a', v: { constructor: 'x' } }], [{ id: 'a', v: { constructor: 'y' } }]).ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Fix round 4: rows added after review of 2f5e295
// ---------------------------------------------------------------------------

const hasUtilTypes = typeof (process as unknown as { getBuiltinModule?: unknown }).getBuiltinModule === 'function'

describe('compareMirror: the Promise probe is only attempted when it provably cannot run caller code', () => {
  const reasons = (v: object): string[] => compareMirror([{ id: 'a', v }], [{ id: 'a', v: {} }]).invalid.map((i) => i.reason)
  const promiseWith = (proto: object | null, constructorValue?: PropertyDescriptor): object => {
    const p = Object.setPrototypeOf(Promise.resolve(1), proto) as object
    if (constructorValue !== undefined) Object.defineProperty(p, 'constructor', constructorValue)
    return p
  }

  it('a Proxy constructor whose get trap throws is never consulted and is unsupported', () => {
    let touched = 0
    const trap = new Proxy({}, { get() { touched += 1; throw new Error('species') } })
    expect(reasons(promiseWith(null, { value: trap }))).toEqual(['unsupported-value'])
    expect(touched).toBe(0)
  })

  it('an object-valued constructor of any kind is unsupported', () => {
    expect(reasons(promiseWith(null, { value: {} }))).toEqual(['unsupported-value'])
    expect(reasons(promiseWith(null, { value: Object }))).toEqual(['unsupported-value'])
    expect(reasons(promiseWith(Object.prototype, { value: {} }))).toEqual(['unsupported-value'])
  })

  it('a Promise with no constructor, or an own undefined one, on a null or Object.prototype prototype is unsupported', () => {
    expect(reasons(promiseWith(null))).toEqual(['unsupported-value'])
    expect(reasons(promiseWith(Object.prototype))).toEqual(['unsupported-value'])
    expect(reasons(promiseWith(null, { value: undefined }))).toEqual(['unsupported-value'])
    expect(reasons(promiseWith(Object.prototype, { value: undefined }))).toEqual(['unsupported-value'])
  })

  it('a Promise on any other prototype is unsupported without calling then', () => {
    const custom = Object.create(null, { then: { value() { throw new Error('then') } } }) as object
    expect(reasons(promiseWith(custom))).toEqual(['unsupported-value'])
  })

  // Changed by run9:hunt:R9-2 (a deliberate verdict change, named in the commit): with util.types a Promise is ruled
  // out by a slot check, so these two inputs are ordinary data. The conservative reading they used to pin still holds
  // where util.types is missing; test/hostile.test.ts pins it in a fresh process without `process.getBuiltinModule`.
  it.skipIf(!hasUtilTypes)('an empty object on a custom prototype or from another realm is ordinary data where a slot check rules a Promise out', () => {
    const custom = Object.create(Object.create(null) as object) as object
    expect(reasons(custom)).toEqual([])
    const other = vm.runInNewContext('({})') as object
    expect(reasons(other)).toEqual([])
  })

  it('ordinary empty objects, and a populated object from another realm, still pass', () => {
    expect(compareMirror([{ id: 'a', v: {} }], [{ id: 'a', v: Object.create(null) as object }]).ok).toBe(true)
    expect(compareMirror([{ id: 'a', v: vm.runInNewContext("({ x: 1, y: [] })") }], [{ id: 'a', v: { x: 1, y: [] } }]).ok).toBe(true)
  })

  it('populated plain data with a hidden property is plain data', () => {
    const v = Object.defineProperty({ constructor: 'widget', x: 1 }, 'hidden', { value: 0 })
    const r = compareMirror([{ id: 'a', v }], [{ id: 'a', v: { constructor: 'widget', x: 1 } }])
    expect(r.ok).toBe(true)
    expect(r.invalid).toEqual([])
    const w = Object.defineProperty({ x: 1 }, 'hidden', { value: 0 })
    expect(compareMirror([{ id: 'a', v: w }], [{ id: 'a', v: { x: 1 } }]).ok).toBe(true)
  })
})

describe('compareMirror: keys that cannot be analyzed within a bound are invalid records', () => {
  const reasons = (id: string, limits?: { maxKeyLength?: number }): string[] =>
    compareMirror([{ id, v: 1 }], [{ id, v: 1 }], limits === undefined ? undefined : { limits }).invalid.map((i) => i.reason)

  it('a key longer than maxKeyLength (default 4096)', () => {
    expect(reasons('k'.repeat(4096))).toEqual([])
    expect(reasons('k'.repeat(4097))).toEqual(['key-too-long', 'key-too-long'])
  })

  it('maxKeyLength can be lowered or raised', () => {
    expect(reasons('k'.repeat(11), { maxKeyLength: 10 })).toEqual(['key-too-long', 'key-too-long'])
    expect(reasons('k'.repeat(10), { maxKeyLength: 10 })).toEqual([])
    expect(reasons('k'.repeat(10_000), { maxKeyLength: 20_000 })).toEqual([])
    expect(() => compareMirror([], [], { limits: { maxKeyLength: 0 } })).toThrowError(expect.objectContaining({ code: 'bad-options' }) as Error)
  })

  it('a run of more than 32 combining marks', () => {
    expect(reasons(`e${'\u0301'.repeat(32)}`)).toEqual([])
    expect(reasons(`e${'\u0301'.repeat(33)}`)).toEqual(['key-unnormalizable', 'key-unnormalizable'])
    expect(reasons(`e${'\u0315'.repeat(20)}${'\u0300'.repeat(20)}`)).toEqual(['key-unnormalizable', 'key-unnormalizable'])
  })

  it('an id-keyed dataset applies the same limits to its property names', () => {
    const long = 'k'.repeat(5000)
    const r = compareMirror({ [long]: { v: 1 } }, { [long]: { v: 1 } })
    expect(r.invalid.map((i) => i.reason)).toEqual(['key-too-long', 'key-too-long'])
  })

  it('a refused property name is refused before its getter runs, and a throwing getter does not bypass the bound', () => {
    const long = `e${'\u0301'.repeat(64_000)}`
    let ran = 0
    const make = (): Record<string, unknown> =>
      Object.defineProperty({}, long, {
        enumerable: true,
        get() {
          ran += 1
          throw new Error('boom')
        },
      })
    const r = compareMirror(make(), make())
    expect(r.invalid.map((i) => i.reason)).toEqual(['key-too-long', 'key-too-long'])
    expect(ran).toBe(0)
  })

  it('a character that decomposes into a combining mark counts toward the run', () => {
    const id = `e${'\u0301\uFF9E'.repeat(40)}`
    expect(reasons(id, { maxKeyLength: 1_048_576 })).toEqual(['key-unnormalizable', 'key-unnormalizable'])
    expect(reasons(`e${'\u0301\uFF9E'.repeat(16)}`, { maxKeyLength: 1_048_576 })).toEqual([])
  })

  it('an array that carries a readable key keeps its identity and is not reported as missing or extra', () => {
    const arr = Object.assign([], { id: 'a' })
    const r = compareMirror([{ id: 'a' }], [arr])
    expect(r.missing).toEqual([])
    expect(r.extra).toEqual([])
    expect(r.invalid.map((i) => i.reason)).toEqual(['not-an-object'])
    const back = compareMirror([arr], [{ id: 'a' }])
    expect(back.missing).toEqual([])
    expect(back.extra).toEqual([])
  })

  it('a refused key is not reported as missing or extra on the other side', () => {
    const long = 'k'.repeat(5000)
    const r = compareMirror([{ id: long }, { id: 'b' }], [{ id: 'b' }])
    expect(r.missing).toEqual([])
    expect(r.invalid).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Fix round 5: rows added after review of 66b64c4
// ---------------------------------------------------------------------------

describe('compareMirror: emptiness is decided from the record, not from the selection', () => {
  it('a populated record with no selected fields is plain data, so a selected extra field is reported', () => {
    const r = compareMirror({ a: { constructor: 'Widget' } }, { a: { constructor: 'Widget', rate: 2 } }, { fields: ['rate'] })
    expect(r.invalid).toEqual([])
    expect(r.status).toBe('flagged')
    expect(r.changed).toEqual([{ id: 'a', field: 'rate', change: 'extra-in-mirror', canonical: undefined, mirror: 2 }])
  })

  it('the same in an array dataset, and with a record that only has other fields', () => {
    const r = compareMirror([{ id: 'a', other: 1 }], [{ id: 'a', other: 2, rate: 3 }], { fields: ['rate'] })
    expect(r.invalid).toEqual([])
    expect(r.changed).toMatchObject([{ id: 'a', field: 'rate', change: 'extra-in-mirror' }])
  })

  it('excluded getters on such a record are never run', () => {
    let runs = 0
    const record = { id: 'a', get excluded(): number { runs += 1; return 1 } }
    const r = compareMirror([{ id: 'a' }], [record], { fields: ['rate'] })
    expect(runs).toBe(0)
    expect(r.changed).toEqual([])
    expect(r.unknownFields).toEqual(['rate'])
  })

  it('a record with truly nothing in it is still probed (a null-prototype Map as a selected-field record)', () => {
    const map = Object.setPrototypeOf(new Map([[1, 2]]), null) as object
    const r = compareMirror({ a: map }, { a: {} }, { fields: ['rate'] })
    expect(r.ok).toBe(false)
    expect(r.invalid[0]?.reason).toBe('not-a-plain-object')
  })

  it('a record whose only own properties are hidden is still probed', () => {
    const hiddenOnly = Object.defineProperty({}, 'h', { value: 1 })
    const r = compareMirror({ a: hiddenOnly }, { a: {} }, { fields: ['rate'] })
    expect(r.changed).toEqual([])
    expect(r.invalid).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Fix round 6: rows added after the field trial of 8be93f3
// ---------------------------------------------------------------------------

describe('compareMirror: a selected name that appears in no record is reported, never ok (PK-1)', () => {
  it('a misspelled selected field is unknown, not ok', () => {
    const r = compareMirror([{ id: 'a', v: 1 }], [{ id: 'a', v: 2 }], { fields: ['vv'] })
    expect(r.ok).toBe(false)
    expect(r.status).toBe('unknown')
    expect(r.unknownFields).toEqual(['vv'])
    expect(r.changed).toEqual([])
  })

  it('a good name beside a misspelled one still compares, and the typo is still reported', () => {
    const r = compareMirror([{ id: 'a', v: 1 }], [{ id: 'a', v: 2 }], { fields: ['vv', 'v'] })
    expect(r.status).toBe('flagged')
    expect(r.changed).toHaveLength(1)
    expect(r.unknownFields).toEqual(['vv'])
  })

  it('a misspelled reviewedField is reported, and a correct one is not', () => {
    const records = (v: number): unknown[] => [{ id: 'a', v, seen: '2026-01-01' }]
    const bad = compareMirror(records(1), records(2), { reviewedField: 'seenn' })
    expect(bad.unknownFields).toEqual(['seenn'])
    expect(bad.stampHidesDrift).toEqual([])
    const good = compareMirror(records(1), records(2), { reviewedField: 'seen' })
    expect(good.unknownFields).toEqual([])
    expect(good.stampHidesDrift).toHaveLength(1)
  })

  it('a name found on only one side, or the key name itself, is not unknown', () => {
    expect(compareMirror([{ id: 'a' }], [{ id: 'a', v: 1 }], { fields: ['v'] }).unknownFields).toEqual([])
    expect(compareMirror([{ id: 'a', v: 1 }], [{ id: 'a', v: 1 }], { fields: ['id', 'v'] }).unknownFields).toEqual([])
    expect(compareMirror({ a: { v: 1 } }, { a: { v: 1 } }, { fields: ['id', 'v'] }).unknownFields).toEqual([])
  })

  it('a name that only unreadable or empty data could hold is still reported when other data was read', () => {
    const r = compareMirror([{ id: 'a', v: 1 }, null], [{ id: 'a', v: 1 }], { fields: ['v', 'w'] })
    expect(r.unknownFields).toEqual(['w'])
  })

  it('nothing is reported when there are no readable records at all', () => {
    expect(compareMirror([], [], { allowEmpty: true, fields: ['v'], reviewedField: 'seen' }).unknownFields).toEqual([])
  })

  it('an ignored name that matches nothing is reported (PF-1; it was silent before 0.1.0)', () => {
    const r = compareMirror([{ id: 'a', v: 1 }], [{ id: 'a', v: 1 }], { ignoreFields: ['vv'] })
    expect(r.ok).toBe(false)
    expect(r.status).toBe('unknown')
    expect(r.unknownFields).toEqual(['vv'])
  })

  it('honest results carry an empty list', () => {
    expect(compareMirror([{ id: 'a', v: 1 }], [{ id: 'a', v: 1 }], { fields: ['v'] }).unknownFields).toEqual([])
  })
})

describe('auditReviewStamps: configured names that appear in no record are reported (PK-1)', () => {
  const rows = (reviewedOn: string): unknown[] => [{ id: 'a', source: 's', by: 'p', reviewedOn }]
  const base = { reviewedField: 'reviewedOn', sourceFields: ['source'] }
  it('a misspelled reviewedField', () => {
    const r = audit(rows('2026-01-01'), rows('2026-02-01'), { reviewedField: 'lastRevewed' })
    expect(r.unknownFields).toContain('lastRevewed')
    expect(r.ok).toBe(false)
  })
  it('a misspelled sourceFields entry, reviewerField, expiryField or valueFields entry', () => {
    expect(audit(rows('2026-01-01'), rows('2026-01-01'), { ...base, sourceFields: ['sorce'] }).unknownFields).toEqual(['sorce'])
    expect(audit(rows('2026-01-01'), rows('2026-01-01'), { ...base, reviewerField: 'bye' }).unknownFields).toEqual(['bye'])
    expect(audit(rows('2026-01-01'), rows('2026-01-01'), { ...base, expiryField: 'expiers' }).unknownFields).toEqual(['expiers'])
    expect(audit(rows('2026-01-01'), rows('2026-01-01'), { ...base, valueFields: ['vals'] }).unknownFields).toEqual(['vals'])
  })
  it('a typo makes the result unknown, never ok', () => {
    const r = audit(rows('2026-01-01'), rows('2026-01-01'), { ...base, sourceFields: ['sorce'] })
    expect(r.status).toBe('unknown')
    expect(r.ok).toBe(false)
  })
  it('correct names, and an empty sourceFields, report nothing', () => {
    expect(audit(rows('2026-01-01'), rows('2026-01-01'), { ...base, reviewerField: 'by' }).unknownFields).toEqual([])
    expect(audit(rows('2026-01-01'), rows('2026-01-01'), { reviewedField: 'reviewedOn', sourceFields: [] }).unknownFields).toEqual([])
  })
})

describe('auditReviewStamps: non-date expiry values and missing stamps are unknown with a reason, and summarized (PK-3)', () => {
  const before = [{ id: 'a', d: '2026-01-01', eol: false }, { id: 'b', d: '2026-01-01', eol: '2027-01-01' }, { id: 'c', eol: true }, { id: 'd' }]
  const r = audit(before, before, { reviewedField: 'd', sourceFields: [], expiryField: 'eol' })

  it('a boolean expiry is not-a-string, per record', () => {
    expect(r.unknown.filter((u) => u.field === 'eol').map((u) => [u.id, u.reason, u.value])).toEqual([['a', 'not-a-string', false], ['c', 'not-a-string', true]])
  })
  it('a record with no stamp is missing', () => {
    expect(r.unknown.filter((u) => u.field === 'd').map((u) => [u.id, u.reason])).toEqual([['c', 'missing'], ['d', 'missing']])
  })
  it('the result carries a summary with counts per field and reason', () => {
    expect(r.unknownSummary).toEqual([
      { field: 'eol', reason: 'not-a-string', count: 2 },
      { field: 'd', reason: 'missing', count: 2 },
    ])
    expect(r.status).toBe('unknown')
  })
  it('a clean run has an empty summary', () => {
    expect(audit([{ id: 'a', d: '2026-01-01' }], [{ id: 'a', d: '2026-01-01' }], { reviewedField: 'd', sourceFields: [] }).unknownSummary).toEqual([])
  })
})

describe('auditReviewStamps: a bulk bump says up front how many records carried changes (PK-4)', () => {
  const make = (changed: number, total: number): StampAuditArgs => {
    const before = Array.from({ length: total }, (_, i) => ({ id: `r${i}`, v: 1, source: 's', d: '2026-01-01' }))
    const after = before.map((r, i) => ({ ...r, v: i < changed ? 2 : 1, d: '2026-10-10' }))
    return [before, after]
  }
  type StampAuditArgs = [unknown[], unknown[]]
  const o = { reviewedField: 'd', sourceFields: ['source'] }

  it('every record changed: still flagged, and the counts lead the entry', () => {
    const [b, a] = make(12, 12)
    const r = audit(b, a, o)
    expect(r.status).toBe('flagged')
    expect(r.stampOnly).toEqual([])
    expect(r.bulkBump).toHaveLength(1)
    expect(r.bulkBump[0]).toMatchObject({ count: 12, withEvidence: 12, withoutEvidence: 0 })
    expect(Object.keys(r.bulkBump[0] as object).slice(0, 4)).toEqual(['summary', 'count', 'withEvidence', 'withoutEvidence'])
    expect(r.bulkBump[0]?.summary).toBe('12 records moved to 2026-10-10; 12 of 12 also changed a value, source or reviewer')
  })
  it('none changed', () => {
    const [b, a] = make(0, 11)
    const r = audit(b, a, o)
    expect(r.bulkBump[0]).toMatchObject({ count: 11, withEvidence: 0, withoutEvidence: 11 })
    expect(r.bulkBump[0]?.summary).toBe('11 records moved to 2026-10-10; 0 of 11 also changed a value, source or reviewer')
    expect(r.stampOnly).toHaveLength(11)
  })
  it('some changed', () => {
    const [b, a] = make(4, 12)
    expect(audit(b, a, o).bulkBump[0]).toMatchObject({ count: 12, withEvidence: 4, withoutEvidence: 8 })
  })
})

describe('the file-level review date recipe (PK-2)', () => {
  const standard = { reviewed: '2026-06-08', programs: [{ id: 'chase-ur', baselineCpp: 1.25 }, { id: 'amex-mr', baselineCpp: 1.2 }] }
  const extension = { reviewed: '2026-06-08', programs: [{ id: 'chase-ur', baselineCpp: 1.0 }, { id: 'amex-mr', baselineCpp: 1.2 }] }
  const stamped = (file: { reviewed: string; programs: object[] }): object[] => file.programs.map((p) => ({ ...p, reviewed: file.reviewed }))

  it('copying the file date onto each record turns on stampHidesDrift', () => {
    const r = compareMirror(stamped(standard), stamped(extension), { reviewedField: 'reviewed' })
    expect(r.stampHidesDrift).toEqual([{ id: 'chase-ur', reviewedValue: '2026-06-08', fields: ['baselineCpp'] }])
    expect(r.unknownFields).toEqual([])
  })
  it('without the recipe the field is reported as unknown instead of silently doing nothing', () => {
    const r = compareMirror(standard.programs, extension.programs, { reviewedField: 'reviewed' })
    expect(r.unknownFields).toEqual(['reviewed'])
    expect(r.stampHidesDrift).toEqual([])
  })
  it('passing the whole files is a bad record each, not a comparison', () => {
    const r = compareMirror(standard, extension, { allowEmpty: true })
    expect(r.ok).toBe(false)
    expect(r.invalid.length).toBeGreaterThan(0)
  })
})

describe('README gate for evidenced bulk bumps waives only the bulk bump', () => {
  // Same expression as the README's acceptEvidencedBulk recipe.
  const acceptEvidencedBulk = (a: ReturnType<typeof audit>) =>
    a.ok ||
    (a.bulkBump.every((b) => b.withoutEvidence === 0) &&
      a.stampOnly.length === 0 && a.future.length === 0 && a.backward.length === 0 &&
      a.extendedDeadlines.length === 0 && a.unknown.length === 0 && a.unknownFields.length === 0 &&
      a.duplicateKeys.length === 0 && a.suspectKeys.length === 0 && a.invalid.length === 0)
  const before = Array.from({ length: 11 }, (_, i) => rec(`r${i}`))
  const evidenced = before.map((r, i) => ({ ...r, value: 100 + i, reviewedOn: '2026-10-10' }))

  it('accepts an evidenced bulk bump on its own', () => {
    expect(acceptEvidencedBulk(audit(before, evidenced))).toBe(true)
  })
  it('still fails when a record also lost its stamp', () => {
    const after = evidenced.map((r, i) => (i === 0 ? { id: r.id, value: r.value, source: r.source } : r))
    expect(acceptEvidencedBulk(audit(before, after))).toBe(false)
  })
  it('still fails when a stamp is in the future', () => {
    const after = [...evidenced, rec('new', { reviewedOn: '2026-12-31' })]
    expect(acceptEvidencedBulk(audit([...before, rec('new')], after, { now: new Date('2026-10-10T12:00:00Z') }))).toBe(false)
  })
  it('still fails when a record is invalid', () => {
    const after = [...evidenced, { id: 'bad', value: 1, source: 'https://example.test/a', reviewedOn: 7 }]
    expect(acceptEvidencedBulk(audit([...before, rec('bad')], after))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Release 0.1.0 must fixes. Each row names its round 1 finding.
// ---------------------------------------------------------------------------

describe('PF-6 / PK4-1: numberTolerance treats a decimal difference at the tolerance as equal', () => {
  const eq = (a: number, b: number, tol: number) =>
    compareMirror([{ id: 'x', v: a }], [{ id: 'x', v: b }], { numberTolerance: tol }).ok

  it('PF-6: the README example 1.25 vs 1.15 at 0.1 is equal', () => {
    expect(eq(1.25, 1.15, 0.1)).toBe(true)
  })
  it('PF-6: 1.2 vs 1.3 at 0.1 is equal', () => {
    expect(eq(1.2, 1.3, 0.1)).toBe(true)
  })
  it('PF-6: 0.03 vs 0.04 at 0.01 is equal', () => {
    expect(eq(0.03, 0.04, 0.01)).toBe(true)
  })
  it('PF-6: 1.25 vs 1.1499999 at 0.1 is flagged', () => {
    expect(eq(1.25, 1.1499999, 0.1)).toBe(false)
  })
  it('PF-6: a difference just over the tolerance is flagged', () => {
    expect(eq(1.25, 1.14, 0.1)).toBe(false)
    expect(eq(0.03, 0.0401, 0.01)).toBe(false)
    expect(eq(1, 1 + 1e-9, 1e-10)).toBe(false)
  })
  it('PF-6: a zero tolerance stays exact', () => {
    expect(eq(0.1 + 0.2, 0.3, 0)).toBe(false)
    expect(eq(1.25, 1.25, 0)).toBe(true)
  })

  // Decimal oracle: the decision is made on integers (hundredths, tenths,
  // thousandths), so it is exact. The kit must agree with it on both sides
  // of the boundary, for positive and negative values, at several scales.
  const scales: Array<[string, number, number]> = [
    ['cents', 100, 0],
    ['tenths', 10, 0],
    ['thousandths', 1000, 0],
    ['cents near a million', 100, 1_000_000],
    ['cents below zero', 100, -2000],
  ]
  it.each(scales)('PF-6: no false fail and no false pass in %s', (_name, per, offset) => {
    let falseFail = 0
    let falsePass = 0
    let total = 0
    for (const tolInt of [1, 2, 5, 10, 25]) {
      const tol = tolInt / per
      for (let k = 0; k <= 400; k += 1) {
        const aInt = offset * per + k
        for (const delta of [tolInt, tolInt + 1, tolInt - 1, -tolInt, -(tolInt + 1)]) {
          const bInt = aInt + delta
          const truth = Math.abs(delta) <= tolInt
          const got = eq(aInt / per, bInt / per, tol)
          total += 1
          if (truth && !got) falseFail += 1
          if (!truth && got) falsePass += 1
        }
      }
    }
    expect(total).toBeGreaterThan(9000)
    expect({ falseFail, falsePass }).toEqual({ falseFail: 0, falsePass: 0 })
  })

  it('PF-6: infinities and NaN keep their rules under a tolerance', () => {
    expect(eq(Infinity, 1e308, 1e308)).toBe(false)
    expect(eq(Infinity, Infinity, 0.1)).toBe(true)
    expect(eq(NaN, NaN, 0.1)).toBe(true)
    expect(eq(NaN, 1, 0.1)).toBe(false)
  })
  it('PF-6: nested numbers and arrays use the same rule', () => {
    const r = compareMirror([{ id: 'x', v: { p: [1.25] } }], [{ id: 'x', v: { p: [1.15] } }], { numberTolerance: 0.1 })
    expect(r.ok).toBe(true)
  })
})

describe('hostile-F6 / DR-3: a registry cannot silently drop what it was given', () => {
  const entry = (extra: Record<string, unknown>) => [{ id: 'x', value: 1.25, ...extra }]
  it('F6: an entry with form instead of forms throws bad-registry naming form', () => {
    expect(() => findHandTypedConstants('cost 1,25 EUR', entry({ form: ['1,25'] }) as never)).toThrowError(
      expect.objectContaining({ name: 'ParityError', code: 'bad-registry', message: expect.stringContaining('"form"') as string }) as Error,
    )
  })
  it.each([['note'], ['valeu'], ['Forms'], ['values'], ['meta']])('F6: an unknown entry key %s throws bad-registry', (name) => {
    expect(() => findHandTypedConstants('1.25', entry({ [name]: 'x' }) as never)).toThrowError(
      expect.objectContaining({ code: 'bad-registry', message: expect.stringContaining(`"${name}"`) as string }) as Error,
    )
  })
  it('F6: a misspelled value key is refused', () => {
    expect(() => findHandTypedConstants('1.25', [{ id: 'x', valeu: 1.25 }] as never)).toThrowError(
      expect.objectContaining({ code: 'bad-registry' }) as Error,
    )
  })
  it('F6: a non-enumerable extra key is not read, an enumerable undefined one still counts as present', () => {
    const hidden = { id: 'x', value: 1.25 }
    Object.defineProperty(hidden, 'note', { value: 'x', enumerable: false })
    expect(findHandTypedConstants('1.25', [hidden])).toHaveLength(1)
    expect(() => findHandTypedConstants('1.25', entry({ note: undefined }) as never)).toThrowError(
      expect.objectContaining({ code: 'bad-registry' }) as Error,
    )
  })
  it('F6: a symbol key is not a typo and is ignored', () => {
    expect(findHandTypedConstants('1.25', [{ id: 'x', value: 1.25, [Symbol('s')]: 1 }])).toHaveLength(1)
  })
  it('DR-3: an empty registry throws bad-registry, so hits.length === 0 cannot pass on a registry that failed to load', () => {
    expect(() => findHandTypedConstants('1.25', [])).toThrowError(
      expect.objectContaining({ name: 'ParityError', code: 'bad-registry' }) as Error,
    )
  })
  it('DR-3: empty text with a real registry is still a legitimate empty result', () => {
    expect(findHandTypedConstants('', [{ id: 'x', value: 1.25 }])).toEqual([])
  })
  it('F6: id, value and forms are the whole entry shape and still work', () => {
    expect(findHandTypedConstants('cost 1,25 EUR', entry({ forms: ['1,25'] }) as never)).toHaveLength(1)
  })
})

describe('PF-4 / hostile-F1: an audit that compared nothing is unknown, never ok', () => {
  const stamped = (n: number, rename: (id: string) => string = (id) => id, date = '2026-01-01') =>
    Array.from({ length: n }, (_, i) => ({
      id: rename(`amex-${i}`),
      cpp: 1 + i / 100,
      source: `https://example.test/${i}`,
      lastReviewed: date,
    }))
  const opts = { reviewedField: 'lastReviewed', sourceFields: ['source'] }
  const bare = { reviewedField: 'lastReviewed', sourceFields: [] as string[] }

  it('PF-4: ids a and b renamed to a-v2 and b-v2 with stamps bumped', () => {
    const r = auditReviewStamps(
      [{ id: 'a', lastReviewed: '2026-01-01' }, { id: 'b', lastReviewed: '2026-01-01' }],
      [{ id: 'a-v2', lastReviewed: '2026-10-01' }, { id: 'b-v2', lastReviewed: '2026-10-01' }],
      bare,
    )
    expect(r.compared).toBe(0)
    expect(r.noOverlap).toBe(true)
    expect(r.status).toBe('unknown')
    expect(r.ok).toBe(false)
    expect(r.added).toEqual(['a-v2', 'b-v2'])
    expect(r.removed).toEqual(['a', 'b'])
  })

  const renames: Array<[string, (id: string) => string]> = [
    ['a NUL suffix', (id) => `${id}\u0000`],
    ['a tag character U+E0041 suffix', (id) => `${id}\u{E0041}`],
    ['a Greek alpha for a', (id) => id.replace('a', 'α')],
    ['a plain -v2 suffix', (id) => `${id}-v2`],
  ]
  it.each(renames)('hostile-F1: 25 records renamed with %s', (_name, rename) => {
    const r = auditReviewStamps(stamped(25), stamped(25, rename, '2026-10-10'), opts)
    expect(r.compared).toBe(0)
    expect(r.noOverlap).toBe(true)
    expect(r.status).toBe('unknown')
    expect(r.ok).toBe(false)
  })

  it('PF-4: 25 removed and 25 disjoint new ids is unknown', () => {
    const r = auditReviewStamps(stamped(25), stamped(25, (id) => `new-${id}`, '2026-10-10'), opts)
    expect(r.noOverlap).toBe(true)
    expect(r.status).toBe('unknown')
  })

  it('PF-4: the same ids with the same bump stay flagged (control)', () => {
    const r = auditReviewStamps(stamped(25), stamped(25, (id) => id, '2026-10-10'), opts)
    expect(r.noOverlap).toBe(false)
    expect(r.status).toBe('flagged')
    expect(r.stampOnly).toHaveLength(25)
    expect(r.bulkBump).toHaveLength(1)
  })

  it('PF-4: both snapshots empty with allowEmpty is still ok', () => {
    const r = auditReviewStamps([], [], { ...opts, allowEmpty: true })
    expect(r.noOverlap).toBe(false)
    expect(r.status).toBe('ok')
  })

  it('PF-4: an empty first snapshot with allowEmpty and new records is not a failed overlap', () => {
    const r = auditReviewStamps([], stamped(3, (id) => id, '2026-10-10'), { ...opts, allowEmpty: true })
    expect(r.noOverlap).toBe(false)
    expect(r.status).toBe('ok')
  })

  it('PF-4: one shared id is enough to have compared something', () => {
    const after = [...stamped(3, (id) => `x-${id}`, '2026-10-10'), ...stamped(1, (id) => id, '2026-01-01')]
    const r = auditReviewStamps(stamped(3), after, opts)
    expect(r.compared).toBe(1)
    expect(r.noOverlap).toBe(false)
  })

  it('PF-4: id-keyed objects with every key renamed are unknown too', () => {
    const r = auditReviewStamps({ a: { lastReviewed: '2026-01-01' } }, { 'a-v2': { lastReviewed: '2026-10-01' } }, bare)
    expect(r.noOverlap).toBe(true)
    expect(r.status).toBe('unknown')
  })

  it('PF-4: a bare 1 renamed to the string "1" is still never ok', () => {
    const r = auditReviewStamps([{ id: 1, lastReviewed: '2026-01-01' }], [{ id: '1', lastReviewed: '2026-10-01' }], bare)
    expect(r.ok).toBe(false)
    expect(r.noOverlap).toBe(true)
  })

  it('PF-4: the README gate recipe does not accept a set with nothing compared', () => {
    const accept = (a: ReturnType<typeof auditReviewStamps>) =>
      a.ok || (a.bulkBump.every((b) => b.withoutEvidence === 0) && !a.noOverlap &&
        a.stampOnly.length === 0 && a.future.length === 0 && a.backward.length === 0 &&
        a.extendedDeadlines.length === 0 && a.unknown.length === 0 && a.unknownFields.length === 0 &&
        a.duplicateKeys.length === 0 && a.suspectKeys.length === 0 && a.invalid.length === 0)
    expect(accept(auditReviewStamps(stamped(25), stamped(25, (id) => `${id}-v2`, '2026-10-10'), opts))).toBe(false)
  })
})

describe('PF-2 / hostile-F2: an empty effective field selection is refused', () => {
  const canon = [{ id: 'x', baselineCpp: 1.25 }]
  const mirror = [{ id: 'x', baselineCpp: 1.0 }]
  const badOptions: Array<[string, MirrorOptions]> = [
    ['fields: []', { fields: [] }],
    ['fields: [] with a review field', { fields: [], reviewedField: 'baselineCpp' }],
    ['every field also ignored', { fields: ['baselineCpp'], ignoreFields: ['baselineCpp'] }],
    ['two fields both ignored', { fields: ['a', 'b'], ignoreFields: ['b', 'a'] }],
  ]
  it.each(badOptions)('PF-2: %s throws bad-options', (_name, options) => {
    expect(() => compareMirror(canon, mirror, options)).toThrowError(
      expect.objectContaining({ name: 'ParityError', code: 'bad-options' }) as Error,
    )
  })

  it('PF-2: fields partly ignored still compares the rest', () => {
    const same = compareMirror([{ id: 'x', a: 1, b: 1 }], [{ id: 'x', a: 1, b: 2 }], { fields: ['a', 'b'], ignoreFields: ['b'] })
    expect(same.status).toBe('ok')
    const drift = compareMirror([{ id: 'x', a: 1, b: 1 }], [{ id: 'x', a: 2, b: 2 }], { fields: ['a', 'b'], ignoreFields: ['b'] })
    expect(drift.status).toBe('flagged')
  })

  it('PF-2: ignoreFields that remove every field of every record is unknown, not ok (hostile-F2 repro)', () => {
    const r = compareMirror(canon, mirror, { ignoreFields: ['baselineCpp'] })
    expect(r.ok).toBe(false)
    expect(r.status).toBe('unknown')
    expect(r.compared).toBe(1)
    expect(r.noFieldsCompared).toBe(true)
  })

  it('PF-2: ignoring every field of a two-field record is unknown', () => {
    const r = compareMirror(
      [{ id: 'x', baselineCpp: 1.25, lastReviewed: '2026-06-08' }],
      [{ id: 'x', baselineCpp: 1.0, lastReviewed: '2026-06-08' }],
      { ignoreFields: ['baselineCpp', 'lastReviewed'] },
    )
    expect(r.ok).toBe(false)
    expect(r.status).toBe('unknown')
    expect(r.noFieldsCompared).toBe(true)
  })

  it('PF-2: the hostile-F2 repro never returns ok:true under any of these configs', () => {
    const configs: MirrorOptions[] = [
      {}, { ignoreFields: ['baselineCpp'] }, { fields: ['baselineCpp'] }, { fields: ['nope'] },
      { numberTolerance: 0.1 }, { numberTolerance: 0.01 },
    ]
    for (const options of configs) {
      const r = compareMirror(canon, mirror, options)
      expect(r.ok, JSON.stringify(options)).toBe(false)
    }
  })

  it('PF-2: records that carry only an id are an honest presence check and stay ok', () => {
    const r = compareMirror([{ id: 'a' }, { id: 'b' }], [{ id: 'a' }, { id: 'b' }])
    expect(r.status).toBe('ok')
    expect(r.noFieldsCompared).toBe(false)
  })

  it('PF-2: ignoring one field while another is compared is not the empty case', () => {
    const r = compareMirror([{ id: 'x', a: 1, note: 'x' }], [{ id: 'x', a: 1, note: 'y' }], { ignoreFields: ['note'] })
    expect(r.status).toBe('ok')
    expect(r.noFieldsCompared).toBe(false)
  })
})

describe('PF-1: ignoreFields names are checked', () => {
  const before = [{ id: 'a', lastReviewed: '2026-01-01', price: 5, source: 'u', updatedAt: '2026-01-01T00:00:00Z' }]
  const after = [{ id: 'a', lastReviewed: '2026-06-01', price: 5, source: 'u', updatedAt: '2026-06-01T00:00:00Z' }]
  const run = (ignoreFields: string[], extra: Partial<StampOptions> = {}) =>
    auditReviewStamps(before, after, { reviewedField: 'lastReviewed', sourceFields: ['source'], ignoreFields, ...extra })

  it('PF-1: ignoreFields [updatedAt] flags the stamp-only bump', () => {
    const r = run(['updatedAt'])
    expect(r.status).toBe('flagged')
    expect(r.stampOnly).toHaveLength(1)
    expect(r.unknownFields).toEqual([])
  })

  it.each([['updatedat'], ['updated_at'], ['UpdatedAt']])('PF-1: the typo %s is unknown, never ok', (typo) => {
    const r = run([typo])
    expect(r.ok).toBe(false)
    expect(r.status).toBe('unknown')
    expect(r.unknownFields).toEqual([typo])
  })

  it('PF-1: a typo among valid names is still reported', () => {
    const r = run(['updatedAt', 'nope'])
    expect(r.unknownFields).toEqual(['nope'])
    expect(r.stampOnly).toHaveLength(1)
  })

  it('PF-1: under valueFields a typo in ignoreFields is reported, a real name outside valueFields is not', () => {
    expect(run(['updatedat'], { valueFields: ['price', 'updatedAt'] }).unknownFields).toEqual(['updatedat'])
    const real = run(['updatedAt'], { valueFields: ['price'] })
    expect(real.unknownFields).toEqual([])
    expect(real.stampOnly).toHaveLength(1)
  })

  it('PF-1: compareMirror also reports an ignoreFields name that matches no field', () => {
    const r = compareMirror([{ id: 'a', v: 1 }], [{ id: 'a', v: 1 }], { ignoreFields: ['note'] })
    expect(r.unknownFields).toEqual(['note'])
    expect(r.status).toBe('unknown')
    expect(r.ok).toBe(false)
  })

  it('PF-1: compareMirror does not report an ignoreFields name that one record has', () => {
    const r = compareMirror(
      [{ id: 'a', v: 1, note: 'x' }, { id: 'b', v: 1 }],
      [{ id: 'a', v: 1 }, { id: 'b', v: 1 }],
      { ignoreFields: ['note'] },
    )
    expect(r.unknownFields).toEqual([])
    expect(r.status).toBe('ok')
  })

  it('PF-1: compareMirror reports an ignoreFields typo even when fields restricts the read', () => {
    const r = compareMirror([{ id: 'a', v: 1 }], [{ id: 'a', v: 1 }], { fields: ['v'], ignoreFields: ['nope'] })
    expect(r.unknownFields).toEqual(['nope'])
  })
})

describe('C3 / hostile-F11: an unreadable record id never produces a missing or extra claim', () => {
  const unreadable = (): Record<string, unknown> => ({
    get id(): string {
      throw new Error('boom')
    },
    v: 1,
  })

  it('C3: an unreadable mirror id leaves the canonical record unknown, not missing', () => {
    const r = compareMirror([{ id: 'a', v: 1 }], [unreadable()])
    expect(r.missing).toEqual([])
    expect(r.extra).toEqual([])
    expect(r.status).toBe('unknown')
    expect(r.ok).toBe(false)
    expect(r.invalid.map((i) => i.reason)).toEqual(['unreadable'])
  })

  it('C3: an unreadable canonical id leaves the mirror record unknown, not extra (hostile-F11 repro)', () => {
    const r = compareMirror([unreadable()], [{ id: 'a', v: 1 }])
    expect(r.extra).toEqual([])
    expect(r.missing).toEqual([])
    expect(r.status).toBe('unknown')
    expect(r.invalid.map((i) => i.reason)).toEqual(['unreadable'])
  })

  it('C3: a Proxy whose descriptor trap throws on the key behaves the same', () => {
    const hostile = new Proxy({ id: 'a', v: 1 }, {
      getOwnPropertyDescriptor(target, name) {
        if (name === 'id') throw new Error('trap')
        return Reflect.getOwnPropertyDescriptor(target, name)
      },
    })
    const r = compareMirror([hostile], [{ id: 'a', v: 1 }])
    expect(r.extra).toEqual([])
    expect(r.status).toBe('unknown')
  })

  it('C3: an unreadable array slot on the mirror leaves the canonical record unknown', () => {
    const mirror: unknown[] = [{ id: 'b', v: 1 }]
    Object.defineProperty(mirror, 1, { get() { throw new Error('slot') }, enumerable: true })
    const r = compareMirror([{ id: 'a', v: 1 }, { id: 'b', v: 1 }], mirror)
    expect(r.missing).toEqual([])
    expect(r.status).toBe('unknown')
  })

  it('C3: a real missing record stays flagged beside an unreadable canonical record', () => {
    const r = compareMirror([unreadable(), { id: 'c', v: 1 }], [{ id: 'a', v: 1 }])
    expect(r.missing).toEqual(['c'])
    expect(r.extra).toEqual([])
    expect(r.status).toBe('flagged')
  })

  it('C3: more ids missing than there are unreadable records is still evidence, so it stays flagged', () => {
    const r = compareMirror([{ id: 'a', v: 1 }, { id: 'b', v: 1 }], [unreadable()])
    expect(r.missing).toEqual(['a', 'b'])
    expect(r.status).toBe('flagged')
  })

  it('C3: an unreadable canonical record can explain the one extra mirror id, and real drift is still flagged', () => {
    const r = compareMirror([{ id: 'a', v: 1 }, unreadable()], [{ id: 'a', v: 2 }, { id: 'zz', v: 1 }])
    expect(r.extra).toEqual([])
    expect(r.changed).toHaveLength(1)
    expect(r.status).toBe('flagged')
  })

  it('C3: a record with an id that is simply absent is still an extra record', () => {
    const r = compareMirror([{ id: 'a', v: 1 }], [{ id: 'a', v: 1 }, { id: 'zz', v: 1 }])
    expect(r.extra).toEqual(['zz'])
    expect(r.status).toBe('flagged')
  })
})

describe('PF-3 / DR-2: reviewedField is always compared, even when fields is set', () => {
  const canon = [{ id: 'x', v: 1, note: 'a', lastReviewed: '2026-06-08' }]

  it('PF-3: a differing review value is flagged and appears in changed when fields is set', () => {
    const mirror = [{ id: 'x', v: 1, note: 'b', lastReviewed: '2024-01-01' }]
    const r = compareMirror(canon, mirror, { fields: ['v'], reviewedField: 'lastReviewed' })
    expect(r.status).toBe('flagged')
    expect(r.changed).toEqual([
      { id: 'x', field: 'lastReviewed', change: 'different', canonical: '2026-06-08', mirror: '2024-01-01' },
    ])
    expect(r.stampHidesDrift).toEqual([])
  })

  it('PF-3: an unselected field other than the review field may still differ', () => {
    const mirror = [{ id: 'x', v: 1, note: 'b', lastReviewed: '2026-06-08' }]
    const r = compareMirror(canon, mirror, { fields: ['v'], reviewedField: 'lastReviewed' })
    expect(r.status).toBe('ok')
  })

  it('PF-3: stampHidesDrift still works when fields is set and the review dates agree', () => {
    const mirror = [{ id: 'x', v: 2, note: 'a', lastReviewed: '2026-06-08' }]
    const r = compareMirror(canon, mirror, { fields: ['v'], reviewedField: 'lastReviewed' })
    expect(r.stampHidesDrift).toEqual([{ id: 'x', reviewedValue: '2026-06-08', fields: ['v'] }])
  })

  it('PF-3: ignoreFields still removes the review field from the comparison', () => {
    const mirror = [{ id: 'x', v: 1, note: 'a', lastReviewed: '2024-01-01' }]
    const r = compareMirror(canon, mirror, { fields: ['v'], reviewedField: 'lastReviewed', ignoreFields: ['lastReviewed'] })
    expect(r.changed).toEqual([])
  })

  it('PF-3: without fields the review field was already compared (control)', () => {
    const mirror = [{ id: 'x', v: 1, note: 'a', lastReviewed: '2024-01-01' }]
    const r = compareMirror(canon, mirror, { reviewedField: 'lastReviewed' })
    expect(r.changed).toHaveLength(1)
  })
})

describe('PK4-4 / PF-7 / hostile-F7 / PF-9: the constant scanner reads ranges, numeric separators and unspaced scripts', () => {
  const found = (value: number | string, text: string, forms?: string[]): string[] =>
    findHandTypedConstants(text, [{ id: 'c', value, ...(forms === undefined ? {} : { forms }) }]).map((h) => h.text)

  describe('PK4-4: ".." ranges', () => {
    it.each([
      [100, '{1..100}'],
      [1, '{1..100}'],
      [5, 'range 1..5'],
      [1, 'range 1..5'],
      [2025, '2020..2025'],
      [2020, '2020..2025'],
      [3, 'wait...3'],
      [2, '1.0..2.0'],
    ] as Array<[number, string]>)('%s is found in %j', (value, text) => {
      expect(found(value, text)).toHaveLength(1)
    })

    it.each([
      [0.5, 'range 1..5'],
      [0.5, 'wait...5'],
      [0.2025, '2020..2025'],
      [0.5, 'x.5'],
    ] as Array<[number, string]>)('%s is NOT found in %j', (value, text) => {
      expect(found(value, text)).toEqual([])
    })

    it('a leading-dot number after a space or bracket is still 0.5', () => {
      expect(found(0.5, 'rate .5 here')).toEqual(['.5'])
      expect(found(0.5, '(.5)')).toEqual(['.5'])
    })

    it('the hit for the number after the dots reports the right offset', () => {
      const [hit] = findHandTypedConstants('range 1..5', [{ id: 'c', value: 5 }])
      expect(hit).toMatchObject({ text: '5', index: 9, column: 10 })
    })

    it('a literal form that starts with a digit is found after dots too', () => {
      expect(found('5 pts', 'range 1..5 pts')).toEqual(['5 pts'])
    })
  })

  describe('PF-7: numeric separators', () => {
    it.each([
      [1000000, 'const MAX = 1_000_000;'],
      [86400000, 'ms = 86_400_000'],
      [1250, '1_250'],
      [1250, 'x = 1_250 + 2'],
      [1000.5, 'v = 1_000.5'],
      [1000000, '1000000'],
      [1000000, '1,000,000'],
    ] as Array<[number, string]>)('%s is found in %j', (value, text) => {
      expect(found(value, text)).toHaveLength(1)
    })

    it.each([
      [1, '1_250'],
      [250, '1_250'],
      [1, 'const MAX = 1_000_000;'],
      [1250, 'x_1_250'],
      [1250, 'a1_250'],
      [1250, '1_250_x'],
      [1250, '1_2500'],
      [12, '1_2'],
      [1250, '1,250_000'],
      [1250000, '1,250_000'],
    ] as Array<[number, string]>)('%s is NOT found in %j', (value, text) => {
      expect(found(value, text)).toEqual([])
    })

    it('an underscore group needs exactly three digits, like a comma group', () => {
      expect(found(100000, '1_00_000')).toEqual([])
      expect(found(1, '1_00_000')).toEqual([])
    })
  })

  describe('hostile-F7 / PF-9: numbers next to unspaced scripts', () => {
    it.each([
      ['每点价值1.25美分', 'Han'],
      ['還元率1.25倍', 'Han'],
      ['ポイントあたり1.25円', 'Katakana and Hiragana'],
      ['값은1.25입니다', 'Hangul'],
      ['อัตรา1.25', 'Thai'],
      ['ພາບ1.25', 'Lao'],
      ['អត្រា1.25', 'Khmer'],
      ['နှုန်း1.25', 'Myanmar'],
      ['カー1.25', 'the Katakana prolonged sound mark'],
    ])('1.25 is found in %s (%s)', (text) => {
      expect(found(1.25, text)).toEqual(['1.25'])
    })

    it.each([
      ['abc1.25'],
      ['v1.25'],
      ['x_1.25'],
      ['القيمة1.25'],
      ['значение1.25'],
      ['αβγ1.25'],
      ['价值abc1.25'],
      ['๑1.25'],
      ['１1.25'],
    ])('1.25 is still skipped in %s', (text) => {
      expect(found(1.25, text)).toEqual([])
    })

    it('a non-ASCII digit of an unspaced script still glues', () => {
      expect(found(1.25, 'อัตรา๑1.25')).toEqual([])
    })

    it('a literal form made of unspaced script is found inside running text', () => {
      expect(found('价值', '每点价值1.25美分')).toEqual(['价值'])
      expect(found('美分', '每点价值1.25美分')).toEqual(['美分'])
    })

    it('a Latin literal form still must not touch a Latin letter', () => {
      expect(found('pts', 'points')).toEqual([])
      expect(found('pts', 'x pts')).toEqual(['pts'])
    })

    it('a Latin form next to unspaced script is found', () => {
      expect(found('USD', '价格USD')).toEqual(['USD'])
    })

    it('a hyphen after a Han character reads like a hyphen after a Latin letter (x-1.25 is 1.25)', () => {
      expect(found(1.25, '价值-1.25')).toEqual(['1.25'])
      expect(found(1.25, 'x-1.25')).toEqual(['1.25'])
      expect(found(1.25, '价值 -1.25')).toEqual([])
    })
  })

  describe('PF-9: underscore-wrapped numbers are documented, not read', () => {
    it('a number wrapped in underscores is part of an identifier, so only a literal form finds it', () => {
      expect(found(1.25, '_1.25_')).toEqual([])
      expect(found(1.25, 'the _1.25_ rate', ['_1.25_'])).toEqual(['_1.25_'])
    })
  })
})

describe('hostile-F4: detail text for oversized object keys is bounded', () => {
  const big = 'x'.repeat(5 * 1024 * 1024)

  it('F4: a 5 MB id shared across 40 records keeps every detail short and the total small', () => {
    const dataset: Record<string, unknown> = {}
    for (let i = 0; i < 40; i += 1) dataset[`r${i}`] = { id: big, v: 1 }
    const r = compareMirror(dataset, {})
    expect(r.invalid.length).toBeGreaterThanOrEqual(40)
    const details = r.invalid.map((entry) => entry.detail ?? '')
    expect(Math.max(...details.map((d) => d.length))).toBeLessThanOrEqual(256)
    expect(details.reduce((sum, d) => sum + d.length, 0)).toBeLessThan(20_000)
    expect(r.invalid.filter((entry) => entry.reason === 'key-mismatch')).toHaveLength(40)
    expect(r.ok).toBe(false)
  })

  it('F4: the detail still says which record and which field disagree', () => {
    const r = compareMirror({ a: { id: 'b', v: 1 } }, {})
    const mismatch = r.invalid.find((entry) => entry.reason === 'key-mismatch')
    expect(mismatch?.detail).toContain('"a"')
    expect(mismatch?.detail).toContain('id')
    expect(mismatch?.detail).toContain('"b"')
  })

  it('F4: a long property name and a long key option are clipped too', () => {
    const name = 'n'.repeat(4000)
    const r = compareMirror({ [name]: { id: 'other', v: 1 } }, {})
    const detail = r.invalid.find((entry) => entry.reason === 'key-mismatch')?.detail ?? ''
    expect(detail.length).toBeLessThanOrEqual(256)
    const longKey = 'k'.repeat(5000)
    const noKey = compareMirror([{ v: 1 }], [], { key: longKey })
    expect((noKey.invalid.find((entry) => entry.reason === 'missing-key')?.detail ?? '').length).toBeLessThanOrEqual(256)
  })

  it('F4: a key of a different type is still named by type', () => {
    const r = compareMirror({ a: { id: { nested: true }, v: 1 } }, {})
    expect(r.invalid.find((entry) => entry.reason === 'key-mismatch')?.detail).toContain('object')
  })
})

describe('documentation batch: pinned behaviors the README now states', () => {
  it('hostile-F5: an object-keyed record with an unrelated id field is key-mismatch, and the detail names the key option', () => {
    const copy = () => ({ 'chase-ur': { id: 17, cpp: 1.25 }, 'amex-mr': { id: 18, cpp: 1.2 } })
    const r = compareMirror(copy(), copy())
    expect(r.ok).toBe(false)
    expect(r.compared).toBe(0)
    expect(r.invalid.every((entry) => entry.reason === 'key-mismatch')).toBe(true)
    expect(r.invalid[0]?.detail).toContain('key option')
  })

  it('hostile-F5: naming a field the records do not have turns the check off, and id is compared like any field', () => {
    const copy = () => ({ 'chase-ur': { id: 17, cpp: 1.25 }, 'amex-mr': { id: 18, cpp: 1.2 } })
    const ok = compareMirror(copy(), copy(), { key: 'recordKey' })
    expect(ok.status).toBe('ok')
    expect(ok.compared).toBe(2)
    const drifted = compareMirror(copy(), { ...copy(), 'amex-mr': { id: 19, cpp: 1.2 } }, { key: 'recordKey' })
    expect(drifted.changed).toEqual([{ id: 'amex-mr', field: 'id', change: 'different', canonical: 18, mirror: 19 }])
  })

  it('PK4-2: identical case-sensitive keys are unknown by default and ok with foldCase: false', () => {
    const entities = [{ id: '&AElig;', cp: 198 }, { id: '&aelig;', cp: 230 }]
    const copy = entities.map((e) => ({ ...e }))
    const folded = compareMirror(entities, copy)
    expect(folded.status).toBe('unknown')
    expect(folded.suspectKeys).toHaveLength(1)
    expect(compareMirror(entities, copy, { foldCase: false }).status).toBe('ok')
  })

  it('PK4-2: foldCase: false still reports a renamed key as missing plus extra', () => {
    const r = compareMirror([{ id: 'ABC', v: 1 }], [{ id: 'abc', v: 1 }], { foldCase: false })
    expect(r.missing).toEqual(['ABC'])
    expect(r.extra).toEqual(['abc'])
    expect(r.ok).toBe(false)
  })

  it('DR-4: a mirror that lacks a record is flagged, and filtering the canonical set to the shipped ids clears it', () => {
    const canonical = [{ id: 1 }, { id: 2 }, { id: 3 }]
    expect(compareMirror(canonical, [{ id: 1 }, { id: 2 }]).missing).toEqual([3])
    expect(compareMirror(canonical.filter((r) => r.id !== 3), [{ id: 1 }, { id: 2 }]).status).toBe('ok')
  })

  it('C4: a literal form ignores sign, a numeric value does not', () => {
    expect(findHandTypedConstants('-1.25', [{ id: 'c', value: 1.25, forms: ['1.25'] }]).map((h) => h.kind)).toEqual(['form'])
    expect(findHandTypedConstants('-1.25', [{ id: 'c', value: 1.25 }])).toEqual([])
    expect(findHandTypedConstants('-1.25', [{ id: 'c', value: -1.25 }]).map((h) => h.text)).toEqual(['-1.25'])
  })

  it('PF-8: unspaced three-digit integers between commas are one number (documented limit); decimals are fine', () => {
    const find = (value: number, text: string) => findHandTypedConstants(text, [{ id: 'c', value }]).map((h) => h.text)
    expect(find(200, '[100,200,300]')).toEqual([])
    expect(find(100200300, '[100,200,300]')).toEqual(['100,200,300'])
    expect(find(300, 'ur,125,300,12')).toEqual([])
    expect(find(125300, 'ur,125,300,12')).toEqual(['125,300'])
    expect(find(2.5, '[1.5,2.5,3.5]')).toEqual(['2.5'])
    expect(find(200, '100, 200, 300')).toEqual(['200'])
    expect(find(2000, '[1000,2000,3000]')).toEqual(['2000'])
  })

  it('PK4-3: look-alike twins appear in suspectKeys and can be waived by the caller from the skeleton', () => {
    const twins = [{ id: 'Saving …', v: 1 }, { id: 'Saving …', v: 1 }]
    const r = compareMirror(twins, twins.map((t) => ({ ...t })))
    expect(r.suspectKeys.map((g) => g.skeleton)).toEqual(['saving ...'])
    expect(r.missing).toEqual([])
  })

  it('PK4-5: a placeholder-token comparison over shared, translated keys finds a dropped placeholder', () => {
    const tokens = (text: string) => (text.match(/\{[^}]*\}|<\/?\w+>/g) ?? []).sort().join(' ')
    const rows = (messages: Record<string, string>, keys: string[]) => keys.map((id) => ({ id, tokens: tokens(messages[id] ?? '') }))
    const en = { greeting: 'Hello {name}', draft: 'Draft', only: 'Only here' }
    const fr = { greeting: 'Bonjour', draft: '' }
    const shared = Object.keys(en).filter((key) => Object.hasOwn(fr, key) && (fr as Record<string, string>)[key] !== '')
    expect(shared).toEqual(['greeting'])
    const r = compareMirror(rows(en, shared), rows(fr, shared))
    expect(r.changed.map((c) => c.id)).toEqual(['greeting'])
  })
})

describe('C2: a selected hidden property does not bypass the built-in check', () => {
  const hiddenMap = (): object => {
    const m = Object.setPrototypeOf(new Map([['secret', 99]]), null) as object
    Object.defineProperty(m, 'v', { value: 1, enumerable: false })
    return m
  }

  it('C2: a null-prototype Map with a hidden v selected by fields is invalid, not a match', () => {
    const r = compareMirror({ a: hiddenMap() }, { a: { v: 1 } }, { fields: ['v'] })
    expect(r.ok).toBe(false)
    expect(r.status).not.toBe('ok')
    expect(r.invalid.map((i) => i.reason)).toEqual(['not-a-plain-object'])
  })

  it('C2: the same holds in an array dataset', () => {
    const m = hiddenMap()
    Object.defineProperty(m, 'id', { value: 'a', enumerable: false })
    const r = compareMirror([m], [{ id: 'a', v: 1 }], { fields: ['v'] })
    expect(r.ok).toBe(false)
    expect(r.invalid.map((i) => i.reason)).toEqual(['not-a-plain-object'])
  })

  it('C2: the Map without the hidden property was already rejected (control)', () => {
    const m = Object.setPrototypeOf(new Map(), null) as object
    expect(compareMirror({ a: m }, { a: { v: 1 } }, { fields: ['v'] }).invalid.map((i) => i.reason)).toEqual(['not-a-plain-object'])
  })

  it('C2: a plain object whose selected property is hidden is still read', () => {
    const hidden = {}
    Object.defineProperty(hidden, 'v', { value: 1, enumerable: false })
    expect(compareMirror({ a: hidden }, { a: { v: 1 } }, { fields: ['v'] }).status).toBe('ok')
    expect(compareMirror({ a: hidden }, { a: { v: 2 } }, { fields: ['v'] }).status).toBe('flagged')
  })

  it('C2: a record with an enumerable property that is not selected is plain data and costs no probe', () => {
    const record = { note: 'x' }
    Object.defineProperty(record, 'v', { value: 1, enumerable: false })
    expect(compareMirror({ a: record }, { a: { v: 1 } }, { fields: ['v'] }).status).toBe('ok')
  })
})

describe('C5: maxRecords counts only enumerable string-keyed records', () => {
  it('C5: non-enumerable and symbol-keyed properties of an id-keyed object are not records', () => {
    const data: Record<string | symbol, unknown> = { a: { v: 1 } }
    Object.defineProperty(data, 'metadata', { value: 'x' })
    data[Symbol('tag')] = 1
    const r = compareMirror(data, data, { limits: { maxRecords: 1 } })
    expect(r.status).toBe('ok')
    expect(r.compared).toBe(1)
  })

  it('C5: two enumerable records still exceed maxRecords 1', () => {
    expect(() => compareMirror({ a: { v: 1 }, b: { v: 1 } }, { a: { v: 1 } }, { limits: { maxRecords: 1 } })).toThrowError(
      expect.objectContaining({ code: 'too-large' }) as Error,
    )
  })
})

describe('hostile-F8: a polluted Object.prototype does not change what an accessor reads', () => {
  // Pollution is held only while the kit runs: Node's own lazy loaders and the
  // assertion library break under a polluted `value`, so nothing is asserted until it is removed.
  function withPollutedValue<T>(polluted: unknown, run: () => T): T {
    Object.defineProperty(Object.prototype, 'value', { value: polluted, configurable: true, writable: true, enumerable: false })
    let result: T | undefined
    let failure: unknown
    try {
      result = run()
    } catch (error) {
      failure = error
    } finally {
      delete (Object.prototype as { value?: unknown }).value
    }
    if (failure !== undefined) throw failure as Error
    return result as T
  }

  it('F8: Object.prototype.value cannot stand in for a getter result', () => {
    const run = () => compareMirror([{ id: 'a', get v() { return 1 } }], [{ id: 'a', get v() { return 2 } }])
    const clean = run()
    const polluted = withPollutedValue('POLLUTED', run)
    expect(clean.changed.map((c) => c.field)).toEqual(['v'])
    expect(polluted.status).toBe('flagged')
    expect(polluted.changed).toEqual([{ id: 'a', field: 'v', change: 'different', canonical: 1, mirror: 2 }])
  })

  it('F8: an option given as a getter is read from the getter', () => {
    const options = {} as { ignoreFields?: string[] }
    Object.defineProperty(options, 'ignoreFields', { get: () => ['v'], enumerable: true })
    const r = withPollutedValue('POLLUTED', () => compareMirror([{ id: 'a', v: 1 }], [{ id: 'a', v: 2 }], options))
    expect(r.noFieldsCompared).toBe(true)
  })

  it('F8: Object.prototype.value = undefined does not make an accessor constructor look like data', () => {
    let calls = 0
    const promise = Object.setPrototypeOf(Promise.resolve(1), null) as object
    Object.defineProperty(promise, 'constructor', { get: () => { calls += 1; return Promise }, enumerable: false })
    const r = withPollutedValue(undefined, () => compareMirror({ a: { p: promise } }, { a: { p: 1 } }))
    expect(calls).toBe(0)
    expect(r.invalid.map((i) => i.reason)).toEqual(['unsupported-value'])
  })
})

describe('hostile-F9 / DR-9: a limit message names the option that raises it', () => {
  it('F9: the node budget message names limits.maxNodes and its value', () => {
    let message = ''
    try {
      compareMirror([{ id: 'x', v: 1 }], [{ id: 'x', v: 1 }], { limits: { maxNodes: 1 } })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('limits.maxNodes')
    expect(message).toContain('(1)')
    expect(message).not.toContain('1000')
  })

  it('DR-9: the container cap message gives the real cap and says it is a fifth of maxNodes, at least 1000', () => {
    let message = ''
    const records = Array.from({ length: 400 }, (_, i) => ({ id: `r${i}`, v: [[[[[[i]]]]]] }))
    try {
      compareMirror(records, records, { limits: { maxNodes: 10_000 } })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('arrays and objects')
    expect(message).toContain('a fifth of limits.maxNodes')
    expect(message).toContain('limit of 2000 ')
  })

  it('F9: a few hundred thousand ordinary records fit the default budget, and the node budget is what ends a larger set', () => {
    const records = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i, a: 1, b: 2, c: 3 }))
    expect(compareMirror(records(5000), records(5000)).status).toBe('ok')
    expect(() => compareMirror(records(2000), records(2000), { limits: { maxNodes: 20_000 } })).toThrowError(
      expect.objectContaining({ code: 'too-large' }) as Error,
    )
  })
})

describe('C1: a getter-bearing object that appears twice in one record is read once per appearance (documented limit)', () => {
  it('C1: the shared getter runs once per appearance, so two fields can differ', () => {
    let reads = 0
    const shared = { get v() { reads += 1; return reads } }
    const r = compareMirror([{ id: 'a', x: shared, y: shared }], [{ id: 'a', x: { v: 1 }, y: { v: 1 } }], { fields: ['x', 'y'] })
    expect(reads).toBe(2)
    expect(r.ok).toBe(false)
  })

  it('C1: the same shared object under one field is read once per read', () => {
    let reads = 0
    const shared = { get v() { reads += 1; return 1 } }
    compareMirror([{ id: 'a', x: shared }], [{ id: 'a', x: { v: 1 } }])
    expect(reads).toBe(1)
  })
})

describe('hostile-F12: an option that cannot be read as written is refused, not skipped', () => {
  const hidden = (name: string, value: unknown): object => {
    const options = {}
    Object.defineProperty(options, name, { value, enumerable: false })
    return options
  }
  const canonical = [{ id: 'a', v: 1, w: 1 }]
  const mirror = [{ id: 'a', v: 1, w: 2 }]

  it('hostile-F12: a non-enumerable `fields` throws bad-options instead of selecting nothing', () => {
    expect(() => compareMirror(canonical, mirror, hidden('fields', ['v']) as MirrorOptions)).toThrowError(
      expect.objectContaining({ code: 'bad-options' }) as Error,
    )
  })

  it('hostile-F12: a non-enumerable `ignoreFields` or `numberTolerance` throws bad-options', () => {
    expect(() => compareMirror(canonical, mirror, hidden('ignoreFields', ['w']) as MirrorOptions)).toThrowError(
      expect.objectContaining({ code: 'bad-options' }) as Error,
    )
    expect(() => compareMirror(canonical, mirror, hidden('numberTolerance', 5) as MirrorOptions)).toThrowError(
      expect.objectContaining({ code: 'bad-options' }) as Error,
    )
  })

  it('hostile-F12: a symbol-keyed option throws bad-options and the message says so', () => {
    const options = { [Symbol('fields')]: ['v'] } as unknown as MirrorOptions
    expect(() => compareMirror(canonical, mirror, options)).toThrowError(
      expect.objectContaining({ code: 'bad-options', message: expect.stringContaining('symbol') as string }) as Error,
    )
  })

  it('hostile-F12: a non-enumerable audit option and a non-enumerable limit throw bad-options', () => {
    const before = [{ id: 'a', v: 1, lastReviewed: '2026-01-01' }]
    const after = [{ id: 'a', v: 1, lastReviewed: '2026-10-01' }]
    const stamp = { reviewedField: 'lastReviewed', sourceFields: [] as string[] }
    const withHiddenIgnore = Object.defineProperty({ ...stamp }, 'ignoreFields', { value: ['updatedAt'], enumerable: false })
    expect(() => auditReviewStamps(before, after, withHiddenIgnore as StampOptions)).toThrowError(
      expect.objectContaining({ code: 'bad-options' }) as Error,
    )
    expect(() => compareMirror(canonical, mirror, { limits: hidden('maxNodes', 1) })).toThrowError(
      expect.objectContaining({ code: 'bad-options' }) as Error,
    )
  })

  it('hostile-F12: ordinary options, an explicit undefined option and an empty options object still work', () => {
    expect(compareMirror(canonical, mirror, {}).status).toBe('flagged')
    expect(compareMirror(canonical, mirror, { fields: ['v'] }).status).toBe('ok')
    expect(compareMirror(canonical, mirror, { fields: undefined } as unknown as MirrorOptions).status).toBe('flagged')
    expect(compareMirror(canonical, mirror, Object.create(null) as MirrorOptions).status).toBe('flagged')
  })
})

describe('hostile-F12: more invisible characters in a key are look-alikes', () => {
  const invisible: Array<[string, string]> = [
    ['NUL', '\u0000'],
    ['bell', '\u0007'],
    ['DEL', '\u007f'],
    ['C1 control', '\u0090'],
    ['tag letter A (U+E0041)', '\u{E0041}'],
    ['tag cancel (U+E007F)', '\u{E007F}'],
    ['object replacement (U+FFFC)', '\uFFFC'],
    ['interlinear annotation anchor (U+FFF9)', '\uFFF9'],
    ['musical beam start (U+1D173)', '\u{1D173}'],
    ['musical end phrase (U+1D17A)', '\u{1D17A}'],
  ]

  for (const [name, ch] of invisible) {
    it(`hostile-F12: ${name} inside an id makes it a look-alike of the plain id, never a quiet rename`, () => {
      const r = compareMirror([{ id: 'prog-1', v: 1 }], [{ id: `prog${ch}-1`, v: 1 }])
      expect(r.suspectKeys).toHaveLength(1)
      expect(r.status).toBe('flagged')
      expect(r.missing).toEqual(['prog-1'])
      expect(r.extra).toEqual([`prog${ch}-1`])
    })

    it(`hostile-F12: ${name} added to every audited id is reported as look-alikes as well as no overlap`, () => {
      const before = [{ id: 'a', v: 1, lastReviewed: '2026-01-01' }, { id: 'b', v: 1, lastReviewed: '2026-01-01' }]
      const after = before.map((r) => ({ ...r, id: `${r.id}${ch}`, lastReviewed: '2026-10-01' }))
      const r = auditReviewStamps(before, after, { reviewedField: 'lastReviewed', sourceFields: [] })
      expect(r.ok).toBe(false)
      expect(r.status).toBe('unknown')
      expect(r.noOverlap).toBe(true)
      expect(r.suspectKeys).toHaveLength(2)
    })
  }

  it('hostile-F12: ordinary ids, spaces and punctuation are not look-alikes', () => {
    const r = compareMirror([{ id: 'a b', v: 1 }, { id: 'a-b', v: 1 }, { id: 'a_b', v: 1 }, { id: 'ab', v: 1 }], [{ id: 'a b', v: 1 }, { id: 'a-b', v: 1 }, { id: 'a_b', v: 1 }, { id: 'ab', v: 1 }])
    expect(r.suspectKeys).toEqual([])
    expect(r.status).toBe('ok')
  })
})

// ---------------------------------------------------------------------------
// Triage of the unverified P3 items: each behavior below is stated in the
// README, so each is pinned here. These rows pass on the current build; they
// exist so the README sentence cannot become false unnoticed.
// ---------------------------------------------------------------------------

describe('PF-10 / PK4-6: record order is not compared, and report order follows the input form', () => {
  it('PF-10: a mirror array in another order is ok, so a ranking has to live in a field', () => {
    const canonical = [{ id: 'a', rank: 1 }, { id: 'b', rank: 2 }, { id: 'c', rank: 3 }]
    expect(compareMirror(canonical, [...canonical].reverse()).status).toBe('ok')
    expect(compareMirror(canonical, [{ id: 'a', rank: 3 }, { id: 'b', rank: 2 }, { id: 'c', rank: 1 }]).changed.map((c) => c.field)).toEqual(['rank', 'rank'])
  })

  it('PK4-6: array input reports in input order, object input in sorted key order, with the same content', () => {
    const rows = (v: number): Array<{ id: string; v: number }> => [{ id: 'b', v }, { id: 'a', v }, { id: 'c', v }]
    const asObject = (v: number): Record<string, { v: number }> => ({ b: { v }, a: { v }, c: { v } })
    const fromArray = compareMirror(rows(1), rows(2))
    const fromObject = compareMirror(asObject(1), asObject(2))
    expect(fromArray.changed.map((c) => c.id)).toEqual(['b', 'a', 'c'])
    expect(fromObject.changed.map((c) => c.id)).toEqual(['a', 'b', 'c'])
    expect([...fromArray.changed].sort((x, y) => (x.id < y.id ? -1 : 1))).toEqual(fromObject.changed)
    expect(compareMirror([{ id: 'b' }, { id: 'a' }], [{ id: 'z' }]).missing).toEqual(['b', 'a'])
    expect(compareMirror({ b: {}, a: {} }, { z: {} }).missing).toEqual(['a', 'b'])
  })
})

describe('PF-11 / PF-14 / PF-15: number tolerance scope, Date against its ISO string, doubles', () => {
  it('PF-11: one absolute tolerance applies to every field, and one call per scale keeps a small rate strict', () => {
    const canonical = [{ id: 'x', cpp: 1.25, feeRate: 0.015 }]
    const mirror = [{ id: 'x', cpp: 1.251, feeRate: 0.02 }]
    expect(compareMirror(canonical, mirror, { numberTolerance: 0.01 }).status).toBe('ok')
    expect(compareMirror(canonical, mirror, { fields: ['cpp'], numberTolerance: 0.01 }).status).toBe('ok')
    expect(compareMirror(canonical, mirror, { fields: ['feeRate'], numberTolerance: 0.0001 }).status).toBe('flagged')
  })

  it('PF-14: a Date is different from its ISO string, and the report holds a Date next to a string', () => {
    const r = compareMirror([{ id: 'a', d: new Date('2026-06-08') }], [{ id: 'a', d: '2026-06-08T00:00:00.000Z' }])
    expect(r.status).toBe('flagged')
    const change = r.changed[0]
    expect(change?.canonical).toBeInstanceOf(Date)
    expect(typeof change?.mirror).toBe('string')
    expect(compareMirror([{ id: 'a', d: new Date('2026-06-08') }], [{ id: 'a', d: new Date('2026-06-08').toISOString() as unknown as Date }]).status).toBe('flagged')
  })

  it('PF-15: integers past 2^53 that parsed to one double compare equal, as strings they differ', () => {
    const parse = (text: string): unknown => JSON.parse(text) as unknown
    expect(compareMirror(parse('[{"id":"a","n":12345678901234567890}]'), parse('[{"id":"a","n":12345678901234567891}]')).status).toBe('ok')
    expect(compareMirror([{ id: 'a', n: '12345678901234567890' }], [{ id: 'a', n: '12345678901234567891' }]).status).toBe('flagged')
  })
})

describe('PF-12 / PF-13 / DR-11 / PF-15: review-stamp rules that read as surprises are pinned', () => {
  const opts = { reviewedField: 'lastReviewed', sourceFields: [] } satisfies StampOptions
  const one = (date: string): Array<{ id: string; v: number; lastReviewed: string }> => [{ id: 'a', v: 1, lastReviewed: date }]
  const many = (n: number, date: (i: number) => string, note = 'x'): Array<{ id: string; note: string; lastReviewed: string }> =>
    Array.from({ length: n }, (_, i) => ({ id: `p${i}`, note, lastReviewed: date(i) }))

  it('PF-12: a same-day format rewrite is a move of the instant: later is stampOnly, earlier is backward', () => {
    const later = auditReviewStamps(one('2026-06-08'), one('2026-06-08T09:00:00-05:00'), opts)
    expect(later.stampOnly.map((e) => e.id)).toEqual(['a'])
    const earlier = auditReviewStamps(one('2026-06-08T12:00:00Z'), one('2026-06-08'), opts)
    expect(earlier.backward.map((e) => e.id)).toEqual(['a'])
    expect(auditReviewStamps(one('2026-06-08'), one('2026-06-08T00:00:00Z'), opts).status).toBe('ok')
  })

  it('PF-13: bulkBump groups by the UTC day of the new stamp, so one local day across UTC midnight splits', () => {
    const before = many(12, () => '2026-01-01')
    const straddle = many(12, (i) => (i < 6 ? '2026-06-08T18:50:00-05:00' : '2026-06-08T19:10:00-05:00'), 'y')
    const split = auditReviewStamps(before, straddle, opts)
    expect(split.bulkBump).toEqual([])
    expect(split.status).toBe('ok')
    const oneDay = auditReviewStamps(before, many(12, () => '2026-06-08', 'y'), opts)
    expect(oneDay.bulkBump.map((b) => [b.count, b.withEvidence, b.withoutEvidence])).toEqual([[12, 12, 0]])
    expect(auditReviewStamps(before, straddle, { ...opts, bulkThreshold: 5 }).bulkBump.map((b) => b.count)).toEqual([6, 6])
  })

  it('DR-11 / PF-15: a file-level date copied onto every record makes the unchanged records stampOnly', () => {
    const file = (reviewed: string, changed: boolean): { reviewed: string; programs: Array<{ id: string; v: number }> } => ({
      reviewed,
      programs: Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, v: i === 0 && changed ? 99 : i })),
    })
    const stamp = (f: ReturnType<typeof file>): Array<{ id: string; v: number; reviewed: string }> => f.programs.map((p) => ({ ...p, reviewed: f.reviewed }))
    const r = auditReviewStamps(stamp(file('2026-01-01', false)), stamp(file('2026-10-01', true)), { reviewedField: 'reviewed', sourceFields: [] })
    expect(r.status).toBe('flagged')
    expect(r.stampOnly).toHaveLength(11)
    expect(r.bulkBump.map((b) => [b.count, b.withEvidence, b.withoutEvidence])).toEqual([[12, 1, 11]])
  })
})

describe('PK4-7: the accepted offset range and ASCII-only digits', () => {
  const reason = (date: string): string | undefined => {
    const r = auditReviewStamps([{ id: 'a', v: 1, lastReviewed: '2026-01-01' }], [{ id: 'a', v: 1, lastReviewed: date }], { reviewedField: 'lastReviewed', sourceFields: [] })
    return r.unknown[0]?.reason
  }

  it('PK4-7: offsets from -23:59 to +23:59 parse, and -00:00 parses', () => {
    for (const date of ['2026-06-08T00:00:00+23:59', '2026-06-08T00:00:00-23:59', '2026-06-08T00:00:00-00:00']) expect(reason(date)).toBeUndefined()
  })

  it('PK4-7: an offset outside the range, without a colon, or with a bad minute is unparseable, never a pass', () => {
    for (const date of ['2026-06-08T00:00:00+24:00', '2026-06-08T00:00:00+05:60', '2026-06-08T00:00:00+0530', '2026-06-08T00:00:00+05', '2026-06-08T00:00:00.1234567891Z']) {
      expect(reason(date)).toBe('unparseable-date')
    }
  })

  it('PK4-7: full-width digits are not a date', () => {
    expect(reason('２０２６-06-02')).toBe('unparseable-date')
  })
})

describe('hostile-F12 / hostile-F10: documented limits of what is read and what a registry costs', () => {
  it('hostile-F12: named properties on an array are ignored, a hidden id still identifies, hidden other fields are not read', () => {
    expect(compareMirror([{ id: 'a', v: [1] }], [{ id: 'a', v: Object.assign([1], { x: 1 }) }]).status).toBe('ok')
    const hiddenId = { v: 1 }
    Object.defineProperty(hiddenId, 'id', { value: 'a', enumerable: false })
    expect(compareMirror([hiddenId], [{ id: 'a', v: 1 }]).status).toBe('ok')
    const hiddenField = { id: 'a', v: 1 }
    Object.defineProperty(hiddenField, 'w', { value: 1, enumerable: false })
    expect(compareMirror([hiddenField], [{ id: 'a', v: 1, w: 2 }]).changed.map((c) => [c.field, c.change])).toEqual([['w', 'extra-in-mirror']])
  })

  it('hostile-F10: one value registered under k ids returns k hits per occurrence, so hits are registry size times occurrences', () => {
    const registry = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, value: 1.25 }))
    expect(findHandTypedConstants('1.25 and 1.25', registry)).toHaveLength(80)
  })
})

// ---------------------------------------------------------------------------
// Release gate findings on 661e47a (each row names its finding id)
// ---------------------------------------------------------------------------

describe('gate-review:F1 / gate-false-pass:GFP-10 / gate-hostile:F10: the rounding allowance never grows past a thousandth of the tolerance', () => {
  const eq = (a: number, b: number, tol: number): boolean =>
    compareMirror([{ id: 'x', v: a }], [{ id: 'x', v: b }], { numberTolerance: tol }).ok

  it.each([
    ['cents at 6e12, 0.02 apart', 6e12, 6e12 + 0.02, 0.01],
    ['cents at 4e13, 0.03 apart', 4e13, 4e13 + 0.03, 0.01],
    ['tenths at 6e13, 0.2 apart', 6e13, 6e13 + 0.2, 0.1],
    ['integers at 1.7e15, 1 apart, tolerance 0.5', 1.7e15, 1.7e15 + 1, 0.5],
    ['integers at 1.7e15, 2 apart, tolerance 0.5', 1.7e15, 1.7e15 + 2, 0.5],
    ['epoch microseconds, 1 apart, tolerance 0.001', 1.7e15, 1.7e15 + 1, 0.001],
    ['2^53 region, 16 apart, tolerance 0.5', 9007199254740000, 9007199254740016, 0.5],
    ['one unit at 1e15, tolerance 0.01', 1e15, 1e15 + 1, 0.01],
    ['whole units at 9e15, tolerance 0.01', 9e15, 9e15 + 10, 0.01],
    ['a thousandth of a unit above 5e12 at tolerance 0.005', 5e12, 5e12 + 0.0098, 0.005],
  ])('gate-review:F1: %s is flagged', (_name, a, b, tol) => {
    expect(eq(a, b, tol)).toBe(false)
  })

  it('gate-review:F1: small and medium magnitudes keep their behavior', () => {
    expect(eq(1000, 1000.02, 0.01)).toBe(false)
    expect(eq(1.25, 1.15, 0.1)).toBe(true)
    expect(eq(1e6 + 0.25, 1e6 + 0.26, 0.01)).toBe(true)
    expect(eq(1e9 + 0.25, 1e9 + 0.26, 0.01)).toBe(true)
    expect(eq(1e9 + 0.25, 1e9 + 0.27, 0.01)).toBe(false)
  })

  it('gate-review:F1: no difference larger than 1.001 times the tolerance is ever equal, at any magnitude', () => {
    let wrong = 0
    let total = 0
    for (const tol of [0.001, 0.01, 0.1, 0.5, 1, 25]) {
      for (const magnitude of [1, 1e3, 1e6, 1e9, 1e11, 1e12, 1e13, 1e14, 1e15, 4e15, 1e17]) {
        for (const factor of [1.01, 1.5, 2, 10]) {
          const a = magnitude
          const b = magnitude + tol * factor
          // Skip pairs the doubles cannot tell apart or whose real gap fell under the tolerance.
          if (Math.abs(b - a) <= tol * 1.001) continue
          total += 1
          if (eq(a, b, tol)) wrong += 1
        }
      }
    }
    expect(total).toBeGreaterThan(100)
    expect(wrong).toBe(0)
  })
})

describe('gate-review:F3 / gate-review:F7 / gate-hostile:F5: the key column is not a comparison', () => {
  const canon = [{ id: 'a', v: 1.25 }]
  const mirror = [{ id: 'a', v: 1.0 }]

  it('gate-review:F3: naming the key in fields and ignoring every real field compared nothing, so it is unknown', () => {
    const r = compareMirror(canon, mirror, { fields: ['id', 'v'], ignoreFields: ['v'] })
    expect(r.ok).toBe(false)
    expect(r.status).toBe('unknown')
    expect(r.noFieldsCompared).toBe(true)
    expect(r.compared).toBe(1)
  })

  it('gate-review:F3: reviewedField set to the key gives the same answer', () => {
    const r = compareMirror(canon, mirror, { reviewedField: 'id', ignoreFields: ['v'] })
    expect(r.status).toBe('unknown')
    expect(r.noFieldsCompared).toBe(true)
  })

  it('gate-review:F3: the same call with a real field left in still compares and flags it', () => {
    const r = compareMirror(canon, mirror, { fields: ['id', 'v'] })
    expect(r.status).toBe('flagged')
    expect(r.noFieldsCompared).toBe(false)
  })

  it('gate-review:F3: records that carry only an id stay an honest presence check, also with the key named in fields', () => {
    const r = compareMirror([{ id: 'a' }, { id: 'b' }], [{ id: 'a' }, { id: 'b' }], { fields: ['id'] })
    expect(r.status).toBe('ok')
    expect(r.noFieldsCompared).toBe(false)
    expect(compareMirror([{ id: 'a' }], [{ id: 'b' }], { fields: ['id'] }).status).toBe('flagged')
  })

  it('gate-review:F3: ignoring the key itself does not turn a presence check into a no-op', () => {
    const r = compareMirror([{ id: 'a' }, { id: 'b' }], [{ id: 'a' }, { id: 'b' }], { ignoreFields: ['id'] })
    expect(r.status).toBe('ok')
    expect(r.unknownFields).toEqual([])
  })

  it('gate-review:F7: a fields list that ignoreFields cancels is still refused', () => {
    expect(() => compareMirror(canon, mirror, { fields: ['v'], ignoreFields: ['v'] })).toThrowError(
      expect.objectContaining({ code: 'bad-options' }) as Error,
    )
  })

  it('gate-review:F7: with a review field that still counts, the review dates are compared and the call is not refused', () => {
    const a = [{ id: 'a', v: 1, lastReviewed: '2026-01-01' }]
    const same = compareMirror(a, [{ id: 'a', v: 2, lastReviewed: '2026-01-01' }], { fields: ['v'], ignoreFields: ['v'], reviewedField: 'lastReviewed' })
    expect(same.status).toBe('ok')
    expect(same.noFieldsCompared).toBe(false)
    const moved = compareMirror(a, [{ id: 'a', v: 2, lastReviewed: '2026-02-01' }], { fields: ['v'], ignoreFields: ['v'], reviewedField: 'lastReviewed' })
    expect(moved.status).toBe('flagged')
    expect(moved.changed.map((c) => c.field)).toEqual(['lastReviewed'])
  })

  it('gate-review:F7: when the review field is ignored too, nothing would be compared and the call is refused', () => {
    expect(() =>
      compareMirror(canon, mirror, { fields: ['v'], ignoreFields: ['v', 'lastReviewed'], reviewedField: 'lastReviewed' }),
    ).toThrowError(expect.objectContaining({ code: 'bad-options' }) as Error)
  })

  it('gate-hostile:F5: in an object-keyed dataset the key name always counts as present (documented): fields: ["id"] compares nothing and is ok', () => {
    const r = compareMirror({ a: { v: 1 }, b: { v: 2 } }, { a: { v: 9 }, b: { v: 2 } }, { fields: ['id'] })
    expect(r.status).toBe('ok')
    expect(r.unknownFields).toEqual([])
    expect(r.compared).toBe(2)
    // The README says so, and says what to do instead: name the fields to compare.
    expect(compareMirror({ a: { v: 1 } }, { a: { v: 9 } }, { fields: ['v'] }).status).toBe('flagged')
  })

  it('gate-hostile:F5: in an array the key name still counts as present', () => {
    const r = compareMirror(canon, canon.map((x) => ({ ...x })), { fields: ['id', 'v'] })
    expect(r.unknownFields).toEqual([])
    expect(r.status).toBe('ok')
  })
})

describe('gate-hostile:F1: now must fall in years 0001 to 9999, the years a stamp can have', () => {
  const before = [{ id: 'a', price: 1, lastReviewed: '2026-01-01' }]
  const after = [{ id: 'a', price: 2, lastReviewed: '2999-12-31' }]
  const run = (now: unknown) => auditReviewStamps(before, after, { reviewedField: 'lastReviewed', sourceFields: [], now: now as number })
  const LAST_MS = 253402300799999 // 9999-12-31T23:59:59.999Z
  const FIRST_MS = -62135596800000 // 0001-01-01T00:00:00.000Z

  it('gate-hostile:F1: a real now flags the far-future stamp (control)', () => {
    const r = run(Date.UTC(2026, 9, 14))
    expect(r.status).toBe('flagged')
    expect(r.future.map((f) => f.id)).toEqual(['a'])
  })

  it.each([
    ['microseconds', Date.UTC(2026, 9, 14) * 1000],
    ['nanoseconds', Date.UTC(2026, 9, 14) * 1e6],
    ['1e300', 1e300],
    ['one past the Date range', 8.64e15 + 1],
    ['one past the Date range, negative', -(8.64e15 + 1)],
    ['one millisecond past the year 9999', LAST_MS + 1],
    ['one millisecond before the year 1', FIRST_MS - 1],
    ['a valid Date in the year 10000', new Date(LAST_MS + 1)],
  ])('gate-hostile:F1: now in %s throws bad-options instead of turning the future check off', (_name, now) => {
    expect(() => run(now)).toThrowError(expect.objectContaining({ code: 'bad-options' }) as Error)
  })

  it('gate-hostile:F1: the edges of that range are accepted', () => {
    expect(() => run(LAST_MS)).not.toThrow()
    expect(() => run(FIRST_MS)).not.toThrow()
    expect(run(LAST_MS).future).toEqual([])
    expect(() => run(new Date(LAST_MS))).not.toThrow()
  })

  it('gate-hostile:F1: epoch seconds is still accepted as a number (it reads as 1970, and every stamp is then future)', () => {
    expect(run(1.78e9).future.map((f) => f.id)).toEqual(['a'])
  })
})

describe('gate-false-pass:GFP-04: printf and format specs are not leading-dot numbers', () => {
  const found = (value: number, text: string): string[] =>
    findHandTypedConstants(text, [{ id: 'c', value }]).map((h) => h.text)

  it.each([
    [0.1, 'printf("%.1f", x)'],
    [0.5, 'print("{:.5f}".format(x))'],
    [0.25, 'fmt = "%.25f"'],
    [0.1, 'f"{score:.1f}"'],
    [0.1, 'format!("{:.1}", x)'],
    [0.2, 'format!("{:.2f}", x)'],
    [0.2, 'f"{value:.2f}"'],
    [0.5, 'Printf("%+.5f", x)'],
    [0.5, 'Printf("%-.5f", x)'],
    [0.5, 'Printf("% .5f", x)'],
    [0.5, 'Printf("%#.5g", x)'],
    [0.1, 'const re = /1\\.1/'],
    [0.1, 'path = `${version}.1`'],
    [0.5, 'items[0].5'],
    [0.5, 'call(x).5'],
  ])('%s is not found in %j', (value, text) => {
    expect(found(value, text)).toEqual([])
  })

  it('gate-false-pass:GFP-04: no digit of a skipped format spec is read as a whole number either', () => {
    expect(found(1, 'printf("%.1f", x)')).toEqual([])
    expect(found(2, 'f"{value:.2f}"')).toEqual([])
    expect(found(5, 'Printf("%+.5f", x)')).toEqual([])
  })

  it.each([
    [0.5, 'x = .5', ['.5']],
    [0.5, 'rate .5 here', ['.5']],
    [0.5, '(.5)', ['.5']],
    [0.5, '[.25, .5]', ['.5']],
    [0.5, 'a=.5;', ['.5']],
    [0.5, 'a,.5', ['.5']],
    [0.5, 'opacity:.5;', ['.5']],
    [0.5, 'margin:.5em', ['.5']],
    [0.5, '{"a":.5,"b":1}', ['.5']],
    [0.5, "'.5'", ['.5']],
    [0.5, 'x*.5', ['.5']],
    [0.5, '50 + .5', ['.5']],
    [0.5, '% = .5', ['.5']],
  ] as Array<[number, string, string[]]>)('gate-false-pass:GFP-04: a real typed %s is still found in %j', (value, text, expected) => {
    expect(found(value, text)).toEqual(expected)
  })

  it('gate-false-pass:GFP-04: looking back for printf flags stays linear in the text', () => {
    expect(found(0.5, '+ '.repeat(50_000) + '.5')).toEqual(['.5'])
    expect(found(0.5, '+ .5 '.repeat(5))).toHaveLength(5)
    const r = growthRatio(
      (n) => {
        const text = '+ .5 '.repeat(n)
        return () => {
          found(0.5, text)
        }
      },
      { small: 20_000, large: 80_000 },
    )
    expect(r).toBeLessThan(GROWTH_LIMIT)
  }, 120_000)
})

describe('gate-hostile:F2: a thousands group needs a leading group of one to three digits', () => {
  const found = (value: number, text: string): string[] =>
    findHandTypedConstants(text, [{ id: 'c', value }]).map((h) => h.text)

  it.each([
    [100, 'label,2024,100,x', ['100']],
    [2024, 'label,2024,100,x', ['2024']],
    [250, '[1000,250]', ['250']],
    [1000, '[1000,250]', ['1000']],
    [678, '12345,678', ['678']],
    [12345, '12345,678', ['12345']],
    [250, 'id=1000,250,x', ['250']],
  ] as Array<[number, string, string[]]>)('gate-hostile:F2: %s is found in %j', (value, text, expected) => {
    expect(found(value, text)).toEqual(expected)
  })

  it.each([
    [1000250, '[1000,250]'],
    [12345678, '12345,678'],
    [2024100, 'label,2024,100,x'],
  ])('gate-hostile:F2: the glued number %s is not found in %j', (value, text) => {
    expect(found(value, text)).toEqual([])
  })

  it('gate-hostile:F2: 0,500 is the decimal-comma spelling of 0.5, so it is neither a 0 nor a 500, and a form can still name it', () => {
    expect(found(500, 'ratio 0,500')).toEqual([])
    expect(found(0, 'ratio 0,500')).toEqual([])
    expect(found(500, 'x 0,500,y')).toEqual([])
    expect(findHandTypedConstants('ratio 0,500 here', [{ id: 'c', value: 0.5, forms: ['0,500'] }]).map((h) => h.text)).toEqual(['0,500'])
    // Two digits after the comma, or a longer fraction, is not that shape.
    expect(found(25, 'ratio 0,25')).toEqual(['25'])
    expect(found(5000, 'x 0,5000')).toEqual(['5000'])
  })

  it.each([
    [1250, '1,250', ['1,250']],
    [12345, '12,345', ['12,345']],
    [1250000, 'total 1,250,000.', ['1,250,000']],
    [999, 'x 999 y', ['999']],
    [100200300, '[100,200,300]', ['100,200,300']],
    [34567, '12,34,567', ['34,567']],
    [12, '12,34,567', ['12']],
    [1250, '1,250,5', ['1,250']],
    [1000000, 'const MAX = 1_000_000;', ['1_000_000']],
  ] as Array<[number, string, string[]]>)('gate-hostile:F2: %s is read as before in %j', (value, text, expected) => {
    expect(found(value, text)).toEqual(expected)
  })
})

describe('gate-false-pass:GFP-12 / gate-hostile:F8: a combining mark glues like the letter it sits on', () => {
  const found = (text: string): string[] => findHandTypedConstants(text, [{ id: 'c', value: 1.25 }]).map((h) => h.text)

  it('gate-false-pass:GFP-12: the NFC and NFD spellings of the same word get the same verdict', () => {
    const nfc = 'café1.25'
    const nfd = 'café1.25'
    expect(nfc.normalize('NFD')).toBe(nfd)
    expect(found(nfc)).toEqual([])
    expect(found(nfd)).toEqual([])
  })

  it('gate-false-pass:GFP-12: Hindi and Arabic words that end in a mark glue like their unmarked forms', () => {
    expect(found('है' + '1.25')).toEqual([]) // है
    expect(found('हम' + '1.25')).toEqual([]) // हम
    expect(found('اللّ' + '1.25')).toEqual([]) // an Arabic word ending in shadda
    expect(found('الل' + '1.25')).toEqual([])
  })

  it('gate-false-pass:GFP-12: a Thai tone mark still does not glue (an unspaced script)', () => {
    expect(found('ที่' + '1.25')).toEqual(['1.25']) // ที่1.25
    expect(found('อัตรา' + '1.25')).toEqual(['1.25'])
  })

  it('gate-false-pass:GFP-12: a mark also keeps a minus sign from reading as a sign, the way a letter does', () => {
    const hits = findHandTypedConstants('café-1.25', [{ id: 'c', value: 1.25 }])
    const letter = findHandTypedConstants('café-1.25', [{ id: 'c', value: 1.25 }])
    expect(hits.map((h) => h.text)).toEqual(letter.map((h) => h.text))
  })

  it('gate-hostile:F8: a number that underflows to zero is not a zero', () => {
    const zero = (text: string): string[] => findHandTypedConstants(text, [{ id: 'z', value: 0 }]).map((h) => h.text)
    expect(zero('x = 1e-999')).toEqual([])
    expect(zero('x = 0.000')).toEqual(['0.000'])
    expect(zero('x = 0e5')).toEqual(['0e5'])
    expect(zero('x = 0')).toEqual(['0'])
  })
})

describe('gate-false-pass:GFP-02: a key is charged by what normalizing it costs, and a look-alike group echoes a short skeleton', () => {
  const FDFA = 'ﷺ' // one UTF-16 unit, 18 code points under compatibility decomposition
  const keysOf = (ch: string, count: number, units = 200, suffix = ''): Array<{ id: string; v: number }> =>
    Array.from({ length: count }, (_, i) => ({ id: ch.repeat(units - 6) + String(100000 + i) + suffix, v: i }))
  const tooLarge = expect.objectContaining({ name: 'ParityError', code: 'too-large' }) as Error

  it('gate-false-pass:GFP-02: ASCII keys fit a budget that the same number of U+FDFA keys of the same length overruns', () => {
    const limits = { maxNodes: 60_000 }
    expect(compareMirror(keysOf('a', 100), keysOf('a', 100), { limits }).status).toBe('ok')
    expect(() => compareMirror(keysOf(FDFA, 100), keysOf(FDFA, 100), { limits })).toThrowError(tooLarge)
  })

  it('gate-false-pass:GFP-02: the charge reaches id-keyed objects too', () => {
    const asObject = (list: Array<{ id: string; v: number }>): Record<string, { v: number }> =>
      Object.fromEntries(list.map((r) => [r.id, { v: r.v }]))
    const limits = { maxNodes: 60_000 }
    expect(compareMirror(asObject(keysOf('a', 100)), asObject(keysOf('a', 100)), { limits }).status).toBe('ok')
    expect(() => compareMirror(asObject(keysOf(FDFA, 100)), asObject(keysOf(FDFA, 100)), { limits })).toThrowError(tooLarge)
  })

  it('gate-false-pass:GFP-02: a key that decomposes a little (Korean, accents) is charged a little more, not refused', () => {
    const korean = Array.from({ length: 50 }, (_, i) => ({ id: `한국어-${i}`, v: i }))
    expect(compareMirror(korean, korean.map((r) => ({ ...r }))).status).toBe('ok')
    const accented = Array.from({ length: 50 }, (_, i) => ({ id: `café-${i}`, v: i }))
    expect(compareMirror(accented, accented.map((r) => ({ ...r }))).status).toBe('ok')
  })

  it('gate-false-pass:GFP-02: the same node budget costs about the same CPU for ASCII and U+FDFA keys (30x before)', () => {
    const limits = { maxNodes: 1_000_000 }
    const cpu = (ch: string): number =>
      cpuMs(() => {
        try {
          compareMirror(keysOf(ch, 300, 1000), keysOf(ch, 300, 1000), { limits })
        } catch (error) {
          if (!(error instanceof Error) || (error as { code?: string }).code !== 'too-large') throw error
        }
      }, 3)
    const ascii = Math.max(cpu('a'), 5)
    const expanded = cpu(FDFA)
    expect(expanded).toBeLessThan(ascii * 8)
  })

  it('gate-false-pass:GFP-02: a look-alike group reports a clipped skeleton, so the report never grows past the input', () => {
    const r = compareMirror(keysOf(FDFA, 20, 4000), keysOf(FDFA, 20, 4000, '​'))
    expect(r.suspectKeys).toHaveLength(20)
    for (const group of r.suspectKeys) expect(group.skeleton.length).toBeLessThan(100)
    const echoed = r.suspectKeys.reduce((sum, g) => sum + g.skeleton.length, 0)
    expect(echoed).toBeLessThan(40 * 100)
  })

  it('gate-false-pass:GFP-02: the clip says how long the skeleton was and keeps short skeletons whole', () => {
    const short = compareMirror([{ id: 'saving  ...', v: 1 }], [{ id: 'saving ...', v: 1 }])
    expect(short.suspectKeys.map((g) => g.skeleton)).toEqual(['saving ...'])
    const long = compareMirror([{ id: 'a'.repeat(500), v: 1 }], [{ id: 'a'.repeat(500) + '​', v: 1 }])
    expect(long.suspectKeys).toHaveLength(1)
    expect(long.suspectKeys[0]?.skeleton).toMatch(/\.\.\. \(500 units\)$/)
  })
})

describe('gate-hostile:F4 / gate-review:F8: foldInvisible: false keeps keys that differ only by an invisible character', () => {
  const emoji = [
    { id: '❤', name: 'red heart (text style)' },
    { id: '❤️', name: 'red heart (emoji style)' },
    { id: '\u{1F441}', name: 'eye' },
    { id: '\u{1F441}️', name: 'eye (emoji style)' },
    { id: '\u{1F468}‍\u{1F469}‍\u{1F467}', name: 'family' },
    { id: '\u{1F468}\u{1F469}\u{1F467}', name: 'man, woman, girl' },
    { id: '\u{1F3F4}', name: 'black flag' },
    { id: '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}', name: 'England' },
    { id: '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}', name: 'Scotland' },
  ]
  const copy = <T extends object>(list: T[]): T[] => list.map((r) => ({ ...r }))

  it('gate-hostile:F4: by default an emoji table is look-alike keys, even against a byte-identical copy (documented)', () => {
    const r = compareMirror(emoji, copy(emoji))
    expect(r.status).toBe('unknown')
    expect(r.suspectKeys).toHaveLength(4)
  })

  it('gate-hostile:F4: foldInvisible: false makes a byte-identical copy of the emoji table ok', () => {
    const r = compareMirror(emoji, copy(emoji), { foldInvisible: false })
    expect(r.status).toBe('ok')
    expect(r.ok).toBe(true)
    expect(r.suspectKeys).toEqual([])
    expect(r.compared).toBe(9)
  })

  it('gate-hostile:F4: with it off, real drift in the table is still flagged', () => {
    const drifted = copy(emoji)
    ;(drifted[1] as { name: string }).name = 'changed'
    const r = compareMirror(emoji, drifted, { foldInvisible: false })
    expect(r.status).toBe('flagged')
    expect(r.changed.map((c) => c.field)).toEqual(['name'])
  })

  it('gate-hostile:F4: with it off, a key that gained an invisible character is missing plus extra, never a pass', () => {
    const r = compareMirror([{ id: 'a', v: 1 }], [{ id: 'a​', v: 1 }], { foldInvisible: false })
    expect(r.ok).toBe(false)
    expect(r.status).toBe('flagged')
    expect(r.missing).toEqual(['a'])
    expect(r.extra).toEqual(['a​'])
    expect(r.suspectKeys).toEqual([])
  })

  it('gate-hostile:F4: with it off, the other folds still apply (NFC against NFD, case, no-break space)', () => {
    expect(compareMirror([{ id: 'café' }, { id: 'café' }], [{ id: 'café' }, { id: 'café' }], { foldInvisible: false }).suspectKeys).toHaveLength(1)
    expect(compareMirror([{ id: 'A' }, { id: 'a' }], [{ id: 'A' }, { id: 'a' }], { foldInvisible: false }).suspectKeys).toHaveLength(1)
    expect(compareMirror([{ id: 'x y' }, { id: 'x y' }], [{ id: 'x y' }, { id: 'x y' }], { foldInvisible: false }).suspectKeys).toHaveLength(1)
  })

  it('gate-review:F8: composite ids joined by U+001F are distinct keys with foldInvisible: false', () => {
    const rows = [{ id: 'us\u001f10001', v: 1 }, { id: 'us1\u001f0001', v: 2 }]
    const dflt = compareMirror(rows, copy(rows))
    expect(dflt.status).toBe('unknown')
    expect(dflt.suspectKeys).toHaveLength(1)
    const off = compareMirror(rows, copy(rows), { foldInvisible: false })
    expect(off.status).toBe('ok')
  })

  it('gate-hostile:F4: the audit takes the same option', () => {
    const snapshot = (date: string): Array<{ id: string; note: string; lastReviewed: string }> =>
      emoji.map((r) => ({ id: r.id, note: r.name, lastReviewed: date }))
    const opts = { reviewedField: 'lastReviewed', sourceFields: [] as string[] }
    expect(auditReviewStamps(snapshot('2026-01-01'), snapshot('2026-01-01'), opts).status).toBe('unknown')
    const off = auditReviewStamps(snapshot('2026-01-01'), snapshot('2026-01-01'), { ...opts, foldInvisible: false })
    expect(off.status).toBe('ok')
    expect(off.suspectKeys).toEqual([])
  })

  it('gate-hostile:F4: a non-boolean foldInvisible throws bad-options in both functions', () => {
    expect(() => compareMirror([{ id: 'a' }], [{ id: 'a' }], { foldInvisible: 'no' } as unknown as MirrorOptions)).toThrowError(
      expect.objectContaining({ code: 'bad-options' }) as Error,
    )
    expect(() =>
      auditReviewStamps([{ id: 'a', lastReviewed: '2026-01-01' }], [{ id: 'a', lastReviewed: '2026-01-01' }], {
        reviewedField: 'lastReviewed',
        sourceFields: [],
        foldInvisible: 0,
      } as unknown as StampOptions),
    ).toThrowError(expect.objectContaining({ code: 'bad-options' }) as Error)
  })
})

describe('gate-false-pass:GFP-05: a polluted Object.prototype changes neither the verdict nor the shape of a report', () => {
  const withPollution = <T>(name: string, descriptor: PropertyDescriptor, fn: () => T): T => {
    Object.defineProperty(Object.prototype, name, { configurable: true, ...descriptor })
    try {
      return fn()
    } finally {
      delete (Object.prototype as unknown as Record<string, unknown>)[name]
    }
  }
  const own = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? `${v}n` : v)))
  const objectDiff = (): unknown => compareMirror([{ id: 'a', v: { x: 1 }, w: [1] }], [{ id: 'a', v: { x: 2 }, w: [2] }])
  const badStamp = (): unknown =>
    auditReviewStamps([{ id: 'a', r: 'x' }], [{ id: 'a', r: 'y' }], { reviewedField: 'r', sourceFields: [] })
  const badRecords = (): unknown => compareMirror([{ id: 'a', v: new Map() }, 5, { id: 'b' }], [{ id: 'a' }, { id: 'b' }])
  const baseline = { objectDiff: own(objectDiff()), badStamp: own(badStamp()), badRecords: own(badRecords()) }

  const getters: Array<[string, PropertyDescriptor]> = [
    ['a function', { writable: true, value: () => 1 }],
    ['a string', { writable: true, value: 'x' }],
    ['a number', { writable: true, value: 7 }],
    ['an accessor returning undefined', { get: () => undefined }],
    ['a read-only value', { writable: false, value: 'RO' }],
  ]

  it.each(getters)('gate-false-pass:GFP-05: Object.prototype.get as %s does not break an object-valued difference', (_name, descriptor) => {
    expect(own(withPollution('get', descriptor, objectDiff))).toEqual(baseline.objectDiff)
  })

  it.each(getters)('gate-false-pass:GFP-05: Object.prototype.set as %s does not break an object-valued difference', (_name, descriptor) => {
    expect(own(withPollution('set', descriptor, objectDiff))).toEqual(baseline.objectDiff)
  })

  it.each(getters)('gate-false-pass:GFP-05: Object.prototype.value as %s does not break an unusable-stamp report', (_name, descriptor) => {
    expect(own(withPollution('value', descriptor, badStamp))).toEqual(baseline.badStamp)
  })

  it.each(['id', 'path', 'detail', 'value'])('gate-false-pass:GFP-05: a writable Object.prototype.%s never reaches an invalid entry', (name) => {
    const got = withPollution(name, { writable: true, value: 'POLLUTED' }, badRecords) as { invalid: Array<Record<string, unknown>> }
    expect(own(got)).toEqual(baseline.badRecords)
    for (const entry of got.invalid) expect(Object.hasOwn(entry, name) ? entry[name] : undefined).not.toBe('POLLUTED')
  })

  it.each(['id', 'path', 'detail', 'value'])('gate-false-pass:GFP-05: a read-only Object.prototype.%s does not throw out of a read', (name) => {
    const descriptor = { writable: false, value: 'RO' }
    expect(own(withPollution(name, descriptor, badRecords))).toEqual(baseline.badRecords)
    expect(own(withPollution(name, descriptor, badStamp))).toEqual(baseline.badStamp)
  })

  it.each(['id', 'path', 'detail', 'value'])('gate-false-pass:GFP-05: an accessor-only Object.prototype.%s does not throw out of a read', (name) => {
    const descriptor = { get: () => 'ACCESSOR' }
    expect(own(withPollution(name, descriptor, badRecords))).toEqual(baseline.badRecords)
    expect(own(withPollution(name, descriptor, badStamp))).toEqual(baseline.badStamp)
  })
})

describe('gate-hostile:F7: arguments past the documented ones are refused, not ignored', () => {
  const loose = (fn: unknown) => fn as (...args: unknown[]) => unknown
  const refused = expect.objectContaining({ name: 'ParityError', code: 'bad-options' }) as Error

  it('gate-hostile:F7: an options bag passed to findHandTypedConstants, which takes none, throws', () => {
    expect(() => loose(findHandTypedConstants)('rate 1.25', [{ id: 'c', value: 1.25 }], { caseSensitive: false })).toThrowError(refused)
  })

  it('gate-hostile:F7: a fourth argument to compareMirror or a fourth to auditReviewStamps throws', () => {
    expect(() => loose(compareMirror)([{ id: 'a' }], [{ id: 'a' }], undefined, { fields: ['id'] })).toThrowError(refused)
    const stamp = { reviewedField: 'r', sourceFields: [] as string[] }
    expect(() => loose(auditReviewStamps)([{ id: 'a', r: '2026-01-01' }], [{ id: 'a', r: '2026-01-01' }], stamp, { now: 1 })).toThrowError(refused)
  })

  it('gate-hostile:F7: the documented arities, with or without the optional argument, still work', () => {
    expect(findHandTypedConstants('rate 1.25', [{ id: 'c', value: 1.25 }])).toHaveLength(1)
    expect(compareMirror([{ id: 'a' }], [{ id: 'a' }]).status).toBe('ok')
    expect(compareMirror([{ id: 'a' }], [{ id: 'a' }], undefined).status).toBe('ok')
    expect(loose(compareMirror)([{ id: 'a' }], [{ id: 'a' }], {}) as { status: string }).toMatchObject({ status: 'ok' })
    expect(auditReviewStamps([{ id: 'a', r: '2026-01-01' }], [{ id: 'a', r: '2026-01-01' }], { reviewedField: 'r', sourceFields: [] }).status).toBe('ok')
  })

  it('gate-hostile:F7: a function passed straight to Array.map is refused, never run with the index as its options', () => {
    expect(() => [[{ id: 'a' }]].map(loose(compareMirror).bind(null, [{ id: 'a' }]))).toThrowError(refused)
  })
})

// ---------------------------------------------------------------------------
// Documentation findings: the text must say what the code does
// ---------------------------------------------------------------------------

describe('gate documentation findings: README, METHOD, CHANGELOG and ENGINEERING say what the code does', () => {
  const doc = (name: string): string => readFileSync(join(import.meta.dirname, '..', name), 'utf8')
  const readme = doc('README.md')
  const method = doc('METHOD.md')
  const changelog = doc('CHANGELOG.md')
  const engineering = doc('ENGINEERING.md')

  it('gate-false-pass:GFP-01: METHOD.md says how a reviewer-name change really stops counting, and the code agrees', () => {
    expect(method).not.toMatch(/Leave `reviewerField` unset to stop counting it/)
    const row = method.split('\n').find((line) => line.startsWith('| Reviewer name changes count as evidence')) ?? ''
    expect(row).toContain('`ignoreFields`')
    expect(row).toContain('`valueFields`')
    const before = [{ id: 'a', lastReviewed: '2026-01-01', price: 5, source: 'u', reviewer: 'ann' }]
    const after = [{ id: 'a', lastReviewed: '2026-10-01', price: 5, source: 'u', reviewer: 'bob' }]
    const base = { reviewedField: 'lastReviewed', sourceFields: ['source'] }
    // Leaving reviewerField unset does not stop the name counting: it is a value field like any other.
    expect(auditReviewStamps(before, after, base).stampOnly).toEqual([])
    // What the row says to do does.
    expect(auditReviewStamps(before, after, { ...base, ignoreFields: ['reviewer'] }).stampOnly).toHaveLength(1)
    expect(auditReviewStamps(before, after, { ...base, valueFields: ['price'] }).stampOnly).toHaveLength(1)
  })

  it('gate-false-pass:GFP-03: the README says which bench command prints which totals', () => {
    expect(readme).toContain('node bench/fetch/fetch.mjs')
    expect(readme).toContain('--tier all')
    expect(readme).toMatch(/npm run bench[^\n]*vendored/)
    expect(method).toContain('--tier all')
    expect(changelog).toContain('--tier all')
  })

  it('gate-review:F10: the maxNodes estimate matches what a three-field record costs', () => {
    const rows = (count: number): Array<{ id: string; name: string; price: number; lastReviewed: string }> =>
      Array.from({ length: count }, (_, i) => ({ id: `rec-${i}`, name: `Name ${i}`, price: i, lastReviewed: '2026-01-01' }))
    const needed = (count: number): number => {
      let lo = 1
      let hi = 5_000_000
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        try {
          compareMirror(rows(count), rows(count), { limits: { maxNodes: mid } })
          hi = mid
        } catch {
          lo = mid + 1
        }
      }
      return lo
    }
    const perRecordPerSide = needed(2000) / 2000 / 2
    expect(perRecordPerSide).toBeGreaterThan(16)
    expect(perRecordPerSide).toBeLessThan(19)
    for (const text of [readme, method]) {
      expect(text).not.toContain('350,000')
      expect(text).not.toMatch(/about 14 on each/)
    }
    expect(readme).toContain('290,000')
    expect(readFileSync(join(import.meta.dirname, '..', 'src', 'snapshot.ts'), 'utf8')).not.toContain('about 14 per')
  })

  it('gate-review:F9: the CHANGELOG names noFieldsCompared', () => {
    expect(changelog).toContain('noFieldsCompared')
  })

  it('gate-review:F6: the docs say the surplus of absent ids may include the unreadable record', () => {
    expect(method).not.toContain('A record is never called missing because it could not be read.')
    expect(method).toMatch(/unreadable record/)
    const r = compareMirror([{ id: 'a' }, { id: 'b' }, { id: 'c' }], [{ id: 'a' }, { get id(): string { throw new Error('x') } }])
    // Both b and c are listed although one of them may be the unreadable record, and the result is flagged.
    expect(r.missing).toEqual(['b', 'c'])
    expect(r.status).toBe('flagged')
    expect(readme).toMatch(/at most as many of them as there are unreadable records/)
    expect(engineering).toMatch(/at most as many/)
  })

  it('gate-review:F4: the README says an ignored name is read, with fields and valueFields too', () => {
    expect(readme).toMatch(/A name in `ignoreFields` is read like any other selected name/)
    const getter = { id: 'a', v: 1 }
    let runs = 0
    Object.defineProperty(getter, 'cache', { enumerable: true, get: () => ((runs += 1), 1) })
    compareMirror([getter], [{ id: 'a', v: 1, cache: 1 }], { fields: ['v'], ignoreFields: ['cache'] })
    expect(runs).toBe(1)
  })

  it('gate-false-pass:GFP-06: the README names the host objects that read as an empty plain object', () => {
    expect(readme).toMatch(/`URL`, `URLSearchParams`, `Blob`/)
    const UrlCtor = (globalThis as unknown as { URL: new (url: string) => object }).URL
    const disguised = Object.setPrototypeOf(new UrlCtor('https://example.test/'), null) as object
    expect(compareMirror([{ id: 'a', v: disguised }], [{ id: 'a', v: {} }]).status).toBe('ok')
  })

  it('gate-false-pass:GFP-07: the README names null as well as false for "no deadline"', () => {
    expect(readme).toMatch(/writes `false` or `null` for "no deadline"/)
    const r = auditReviewStamps(
      [{ id: 'a', v: 1, lastReviewed: '2026-01-01', expires: null }],
      [{ id: 'a', v: 1, lastReviewed: '2026-01-01', expires: null }],
      { reviewedField: 'lastReviewed', sourceFields: [], expiryField: 'expires' },
    )
    expect(r.status).toBe('unknown')
    expect(r.unknown.map((u) => u.reason)).toEqual(['missing'])
  })

  it('gate-false-pass:GFP-09: the translation-files recipe says it is for flat placeholders', () => {
    expect(readme).toMatch(/flat placeholders/)
    const tokens = (text: string): string => (text.match(/\{[^}]*\}|<\/?\w+>/g) ?? []).sort().join(' ')
    expect(tokens('{count, plural, one {# file} other {# files}}')).not.toBe(tokens('{count, plural, one {# fichier} other {# fichiers}}'))
  })

  it('gate-false-pass:GFP-11: the README describes the same instant written two ways as it behaves', () => {
    const a = [{ id: 'a', v: 1, reviewed: '2026-06-09' }]
    const b = [{ id: 'a', v: 2, reviewed: '2026-06-09T00:00:00Z' }]
    const r = compareMirror(a, b, { reviewedField: 'reviewed' })
    expect(r.changed.map((c) => c.field)).toEqual(['reviewed', 'v'])
    expect(r.stampHidesDrift.map((h) => h.fields)).toEqual([['v']])
    expect(readme).toMatch(/shows up in `changed` as well as in `stampHidesDrift`/)
  })

  it('gate-false-pass:GFP-13 / gate-hostile:F6: the README says an option set to undefined is treated as omitted, and what that costs', () => {
    expect(readme).toMatch(/An option that is present with the value `undefined` is treated as omitted/)
    expect(readme).toContain('exactOptionalPropertyTypes')
    const before = [{ id: 'a', v: 1, lastReviewed: '2026-01-01', updatedAt: '2026-01-01' }]
    const after = [{ id: 'a', v: 1, lastReviewed: '2026-10-01', updatedAt: '2026-10-01' }]
    const stamp = { reviewedField: 'lastReviewed', sourceFields: [] as string[] }
    expect(auditReviewStamps(before, after, { ...stamp, ignoreFields: ['updatedAt'] }).status).toBe('flagged')
    expect(auditReviewStamps(before, after, { ...stamp, ignoreFields: undefined } as unknown as StampOptions).status).toBe('ok')
  })

  it('gate-false-pass:GFP-14: the README has a recipe for scalar maps, string lists and composite keys', () => {
    expect(readme).toContain('### Data that is not a list of records yet')
  })

  it('gate-hostile:F9: the README says one options object should not be shared by datasets with different fields', () => {
    expect(readme).toMatch(/Do not share one `ignoreFields` list/)
    const shared = { reviewedField: 'lastReviewed', sourceFields: [] as string[], ignoreFields: ['updatedAt', 'etag'] }
    const r = auditReviewStamps(
      [{ id: 'a', v: 1, lastReviewed: '2026-01-01' }],
      [{ id: 'a', v: 2, lastReviewed: '2026-10-01' }],
      shared,
    )
    expect(r.status).toBe('unknown')
    expect(r.unknownFields).toEqual(['updatedAt', 'etag'])
  })

  it('gate-hostile:F11: the README says shared structure is read once per appearance and what a small maxNodes does for untrusted input', () => {
    expect(readme).toMatch(/lower `limits.maxNodes` for untrusted input/)
    expect(engineering).toContain('stated limit')
  })

  it('gate-review:F11: the release workflow runs the checks once, without an npm cache, and needs a green verify run', () => {
    const release = doc('.github/workflows/release.yml')
    expect(release).not.toMatch(/cache: npm/)
    expect(release).toMatch(/npm publish[^\n]*--ignore-scripts/)
    expect(release).toMatch(/actions: read/)
    expect(release).toMatch(/verify\.yml/)
    expect(engineering + doc('CONTRIBUTING.md')).toMatch(/pending trusted publisher/)
  })
})

describe('release-gate:R1: a registry entry reads the same whatever order the Proxy lists its keys', () => {
  // The id getter sets a flag and the value getter answers 1.25 only after it.
  // Reading fields in ownKeys order made the answer depend on that order.
  const make = (order: 'forward' | 'reversed') => {
    let idRan = false
    let valueRan = false
    const target = {
      get id(): string { idRan = true; return 'a' },
      get value(): number { valueRan = true; return idRan ? 1.25 : 99 },
      get forms(): string[] { return idRan && valueRan ? ['one and a quarter'] : [] },
    }
    return new Proxy(target, {
      ownKeys: (t) => (order === 'reversed' ? Reflect.ownKeys(t).reverse() : Reflect.ownKeys(t)),
    })
  }

  it.each(['forward', 'reversed'] as const)('release-gate:R1: getters run in the order id, value, forms (%s ownKeys)', (order) => {
    const hits = findHandTypedConstants('1.25 and one and a quarter', [make(order)])
    expect(hits.map((h) => h.id)).toEqual(['a', 'a'])
  })

  it('release-gate:R1: no getter runs before an unknown enumerable key is refused', () => {
    let runs = 0
    const target = { get id(): string { runs += 1; return 'a' }, value: 1, oops: 2 }
    expect(() => findHandTypedConstants('1', [target])).toThrowError(expect.objectContaining({ code: 'bad-registry' }) as Error)
    expect(runs).toBe(0)
  })
})

describe('release-gate:R2: an object-keyed dataset past maxRecords is refused without reading every slot', () => {
  it('release-gate:R2: 10,000 enumerable keys with maxRecords 1 cost at most two descriptor traps', () => {
    const data: Record<string, unknown> = {}
    for (let i = 0; i < 10_000; i += 1) data[`k${i}`] = { v: 1 }
    let traps = 0
    const proxy = new Proxy(data, {
      getOwnPropertyDescriptor(t, k) { traps += 1; return Reflect.getOwnPropertyDescriptor(t, k) },
    })
    expect(() => compareMirror(proxy, { a: { v: 1 } }, { limits: { maxRecords: 1 } })).toThrowError(
      expect.objectContaining({ code: 'too-large' }) as Error,
    )
    expect(traps).toBeLessThanOrEqual(2)
  })

  it('release-gate:R2: exactly maxRecords enumerable keys still compare', () => {
    const r = compareMirror({ a: { v: 1 }, b: { v: 1 } }, { a: { v: 1 }, b: { v: 1 } }, { limits: { maxRecords: 2 } })
    expect(r.status).toBe('ok')
  })
})

describe('release-gate:R3: the docs describe the 0.1.0 first publish exactly', () => {
  it('release-gate:R3: CONTRIBUTING and ENGINEERING give the npm trust command and the owner-only fallback', () => {
    const doc = (name: string): string => readFileSync(join(import.meta.dirname, '..', name), 'utf8')
    const trust = 'npm trust github parity-kit --file release.yml --repo lkopietz3-byte/parity-kit --allow-publish --yes'
    for (const text of [doc('ENGINEERING.md'), doc('CONTRIBUTING.md')]) {
      expect(text).toContain(trust)
      expect(text).toMatch(/no\s+provenance/)
      expect(text).toMatch(/0\.1\.1/)
    }
    expect(doc('AGENTS.md')).toMatch(/An agent never runs `npm publish`/)
    expect(doc('CHANGELOG.md')).toContain('## [0.1.0] - 2026-10-15')
  })
})

describe('run9:hunt:R9-2: an empty object from another realm is plain data', () => {
  const foreign = (code: string): unknown => vm.runInNewContext(code)

  it.skipIf(!hasUtilTypes)('run9:hunt:R9-2: compareMirror reads an empty {} and an empty Object.create(null) from another realm as plain data', () => {
    for (const code of ['({})', 'Object.create(null)']) {
      const r = compareMirror([{ id: 'a', meta: {} }], [{ id: 'a', meta: foreign(code) }])
      expect(r.invalid).toEqual([])
      expect(r.status).toBe('ok')
      // Both sides from the other realm, as a Jest vm sandbox hands them over.
      expect(compareMirror(foreign("[{ id: 'a', meta: {} }]"), foreign("[{ id: 'a', meta: {} }]")).status).toBe('ok')
    }
  })

  it.skipIf(!hasUtilTypes)('run9:hunt:R9-2: an empty object from another realm still differs from a populated one', () => {
    const r = compareMirror([{ id: 'a', meta: foreign('({})') }], [{ id: 'a', meta: { x: 1 } }])
    expect(r.status).toBe('flagged')
    expect(r.changed).toHaveLength(1)
  })

  it.skipIf(!hasUtilTypes)('run9:hunt:R9-2: auditReviewStamps reads it the same way', () => {
    const before = [{ id: 'a', lastReviewed: '2026-01-01', meta: foreign('({})') }]
    const after = [{ id: 'a', lastReviewed: '2026-01-01', meta: foreign('({})') }]
    const r = auditReviewStamps(before, after, { reviewedField: 'lastReviewed', sourceFields: [] })
    expect(r.invalid).toEqual([])
    expect(r.status).toBe('ok')
  })

  it('run9:hunt:R9-2: a built-in from another realm that has lost its prototype is still unsupported', () => {
    for (const code of [
      'Object.setPrototypeOf(new Map(), null)',
      'Object.setPrototypeOf(Promise.resolve(1), null)',
      'Object.setPrototypeOf(new WeakRef({}), null)',
      'Object.setPrototypeOf(new Error("x"), null)',
      'Object.setPrototypeOf(/x/, null)',
    ]) {
      const r = compareMirror([{ id: 'a', meta: foreign(code) }], [{ id: 'a', meta: {} }])
      expect(r.invalid.map((i) => i.reason), code).toEqual(['unsupported-value'])
    }
  })
})

describe('run9:hunt:R9-1: a Rust type suffix after an underscore ends the number', () => {
  const texts = (text: string, value: number | string, forms?: string[]): string[] =>
    findHandTypedConstants(text, [{ id: 'k', value, ...(forms === undefined ? {} : { forms }) }]).map((hit) => hit.text)

  it.each([
    [1.25, 'const CPP: f64 = 1.25_f64;', '1.25'],
    [1.25, 'let x = 1.25_f32;', '1.25'],
    [1.25, 'x=1.25_f32;', '1.25'],
    [1000000, 'let n = 1_000_000_u64;', '1_000_000'],
    [1000000, 'let n = 1_000_000_i64;', '1_000_000'],
    [1000000, 'let n = 1_000_000_u128;', '1_000_000'],
    [8, 'let n = 8_usize;', '8'],
    [8, 'let n = 8_isize;', '8'],
    [8, 'let n = 8_u8;', '8'],
    [8, 'let n = 8_i16;', '8'],
    [8, 'let n = 8_u32;', '8'],
    [1, 'let n = 1_f64.max(2.0);', '1'],
    [1.25, 'const A: [f64; 2] = [1.25_f64, 2.0_f64];', '1.25'],
    // The spellings that already worked keep working.
    [1.25, 'const CPP: f64 = 1.25f64;', '1.25'],
    [1000000, 'let n = 1_000_000u64;', '1_000_000'],
    [1.25, 'const CPP: f64 = 1.25;', '1.25'],
  ] as Array<[number, string, string]>)('%s is found in %j', (value, text, shown) => {
    expect(texts(text, value)).toEqual([shown])
  })

  it.each([
    // Only a Rust numeric type, followed by a boundary, ends the number. Anything else stays glued.
    [1.25, '1.25_x'],
    [1.25, '1.25_f6'],
    [1.25, '1.25_f640'],
    [1.25, '1.25_f64x'],
    [1.25, '1.25_f64_'],
    [1.25, '1.25_f16'],
    [1.25, '1.25_float'],
    [1.25, '1.25_u'],
    [1.25, '1.25_i'],
    [1.25, '1.25_u1280'],
    [1.25, '1.25_usizes'],
    [1.25, '1.25_isize_x'],
    [1250, '1_250_x'],
    [1.25, 'x_1.25_f64'],
    [1.25, 'v1.25_f64'],
    [1.25, '1.25.3_f64'],
    [1.25, '1.2_f64'],
    [1.25, '11.25_f64'],
    [1.25, '1.255_f64'],
    [8, '8_U8'],
    [8, '8_usize_'],
    [8, '18_usize'],
  ] as Array<[number, string]>)('%s is NOT found in %j', (value, text) => {
    expect(texts(text, value)).toEqual([])
  })

  it('a suffix still ends the number when an unspaced script follows it', () => {
    expect(texts('值1.25_f64美分', 1.25)).toEqual(['1.25'])
  })

  it('a literal form that ends in a digit follows the same boundary', () => {
    expect(texts('x = 8_u8; y = 8_usize;', 'k', ['8'])).toEqual(['8', '8'])
    expect(texts('x = 8_x;', 'k', ['8'])).toEqual([])
  })

  it('the README and CHANGELOG name the suffix rule and what stays glued', () => {
    const doc = (name: string): string => readFileSync(join(import.meta.dirname, '..', name), 'utf8')
    expect(doc('README.md')).toMatch(/`1\.25_f64`, `1_000_000_u64` and `8_usize`/)
    expect(doc('README.md')).toMatch(/`1\.25_x` and `1\.25_f64x` are still skipped/)
    expect(doc('CHANGELOG.md')).toContain('`1.25_f64`')
  })

  it('reports the offset of the number, not of the suffix', () => {
    const [hit] = findHandTypedConstants('let cpp = 1.25_f64;', [{ id: 'k', value: 1.25 }])
    expect(hit).toMatchObject({ text: '1.25', index: 10, line: 1, column: 11, kind: 'number' })
  })
})

describe('run9:first5:F11 / F09: a message names the function and says what is wrong', () => {
  const fail = (fn: () => unknown): { code: string; message: string } => {
    try {
      fn()
    } catch (error) {
      const e = error as { code: string; message: string }
      return { code: e.code, message: e.message }
    }
    throw new Error('expected the call to throw')
  }
  const opts = { reviewedField: 'lastReviewed', sourceFields: [] as string[] }
  const call = (...args: unknown[]): unknown => (compareMirror as (...a: unknown[]) => unknown)(...args)
  const audit = (...args: unknown[]): unknown => (auditReviewStamps as (...a: unknown[]) => unknown)(...args)

  it('run9:first5:F11: compareMirror with one argument says the mirror is missing and shows the call', () => {
    const e = fail(() => call([{ id: 1 }]))
    expect(e.code).toBe('bad-input')
    expect(e.message).toMatch(/^compareMirror: mirror is missing/)
    expect(e.message).toContain('compareMirror(canonical, mirror, options?)')
  })

  it('run9:first5:F11: compareMirror with no argument says the canonical set is missing', () => {
    const e = fail(() => call())
    expect(e.code).toBe('bad-input')
    expect(e.message).toMatch(/^compareMirror: canonical is missing/)
  })

  it('run9:first5:F11: auditReviewStamps names itself and the snapshot that is missing', () => {
    const e = fail(() => audit([{ id: 'a' }], undefined, opts))
    expect(e.code).toBe('bad-input')
    expect(e.message).toMatch(/^auditReviewStamps: after is missing/)
    expect(e.message).toContain('auditReviewStamps(before, after, options)')
  })

  it.each([
    ['null', null, 'null'],
    ['a string', 'id', 'a string'],
    ['a number', 5, 'a number'],
    ['a function', () => [], 'a function'],
    ['a boolean', true, 'a boolean'],
  ] as Array<[string, unknown, string]>)('run9:first5:F09: %s says what it got', (_name, value, got) => {
    const e = fail(() => call(value, []))
    expect(e.code).toBe('bad-input')
    expect(e.message).toBe(`compareMirror: canonical must be an array of records or a plain object keyed by id, got ${got}`)
    expect(fail(() => audit([], value, opts)).message).toBe(`auditReviewStamps: after must be an array of records or a plain object keyed by id, got ${got}`)
  })

  it.each([
    ['a Map', new Map()],
    ['a Set', new Set()],
    ['a Date', new Date(0)],
    ['a Promise', Promise.resolve([])],
    ['a typed array', new Uint8Array(2)],
    ['a class instance', new (class Foo {})()],
    ['a null-prototype Map', Object.setPrototypeOf(new Map(), null)],
  ] as Array<[string, unknown]>)('run9:first5:F09: %s gets the same wording, with "plain object" and the function name', (_name, value) => {
    const e = fail(() => call([{ id: 'a' }], value))
    expect(e.code).toBe('bad-input')
    expect(e.message).toBe('compareMirror: mirror must be an array of records or a plain object keyed by id, not a built-in or class instance such as a Map or Date')
  })

  it('run9:first5:F09: a limit message carries the function name too', () => {
    const e = fail(() => call([{ id: 'a' }, { id: 'b' }, { id: 'c' }], [], { limits: { maxRecords: 2 } }))
    expect(e.code).toBe('too-large')
    expect(e.message).toBe('compareMirror: canonical has 3 records; the limit is limits.maxRecords (2)')
    const keyed = fail(() => call({ a: {}, b: {}, c: {} }, {}, { limits: { maxRecords: 2 } }))
    expect(keyed.message).toMatch(/^compareMirror: canonical has more than 2 records/)
  })

  it('run9:first5:F09: a misspelled option name suggests the nearest real one', () => {
    expect(fail(() => compareMirror([{ id: 'a' }], [{ id: 'a' }], { reviewedFeild: 'r' } as MirrorOptions)).message).toBe(
      'compareMirror: unknown option "reviewedFeild" (did you mean "reviewedField"?)',
    )
    expect(fail(() => compareMirror([{ id: 'a' }], [{ id: 'a' }], { reviewedfield: 'r' } as MirrorOptions)).message).toBe(
      'compareMirror: unknown option "reviewedfield" (did you mean "reviewedField"?)',
    )
    expect(fail(() => compareMirror([{ id: 'a' }], [{ id: 'a' }], { ignoreField: ['x'] } as MirrorOptions)).message).toBe(
      'compareMirror: unknown option "ignoreField" (did you mean "ignoreFields"?)',
    )
    expect(fail(() => auditReviewStamps([], [], { ...opts, ignoreFeilds: ['x'] } as StampOptions)).message).toBe(
      'auditReviewStamps: unknown option "ignoreFeilds" (did you mean "ignoreFields"?)',
    )
    expect(fail(() => compareMirror([{ id: 'a' }], [{ id: 'a' }], { limits: { maxNode: 5 } } as unknown as MirrorOptions)).message).toBe(
      'compareMirror limits: unknown option "maxNode" (did you mean "maxNodes"?)',
    )
  })

  it('run9:first5:F09: a name that is not close to any option gets no suggestion, and a long one costs nothing', () => {
    expect(fail(() => compareMirror([{ id: 'a' }], [{ id: 'a' }], { foo: 1 } as unknown as MirrorOptions)).message).toBe('compareMirror: unknown option "foo"')
    const long = 'x'.repeat(100_000)
    expect(fail(() => compareMirror([{ id: 'a' }], [{ id: 'a' }], { [long]: 1 })).message).toBe(`compareMirror: unknown option "${long}"`)
  })
})
