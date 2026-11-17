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
 * Up to this many full measurements per call. Noise only ever adds CPU time to the large input (or
 * removes none from the small one), so one honest low reading is evidence of linear growth; a
 * quadratic function reads about 16 on every attempt. A passing reading stops the loop, so a quiet
 * machine pays for one measurement.
 */
const ATTEMPTS = 3

/**
 * CPU time for the large input divided by CPU time for the small one: the lowest of up to ATTEMPTS
 * measurements, stopping at the first one under GROWTH_LIMIT. `make(n)` builds the input for size n
 * outside the timing and returns the function to measure. Both are run once first, so the
 * measurement is of warmed-up code. Pass the 4x sizes the test is about.
 */
export function growthRatio(make: (n: number) => () => void, sizes: { small: number; large: number }): number {
  const small = make(sizes.small)
  const large = make(sizes.large)
  let best = Infinity
  for (let attempt = 0; attempt < ATTEMPTS && best >= GROWTH_LIMIT; attempt++) best = Math.min(best, measureOnce(small, large))
  return best
}

function measureOnce(small: () => void, large: () => void): number {
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
