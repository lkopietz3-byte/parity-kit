import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { auditReviewStamps, compareMirror, findHandTypedConstants } from '../src/index.js'
import { structuredCopy } from './helpers.js'

// Hostile values: every row either passes honestly, is flagged, or produces
// a documented error. None may crash, hang, or read a value twice.

describe('Proxy records and datasets', () => {
  function reorderKeys<T extends object>(target: T): T {
    return new Proxy(target, {
      ownKeys: (t) => Reflect.ownKeys(t).reverse(),
    })
  }

  it('a record whose ownKeys come back reordered still matches', () => {
    const a = [{ id: 'a', x: 1, y: [1, 2], z: { p: 1, q: 2 } }]
    const b = a.map((r) => reorderKeys({ ...r, z: reorderKeys({ ...r.z }) }))
    expect(compareMirror(a, b).ok).toBe(true)
  })

  it('an id-keyed dataset whose ownKeys come back reordered gives the same result', () => {
    const plain = { a: { v: 1 }, b: { v: 2 }, c: { v: 3 } }
    const reordered = reorderKeys({ a: { v: 1 }, b: { v: 9 }, c: { v: 3 } })
    const r1 = compareMirror(plain, reordered)
    const r2 = compareMirror(plain, { a: { v: 1 }, b: { v: 9 }, c: { v: 3 } })
    expect(r1).toEqual(r2)
    expect(r1.changed).toMatchObject([{ id: 'b', field: 'v' }])
  })

  it('never uses the get trap of a record, so a lying get trap cannot change the verdict', () => {
    const lies = new Proxy({ id: 'a', v: 1 }, { get: () => 'lie' })
    expect(compareMirror([{ id: 'a', v: 1 }], [lies]).ok).toBe(true)
    expect(compareMirror([{ id: 'a', v: 2 }], [lies]).changed).toHaveLength(1)
  })

  it('a record that reports different keys than it has is judged by what its traps say, once', () => {
    let calls = 0
    const counting = new Proxy({ id: 'a', v: 1 }, {
      ownKeys(t) { calls += 1; return Reflect.ownKeys(t) },
    })
    compareMirror([counting], [counting])
    expect(calls).toBe(2) // once per side
  })

  it('a Proxy that throws only on one field makes that record invalid, the rest are compared', () => {
    const hostile = new Proxy({ id: 'a', v: 1 }, {
      getOwnPropertyDescriptor(t, k) { if (k === 'v') throw new Error('trap'); return Reflect.getOwnPropertyDescriptor(t, k) },
    })
    const r = compareMirror([hostile, { id: 'b', v: 1 }], [{ id: 'a', v: 1 }, { id: 'b', v: 2 }])
    expect(r.invalid).toMatchObject([{ side: 'canonical', id: 'a', reason: 'unreadable' }])
    expect(r.changed).toMatchObject([{ id: 'b' }])
  })

  it('a Proxy around an array dataset is read like an array', () => {
    const arr = new Proxy([{ id: 'a', v: 1 }], {})
    expect(compareMirror(arr, [{ id: 'a', v: 1 }]).ok).toBe(true)
  })

  it('a Proxy that claims a null prototype is read through its traps, not trusted for contents', () => {
    const p = new Proxy({ id: 'a', v: 1 }, { getPrototypeOf: () => null })
    expect(compareMirror([p], [{ id: 'a', v: 1 }]).ok).toBe(true)
  })

  it('a Proxy around a Date is not mistaken for a Date', () => {
    const r = compareMirror([{ id: 'a', d: new Proxy(new Date(1), {}) }], [{ id: 'a', d: new Date(1) }])
    expect(r.ok).toBe(false)
  })
})

describe('one bad record leaves no state behind', () => {
  it('a cyclic or too-deep record does not disturb the records after it', () => {
    const cyc: Record<string, unknown> = { id: 'c' }
    cyc['self'] = cyc
    let deep: unknown = 1
    for (let i = 0; i < 500; i += 1) deep = [deep]
    const canonical = [cyc, { id: 'd', deep }, { id: 'a', list: [1, { x: 2 }], v: 1 }, { id: 'b', v: 1 }]
    const mirror = [cyc, { id: 'd', deep }, { id: 'a', list: [1, { x: 2 }], v: 1 }, { id: 'b', v: 2 }]
    const r = compareMirror(canonical, mirror)
    expect(r.invalid.map((i) => i.reason).sort()).toEqual(['cycle', 'cycle', 'too-deep', 'too-deep'])
    expect(r.changed).toMatchObject([{ id: 'b' }])
    expect(r.compared).toBe(2)
    expect(r.missing).toEqual([])
  })
})

describe('getters', () => {
  it('reads each getter exactly once per side', () => {
    let reads = 0
    const record = { id: 'a', get v(): number { reads += 1; return reads } }
    const r = compareMirror([record], [record])
    expect(reads).toBe(2)
    expect(r.changed).toMatchObject([{ id: 'a', field: 'v', canonical: 1, mirror: 2 }])
  })

  it('a getter that changes its answer cannot make a field both equal and different', () => {
    let n = 0
    const flip = { id: 'a', get v(): number { n += 1; return n % 2 } }
    const r = compareMirror([flip], [{ id: 'a', v: 1 }])
    expect(r.changed.length + (r.ok ? 1 : 0)).toBe(1)
  })

  it('a throwing getter is an invalid record on that side', () => {
    const r = compareMirror([{ id: 'a', get v(): number { throw new Error('boom') } }], [{ id: 'a', v: 1 }])
    expect(r.invalid).toMatchObject([{ side: 'canonical', id: 'a', reason: 'unreadable', path: 'v' }])
    expect(r.ok).toBe(false)
    expect(r.invalid[0]?.detail).toContain('boom')
  })

  it('a getter that throws a hostile non-Error is still just an invalid record', () => {
    const evil = { toString(): string { throw new Error('no') }, get message(): string { throw new Error('no') } }
    const r = compareMirror([{ id: 'a', get v(): number { throw evil as Error } }], [{ id: 'a', v: 1 }])
    expect(r.invalid[0]?.reason).toBe('unreadable')
  })

  it('a throwing getter on the key field', () => {
    const r = compareMirror([{ get id(): string { throw new Error('boom') } }, { id: 'ok' }], [{ id: 'ok' }])
    expect(r.invalid).toMatchObject([{ reason: 'unreadable' }])
  })

  it('an inherited accessor is never run and never read as data', () => {
    let ran = 0
    const proto = Object.create(null, { id: { get() { ran += 1; return 'a' }, enumerable: true } }) as object
    const record = Object.create(proto) as object
    const r = compareMirror([record], [{ id: 'a' }])
    expect(ran).toBe(0)
    expect(r.invalid).toMatchObject([{ reason: 'missing-key' }])
  })

  it('an inherited field is not part of the record', () => {
    const proto = Object.create(null, { v: { value: 99, enumerable: true } }) as object
    const record = Object.assign(Object.create(proto) as object, { id: 'a' })
    expect(compareMirror([record], [{ id: 'a' }]).ok).toBe(true)
  })

  it('a non-enumerable own field and symbol keys are ignored by default', () => {
    const record = { id: 'a' }
    Object.defineProperty(record, 'hidden', { value: 1, enumerable: false })
    Object.defineProperty(record, Symbol('s'), { value: 1, enumerable: true })
    expect(compareMirror([record], [{ id: 'a' }]).ok).toBe(true)
  })

  it('options getters are read once', () => {
    let reads = 0
    const options = { get key(): string { reads += 1; return 'id' } }
    compareMirror([{ id: 'a' }], [{ id: 'a' }], options)
    expect(reads).toBe(1)
  })
})

describe('toJSON, then, and other protocol hooks are never called', () => {
  it('an inherited toJSON that would change the data is ignored', () => {
    let called = 0
    const proto = Object.create(null, { toJSON: { value() { called += 1; return { id: 'a', v: 999 } } } }) as object
    const record = Object.assign(Object.create(proto) as object, { id: 'a', v: 1 })
    expect(compareMirror([record], [{ id: 'a', v: 1 }]).ok).toBe(true)
    expect(called).toBe(0)
  })

  it('a class instance with toJSON on its prototype is reported, not serialized', () => {
    let called = 0
    class Rec {
      id = 'a'
      toJSON(): unknown { called += 1; return { id: 'a' } }
    }
    const r = compareMirror([new Rec()], [{ id: 'a' }])
    expect(called).toBe(0)
    expect(r.invalid[0]?.reason).toBe('not-a-plain-object')
  })

  it('a thenable dataset is not awaited or called', () => {
    let called = 0
    const thenable = { then() { called += 1 } }
    const r = compareMirror(thenable, [], { allowEmpty: true })
    expect(called).toBe(0)
    expect(r.invalid[0]?.reason).toBe('not-an-object')
  })

  it('symbol-keyed hooks (toPrimitive, iterator, toStringTag) are not run', () => {
    let called = 0
    const record = {
      id: 'a',
      get [Symbol.toPrimitive](): () => string { called += 1; return () => 'x' },
      get [Symbol.iterator](): () => never { called += 1; throw new Error('no') },
    }
    expect(compareMirror([record], [{ id: 'a' }]).ok).toBe(true)
    expect(called).toBe(0)
  })

  it('a toStringTag that lies or throws does not change what an object is', () => {
    const throwing = { id: 'a', v: { get [Symbol.toStringTag](): string { throw new Error('x') } } }
    expect(compareMirror([throwing], [throwing]).ok).toBe(true)
    const fakeDate = { id: 'a', v: { [Symbol.toStringTag]: 'Date' } }
    expect(compareMirror([fakeDate], [{ id: 'a', v: new Date(0) }]).ok).toBe(false)
  })
})

describe('cross-realm and exotic values', () => {
  it('a Date-like plain object is not a Date', () => {
    const like = { getTime: () => 5 }
    const r = compareMirror([{ id: 'a', d: like }], [{ id: 'a', d: new Date(5) }])
    expect(r.ok).toBe(false)
  })

  it('a Date-like object from another realm is not a Date either', () => {
    const like = vm.runInNewContext('({ getTime() { return 5 }, valueOf() { return 5 } })')
    const r = compareMirror([{ id: 'a', d: like }], [{ id: 'a', d: new Date(5) }])
    expect(r.ok).toBe(false)
  })

  it('a real Date from another realm equals the same time and differs from another time', () => {
    const other = vm.runInNewContext('new Date(5)')
    expect(compareMirror([{ id: 'a', d: other }], [{ id: 'a', d: new Date(5) }]).ok).toBe(true)
    expect(compareMirror([{ id: 'a', d: other }], [{ id: 'a', d: new Date(6) }]).ok).toBe(false)
  })

  it('a Date with a null prototype and a Date subclass are dates by brand', () => {
    const nullProto = new Date(7)
    Object.setPrototypeOf(nullProto, null)
    class MyDate extends Date {}
    expect(compareMirror([{ id: 'a', d: nullProto }], [{ id: 'a', d: new MyDate(7) }]).ok).toBe(true)
    expect(compareMirror([{ id: 'a', d: nullProto }], [{ id: 'a', d: new MyDate(8) }]).ok).toBe(false)
  })

  it('cross-realm arrays and objects are compared structurally', () => {
    const other = vm.runInNewContext("({ id: 'a', list: [1, 2, { x: 1 }], nested: { y: null } })")
    expect(compareMirror([other], [{ id: 'a', list: [1, 2, { x: 1 }], nested: { y: null } }]).ok).toBe(true)
  })

  it('boxed primitives, typed arrays, regexps and errors are unsupported values', () => {
    for (const value of [Object(1) as unknown, Object('x') as unknown, new Uint8Array(2), /x/u, new Error('e'), new WeakMap(), Promise.resolve(1)]) {
      const r = compareMirror([{ id: 'a', v: value }], [{ id: 'a', v: value }])
      expect(r.ok).toBe(false)
      expect(r.invalid.map((i) => i.reason)).toEqual(['unsupported-value', 'unsupported-value'])
    }
  })

  it('bigints are values', () => {
    expect(compareMirror([{ id: 'a', v: 10n ** 30n }], [{ id: 'a', v: 10n ** 30n }]).ok).toBe(true)
    expect(compareMirror([{ id: 'a', v: 10n ** 30n }], [{ id: 'a', v: 10n ** 30n + 1n }]).ok).toBe(false)
  })

  it('frozen and sealed records are fine', () => {
    expect(compareMirror([Object.freeze({ id: 'a', v: Object.freeze([1]) })], [Object.seal({ id: 'a', v: [1] })]).ok).toBe(true)
  })

  it('lone surrogates are compared as written', () => {
    expect(compareMirror([{ id: '\ud800', v: '\udc00' }], [{ id: '\ud800', v: '\udc00' }]).ok).toBe(true)
    expect(compareMirror([{ id: '\ud800', v: 1 }], [{ id: '\ud801', v: 1 }]).missing).toEqual(['\ud800'])
  })
})

describe('results do not alias the input, and the input is not changed', () => {
  it('reported values are copies', () => {
    const canonical = [{ id: 'a', t: { rate: 1.25 } }]
    const mirror = [{ id: 'a', t: { rate: 1.0 } }]
    const before = structuredCopy({ canonical, mirror })
    const r = compareMirror(canonical, mirror)
    const reported = r.changed[0]?.canonical as { rate: number }
    reported.rate = 999
    expect(canonical).toEqual(before.canonical)
    expect({ canonical, mirror }).toEqual(before)
    expect(Object.getPrototypeOf(reported)).toBe(null)
  })

  it('a hostile key named __proto__ in a reported value does not pollute anything', () => {
    const canonical = JSON.parse('[{"id":"a","t":{"__proto__":{"polluted":true}}}]') as unknown
    const mirror = JSON.parse('[{"id":"a","t":{"__proto__":{"polluted":false}}}]') as unknown
    const r = compareMirror(canonical, mirror)
    expect(r.changed).toHaveLength(1)
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
  })
})

describe('auditReviewStamps with hostile values', () => {
  const opts = { reviewedField: 'reviewedOn', sourceFields: ['source'] }
  it('a throwing getter on the stamp is an invalid record, not a crash', () => {
    const hostile = { id: 'a', get reviewedOn(): string { throw new Error('x') } }
    const r = auditReviewStamps([{ id: 'a', reviewedOn: '2026-01-01' }], [hostile], opts)
    expect(r.invalid).toMatchObject([{ side: 'after', id: 'a', reason: 'unreadable' }])
    expect(r.ok).toBe(false)
  })

  it('a stamp that is an object with toString or valueOf is not parsed', () => {
    const sneaky = { toString: () => '2026-01-01', valueOf: () => 0 }
    const r = auditReviewStamps([{ id: 'a', reviewedOn: '2026-01-01' }], [{ id: 'a', reviewedOn: sneaky }], opts)
    expect(r.ok).toBe(false)
    expect(r.invalid).toMatchObject([{ side: 'after', id: 'a', reason: 'unsupported-value', path: 'reviewedOn.toString' }])
  })

  it('cross-realm Date as now is accepted; a Date-like now is refused', () => {
    expect(() => auditReviewStamps([{ id: 'a', reviewedOn: '2026-01-01' }], [{ id: 'a', reviewedOn: '2026-01-01' }], { ...opts, now: vm.runInNewContext('new Date(0)') as Date })).not.toThrow()
    expect(() => auditReviewStamps([{ id: 'a' }], [{ id: 'a' }], { ...opts, now: { getTime: () => 0 } as unknown as Date })).toThrow(/now/)
  })

  it('a Proxy with reordered keys gives the same audit as a plain record', () => {
    const rev = (o: object): object => new Proxy(o, { ownKeys: (t) => Reflect.ownKeys(t).reverse() })
    const before = [{ id: 'a', value: 1, source: 's', reviewedOn: '2026-01-01' }]
    const afterPlain = [{ id: 'a', value: 1, source: 's', reviewedOn: '2026-02-01' }]
    expect(auditReviewStamps(before, [rev(afterPlain[0] as object)], opts)).toEqual(auditReviewStamps(before, afterPlain, opts))
  })

  it('a thousand-level nested value in a non-stamp field makes the record invalid, not a crash', () => {
    let deep: unknown = 1
    for (let i = 0; i < 100_000; i += 1) deep = { d: deep }
    const r = auditReviewStamps([{ id: 'a', reviewedOn: '2026-01-01' }], [{ id: 'a', reviewedOn: '2026-02-01', deep }], opts)
    expect(r.invalid).toMatchObject([{ reason: 'too-deep' }])
    expect(r.stampOnly).toEqual([])
    expect(r.ok).toBe(false)
  })
})

describe('findHandTypedConstants with hostile values', () => {
  it('survives huge text made of number-like runs', () => {
    const reg = [{ id: 'a', value: 1.25 }]
    for (const unit of ['1', '1.', '1.1', '.1', '1,', ',1', '1e', '1e+', '-', '1_', '0', '1,111', '1.1.']) {
      const text = unit.repeat(Math.ceil(300_000 / unit.length))
      expect(() => findHandTypedConstants(text, reg)).not.toThrow()
    }
  })

  it('a registry whose getters throw is a documented error, not a crash', () => {
    const entry = { id: 'a', get value(): number { throw new Error('x') } }
    expect(() => findHandTypedConstants('1', [entry])).toThrowError(expect.objectContaining({ code: 'bad-registry' }) as Error)
  })

  it('a string-object text is refused', () => {
    expect(() => findHandTypedConstants(Object('1.25') as unknown as string, [])).toThrowError(expect.objectContaining({ code: 'bad-input' }) as Error)
  })
})
