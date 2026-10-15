import { describe, expect, it } from 'vitest'
import { GROWTH_LIMIT, growthRatio } from './growth.js'

// The harness in test/growth.ts must keep failing a quadratic function at GROWTH_LIMIT, and keep
// passing a linear one, however its repeat count or floor are tuned.
describe('the growth harness', { timeout: 120_000 }, () => {
  it('can tell a quadratic function from a linear one', () => {
    const quadratic = growthRatio(
      (n) => () => {
        let acc = 0
        for (let i = 0; i < n; i++) for (let j = 0; j < i / 16; j++) acc = (acc + j) | 0
        expect(acc).not.toBe(-1)
      },
      { small: 20_000, large: 80_000 },
    )
    expect(quadratic).toBeGreaterThan(GROWTH_LIMIT)
    const linear = growthRatio(
      (n) => () => {
        let acc = 0
        for (let i = 0; i < n * 40; i++) acc = (acc + i) | 0
        expect(acc).not.toBe(-1)
      },
      { small: 20_000, large: 80_000 },
    )
    expect(linear).toBeLessThan(GROWTH_LIMIT)
  })

  it('fails a cheap quadratic function that needs many repeats to measure', () => {
    // The small input costs well under a millisecond, the case that needs the repeat count.
    const quadratic = growthRatio(
      (n) => () => {
        let acc = 0
        for (let i = 0; i < n; i++) for (let j = 0; j < i / 8; j++) acc = (acc + j) | 0
        expect(acc).not.toBe(-1)
      },
      { small: 1500, large: 6000 },
    )
    expect(quadratic).toBeGreaterThan(GROWTH_LIMIT)
  })
})
