import { describe, expect, it } from 'vitest'
import { COST_RATIO_LIMIT, GROWTH_LIMIT, GROWTH_STEP, costRatio, growthRatio } from './growth.js'

// The harness in test/growth.ts must keep failing a quadratic function at GROWTH_LIMIT (by a wide
// margin, not just barely), and keep passing a linear one, however its repeat count, rounds or floor
// are tuned. A quadratic reads about 64 at the 8x step; the bar here is 40, twice the limit.
const QUADRATIC_FLOOR = 40

describe('the growth harness', { timeout: 300_000 }, () => {
  it('keeps the limit between linear (8) and quadratic (64)', () => {
    expect(GROWTH_STEP).toBe(8)
    expect(GROWTH_LIMIT).toBe(20)
    expect(GROWTH_LIMIT).toBeGreaterThan(GROWTH_STEP * 2)
    expect(GROWTH_LIMIT).toBeLessThan(GROWTH_STEP * GROWTH_STEP)
  })

  it('refuses a step other than 8x', () => {
    expect(() => growthRatio(() => () => {}, { small: 1000, large: 4000 })).toThrowError(/8x/)
  })

  it('can tell a quadratic function from a linear one', () => {
    const quadratic = growthRatio(
      (n) => () => {
        let acc = 0
        for (let i = 0; i < n; i++) for (let j = 0; j < i / 16; j++) acc = (acc + j) | 0
        expect(acc).not.toBe(-1)
      },
      { small: 8000, large: 64_000 },
    )
    expect(quadratic).toBeGreaterThan(QUADRATIC_FLOOR)
    const linear = growthRatio(
      (n) => () => {
        let acc = 0
        for (let i = 0; i < n * 40; i++) acc = (acc + i) | 0
        expect(acc).not.toBe(-1)
      },
      { small: 8000, large: 64_000 },
    )
    expect(linear).toBeLessThan(GROWTH_LIMIT)
  })

  it('fails a cheap quadratic function that needs many repeats to measure', () => {
    // The small input costs well under a millisecond, the case that needs the repeat floor.
    const quadratic = growthRatio(
      (n) => () => {
        let acc = 0
        for (let i = 0; i < n; i++) for (let j = 0; j < i / 8; j++) acc = (acc + j) | 0
        expect(acc).not.toBe(-1)
      },
      { small: 1500, large: 12_000 },
    )
    expect(quadratic).toBeGreaterThan(QUADRATIC_FLOOR)
  })

  it('passes a cheap linear function that needs many repeats to measure', () => {
    const linear = growthRatio(
      (n) => () => {
        let acc = 0
        for (let i = 0; i < n * 8; i++) acc = (acc + i) | 0
        expect(acc).not.toBe(-1)
      },
      { small: 1500, large: 12_000 },
    )
    expect(linear).toBeLessThan(GROWTH_LIMIT)
  })

  it('measures the small and big inputs in alternation, and repeats the small one past the CPU floor', () => {
    // Each call records its size. Collapsing runs of equal sizes shows the order the samples ran in.
    const calls: number[] = []
    let cheap = 0
    growthRatio(
      (n) => () => {
        calls.push(n)
        for (let i = 0; i < n * 4; i++) cheap = (cheap + i) | 0
      },
      { small: 500, large: 4000 },
    )
    expect(cheap).not.toBe(-1)
    const runs: number[] = []
    for (const n of calls) if (runs[runs.length - 1] !== n) runs.push(n)
    // After the warm-up and calibration there are at least nine small-then-big pairs, in order.
    let pairs = 0
    for (let i = 0; i + 1 < runs.length; i++) if (runs[i] === 500 && runs[i + 1] === 4000) pairs++
    expect(pairs).toBeGreaterThanOrEqual(9)
    // A 2000-step loop costs microseconds, so each small sample is thousands of calls.
    expect(calls.filter((n) => n === 500).length).toBeGreaterThan(9 * 1000)
  })

  it('costRatio fails work that costs forty times its baseline and passes work that costs about the same', () => {
    const spin = (times: number) => () => {
      let acc = 0
      for (let i = 0; i < times; i++) acc = (acc + i) | 0
      expect(acc).not.toBe(-1)
    }
    expect(costRatio(spin(40_000_000), spin(1_000_000))).toBeGreaterThan(COST_RATIO_LIMIT)
    expect(costRatio(spin(1_500_000), spin(1_000_000))).toBeLessThan(COST_RATIO_LIMIT)
  })
})
