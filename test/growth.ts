/**
 * Shared harness for the "linear time" tests: how much more CPU does 4x the input cost?
 *
 * Linear code grows by about 4x and quadratic code by about 16x, so GROWTH_LIMIT sits between
 * them. test/growth-harness.test.ts proves this harness still fails a quadratic function at that
 * limit, so the limit cannot be loosened into a pass-everything check without that test failing.
 *
 * Why each measurement repeats the work: process.cpuUsage() counts CPU in scheduler ticks of
 * about 1 to 4 ms on a Linux runner. A single call of a small input was mostly tick rounding and
 * noise from other processes. On the GitHub Actions runner (Node 20) the single-call harness read
 * the linear "auditReviewStamps option lists" test as 11.508666922045585 against a limit of 10,
 * and the same test flaked once locally on Node 20.19.0 under load; on a quiet laptop it read 4 to
 * 9. Repeating the call until the smaller input costs at least MIN_SECONDS of CPU makes the
 * rounding error small (a few percent) and leaves the ratio itself unchanged, because both sizes
 * repeat equally.
 */
/** Growth ratios at or above this fail. Linear is about 4, quadratic about 16. */
export const GROWTH_LIMIT = 10

/**
 * costRatio results at or above this fail: a shape may cost a few times its plain equivalent, not a
 * dozen. Work that costs a dozen times its baseline reads well above it, and the kit's empty-object
 * column reads about 3 to 4 on a quiet machine (about 30 before run9:first5:F04), so the margin on
 * both sides covers a busy machine.
 */
export const COST_RATIO_LIMIT = 10

/** Wall-clock target for the repeated small run, in seconds. */
const MIN_SECONDS = 0.06
const MAX_REPEATS = 2_000
const RUNS = 5
/** Guards the division when the smaller input is almost free. */
const FLOOR_SECONDS = 0.01

/** Best-of-RUNS CPU seconds (user + system) for `repeats` calls of `fn`. */
export function cpuSeconds(fn: () => void, repeats = 1, runs = RUNS): number {
  let best = Infinity
  for (let i = 0; i < runs; i++) {
    const before = process.cpuUsage()
    for (let k = 0; k < repeats; k++) fn()
    const used = process.cpuUsage(before)
    best = Math.min(best, (used.user + used.system) / 1e6)
  }
  return best
}

/**
 * CPU time for the large input divided by CPU time for the small one. `make(n)` builds the input
 * for size n outside the timing and returns the function to measure. Both are run once first, so
 * the measurement is of warmed-up code. Pass the 4x sizes the test is about.
 */
export function growthRatio(make: (n: number) => () => void, sizes: { small: number; large: number }): number {
  const small = make(sizes.small)
  const large = make(sizes.large)
  small()
  large()
  const repeats = repeatsFor(small)
  return cpuSeconds(large, repeats) / Math.max(cpuSeconds(small, repeats), FLOOR_SECONDS)
}

/**
 * How many times `fn` must repeat to cost about MIN_SECONDS. The fastest of a few warm calls, in
 * wall-clock time: a pause from another process only ever makes a call look slower, so the minimum
 * is the honest cost and the repeat count stays stable. (Wall-clock time only sizes the repeat
 * count; every ratio is read from CPU time.)
 */
function repeatsFor(fn: () => void): number {
  let wall = Infinity
  for (let i = 0; i < 5; i++) {
    const started = performance.now()
    fn()
    wall = Math.min(wall, (performance.now() - started) / 1000)
  }
  return Math.min(MAX_REPEATS, Math.max(1, Math.ceil(MIN_SECONDS / Math.max(wall, 1e-6))))
}

/**
 * CPU time of `costly` divided by CPU time of `baseline`, both warmed up and repeated the same
 * number of times (sized on `baseline`). For "this input shape must not cost many times more than
 * its plain equivalent" tests, where growthRatio (one function, two sizes) does not apply.
 */
export function costRatio(costly: () => void, baseline: () => void): number {
  costly()
  baseline()
  const repeats = repeatsFor(baseline)
  return cpuSeconds(costly, repeats) / Math.max(cpuSeconds(baseline, repeats), FLOOR_SECONDS)
}
