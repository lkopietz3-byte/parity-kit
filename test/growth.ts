import { expect } from 'vitest'

/**
 * Shared harness for the "linear time" tests: how much more CPU does 8x the input cost?
 *
 * Linear code grows by about 8x, n log n code by about 9 to 10x and quadratic code by about 64x,
 * so GROWTH_LIMIT sits between the last two with room on both sides. test/growth-harness.test.ts
 * proves this harness still fails a quadratic function (at 40x or more, twice the limit) and
 * passes a linear one, so the limit cannot be loosened into a pass-everything check without that
 * test failing.
 *
 * How a ratio is measured (every part exists because a run on a GitHub runner failed without it):
 *  - CPU time, not wall time (process.cpuUsage), so a pause from another process does not count.
 *  - Each sample repeats the call until the small input costs at least MIN_SECONDS (60 ms) of CPU.
 *    process.cpuUsage() counts in scheduler ticks of about 1 to 4 ms on a Linux runner, so a single
 *    cheap call was mostly rounding. At 60 ms the rounding is a few percent.
 *  - The two sizes are measured interleaved: small, big, small, big, and so on for 9 rounds (5 when
 *    a single call is already long enough to make 9 rounds cost over a few seconds of CPU).
 *    Both sizes then see the same machine noise (a noisy neighbor, a clock change, a GC burst). The
 *    old design measured all of one size and then all of the other, so a quiet stretch for one and
 *    a busy stretch for the other moved the ratio.
 *  - The best (lowest) per-call CPU time for each size is kept. Noise only ever adds time, so the
 *    minimum is the honest cost, and with interleaving each size gets 5 to 9 chances at a quiet
 *    slot.
 *  - The step is 8x, not 4x. A 4x step puts linear at 4 and quadratic at 16, so a limit of 10 left
 *    a margin of only 2.5x over linear, and a few percent of noise on the small sample was enough
 *    to cross it. At 8x the limit is 20: linear sits at about 8, n log n at 9 to 10, quadratic at
 *    64. Noise must now more than double a linear ratio to fail it.
 *
 * CI readings that failed against the old limit of 10 (the 4x harness):
 *  - 11.508666922045585 on the linear "auditReviewStamps option lists" test (GitHub runner, Node
 *    20, 2026-10-15; the same test also flaked once on Node 20.19.0 locally under load; quiet
 *    laptop: 4 to 9).
 *  - 10.09 and 10.36 on Node 24 (GitHub runner, 2026-10-22), growth ratios of linear tests over a
 *    4x step, so the whole margin was noise.
 *  - 10.33 on Node 24 (GitHub runner, 2026-10-22) from the empty-object cost-ratio test, which is
 *    not a growth test: see COST_RATIO_LIMIT.
 * Those are the reasons for the interleaving, the best-of-rounds minimum and the 8x step, and for
 * the new COST_RATIO_LIMIT.
 */
/** Each size step is this many times the small size. Linear is about 8, quadratic about 64. */
export const GROWTH_STEP = 8

/** Growth ratios at or above this fail. Linear is about 8, n log n 9 to 10, quadratic about 64. */
export const GROWTH_LIMIT = 20

/**
 * costRatio results at or above this fail: a shape may cost several times its plain equivalent, not
 * dozens. It is the empty-object column test (run9:first5:F04) that uses it. Measured on the shipped
 * code with a hand-rolled loop, so no harness is involved: Node 26 reads about 5, Node 20 about 10 and
 * Node 24 about 11 to 13 (GitHub runner, Node 24, 2026-10-22: 10.33, which failed the old limit of
 * 10). The remaining cost is the two thrown TypeErrors per empty object (WeakRef and
 * FinalizationRegistry have no slot check), and a throw costs more on Node 20 and 24 than on 26.
 * Before the fix every empty object paid about fifteen throws and the column read about 30 on Node
 * 26 (and more on 20 and 24), so a limit of 20 still fails that regression on every version while
 * passing the shipped code with room on every version.
 */
export const COST_RATIO_LIMIT = 20

/** CPU target for one sample of the small input, in seconds. */
export const MIN_SECONDS = 0.06
/** Calibration aims a little above MIN_SECONDS so a faster-than-calibration sample still clears it. */
const TARGET_SECONDS = MIN_SECONDS * 1.5
const MAX_REPEATS = 5_000_000
/**
 * Interleaved rounds. One round is one small sample then one big sample. Cheap functions get ROUNDS;
 * when one round is already long (a single call of a large input), fewer rounds keep the CPU spent
 * under ROUND_BUDGET_SECONDS, but never fewer than MIN_ROUNDS.
 */
const ROUNDS = 9
const MIN_ROUNDS = 5
const ROUND_BUDGET_SECONDS = 8
/** Guards the division when the smaller input is almost free. */
const FLOOR_SECONDS = 1e-7

/** CPU seconds (user + system) for `repeats` calls of `fn`. */
function sample(fn: () => void, repeats: number): number {
  const before = process.cpuUsage()
  for (let k = 0; k < repeats; k++) fn()
  const used = process.cpuUsage(before)
  return (used.user + used.system) / 1e6
}

/**
 * How many calls of `fn` cost about TARGET_SECONDS of CPU. Starts from one call and scales by what
 * a sample actually cost, so it reads CPU time (the unit the ratio uses) and never a wall clock.
 * A sample that reads zero ticks doubles the count instead of dividing by zero.
 */
function repeatsFor(fn: () => void): { repeats: number; spent: number } {
  let repeats = 1
  let spent = 0
  for (let attempt = 0; attempt < 40; attempt++) {
    spent = sample(fn, repeats)
    if (spent >= TARGET_SECONDS || repeats >= MAX_REPEATS) break
    const scale = spent > 0.002 ? Math.min(32, (TARGET_SECONDS / spent) * 1.1) : 8
    repeats = Math.min(MAX_REPEATS, Math.max(repeats + 1, Math.ceil(repeats * scale)))
  }
  return { repeats, spent }
}

export interface Interleaved {
  /** Best per-call CPU seconds of the first function. */
  first: number
  /** Best per-call CPU seconds of the second function. */
  second: number
  /** Calls per sample of each function at the end. */
  repeats: [number, number]
  /** Passes of rounds it took to get the first function's quietest sample past MIN_SECONDS. */
  passes: number
  rounds: number
}

/** Calls `fn` until it has used about `seconds` of CPU, and at least `minCalls` times: warms up the JIT. */
function warm(fn: () => void, seconds: number, minCalls: number): void {
  let spent = 0
  for (let calls = 0; calls < minCalls || spent < seconds; calls++) {
    spent += sample(fn, 1)
    if (calls > 10_000) break
  }
}

/**
 * Measures `a` and `b` alternately (a, b, a, b, ...) and keeps the lowest per-call CPU time of each.
 * Each function repeats as many times per sample as it needs to cost about TARGET_SECONDS of CPU,
 * so `a` (the small input, or the baseline) always clears MIN_SECONDS and a costly `b` is not
 * repeated more than it needs. Per-call times are what get compared, so the repeat counts cancel.
 */
function interleaved(a: () => void, b: () => void): Interleaved {
  warm(a, 0.05, 3)
  warm(b, 0.05, 2)
  const sizedA = repeatsFor(a)
  const sizedB = repeatsFor(b)
  let repeatsA = sizedA.repeats
  let repeatsB = sizedB.repeats
  const rounds = Math.min(ROUNDS, Math.max(MIN_ROUNDS, Math.floor(ROUND_BUDGET_SECONDS / (sizedA.spent + sizedB.spent))))
  let bestA = Infinity
  let bestB = Infinity
  let passes = 0
  // The floor: if the quietest small sample of a pass still came in under MIN_SECONDS (the
  // calibration read high), repeat more and measure again rather than divide by a tick-rounded
  // number. Earlier passes are kept: their per-call minimums are as honest as the later ones.
  while (passes < 5) {
    passes++
    let quietestA = Infinity
    for (let round = 0; round < rounds; round++) {
      const spentA = sample(a, repeatsA)
      quietestA = Math.min(quietestA, spentA)
      bestA = Math.min(bestA, spentA / repeatsA)
      bestB = Math.min(bestB, sample(b, repeatsB) / repeatsB)
    }
    if (quietestA >= MIN_SECONDS || repeatsA >= MAX_REPEATS) break
    repeatsA = Math.min(MAX_REPEATS, Math.ceil(repeatsA * Math.max(1.5, (MIN_SECONDS / Math.max(quietestA, 1e-4)) * 1.2)))
    repeatsB = Math.min(MAX_REPEATS, Math.ceil(repeatsB * 1.5))
  }
  return { first: bestA, second: bestB, repeats: [repeatsA, repeatsB], passes, rounds }
}

function report(kind: string, ratio: number, m: Interleaved): void {
  if (process.env.GROWTH_LOG === undefined || process.env.GROWTH_LOG === '') return
  console.log(`GROWTH_RATIO\t${kind}\t${ratio.toFixed(2)}\trepeats ${m.repeats.join('/')} passes ${m.passes} rounds ${m.rounds}\t${expect.getState().currentTestName ?? ''}`)
}

/**
 * CPU time for the large input divided by CPU time for the small one. `make(n)` builds the input
 * for size n outside the timing and returns the function to measure. `sizes.large` must be exactly
 * GROWTH_STEP times `sizes.small`: GROWTH_LIMIT is only meaningful for that step. Both inputs are
 * run a few times first so the measurement is of warmed-up code.
 */
export function growthRatio(make: (n: number) => () => void, sizes: { small: number; large: number }): number {
  if (sizes.large !== sizes.small * GROWTH_STEP) {
    throw new Error(`growthRatio: large (${sizes.large}) must be ${GROWTH_STEP}x small (${sizes.small}); GROWTH_LIMIT is set for that step`)
  }
  const small = make(sizes.small)
  const large = make(sizes.large)
  const m = interleaved(small, large)
  const ratio = m.second / Math.max(m.first, FLOOR_SECONDS)
  report('growth', ratio, m)
  return ratio
}

/**
 * CPU time of `costly` divided by CPU time of `baseline`, both warmed up, measured interleaved and
 * best-of-rounds like growthRatio. For "this input shape must not cost many times more than its
 * plain equivalent" tests, where growthRatio (one function, two sizes) does not apply.
 */
export function costRatio(costly: () => void, baseline: () => void): number {
  const m = interleaved(baseline, costly)
  const ratio = m.second / Math.max(m.first, FLOOR_SECONDS)
  report('cost', ratio, m)
  return ratio
}
