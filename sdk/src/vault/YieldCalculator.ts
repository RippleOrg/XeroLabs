/**
 * YieldCalculator — utility functions for computing APY, APR, and yield metrics
 * from raw strategy and vault data.
 */

/** Number of seconds in a year (used for APY calculations). */
const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

/**
 * Convert a simple APR (in basis points) to APY assuming continuous compounding.
 *
 * APY = (1 + APR/n)^n - 1, where n = compounding periods per year.
 *
 * @param aprBps     APR in basis points (e.g. 500 = 5 %)
 * @param periods    Compounding periods per year (default: 365 = daily)
 * @returns          APY as a percentage number (e.g. 5.13)
 */
export function aprToApy(aprBps: number, periods = 365): number {
  const apr = aprBps / 10_000;
  return ((1 + apr / periods) ** periods - 1) * 100;
}

/**
 * Compute the blended APY for a vault given per-strategy allocations and APYs.
 *
 * @param allocations  Array of { value: bigint (USDC), apyBps: number }
 * @returns            Blended APY in basis points
 */
export function blendedApy(
  allocations: Array<{ value: bigint; apyBps: number }>
): number {
  const total = allocations.reduce((acc, a) => acc + a.value, 0n);
  if (total === 0n) return 0;

  let weightedSum = 0n;
  for (const { value, apyBps } of allocations) {
    weightedSum += value * BigInt(Math.round(apyBps));
  }

  return Number(weightedSum / total);
}

/**
 * Estimate how much yield will have accrued between two timestamps.
 *
 * @param principal    Principal in the smallest token unit
 * @param apyBps       APY in basis points
 * @param fromTs       Start timestamp (Unix seconds)
 * @param toTs         End timestamp (Unix seconds, default: now)
 * @returns            Estimated yield in the same unit as principal
 */
export function estimateYield(
  principal: bigint,
  apyBps: number,
  fromTs: number,
  toTs: number = Math.floor(Date.now() / 1000)
): bigint {
  const elapsed = Math.max(0, toTs - fromTs);
  return (principal * BigInt(apyBps) * BigInt(elapsed)) / BigInt(10_000 * SECONDS_PER_YEAR);
}

/**
 * Compute the annualised percentage yield from two snapshots of vault assets.
 *
 * @param assetsBefore  totalAssets at the start of the period
 * @param assetsAfter   totalAssets at the end of the period
 * @param sharesBefore  totalShares at the start (to account for new deposits)
 * @param sharesAfter   totalShares at the end
 * @param elapsedSecs   Length of the period in seconds
 * @returns             APY in basis points (integer)
 */
export function computeApy(
  assetsBefore: bigint,
  assetsAfter: bigint,
  sharesBefore: bigint,
  sharesAfter: bigint,
  elapsedSecs: number
): number {
  if (assetsBefore === 0n || sharesBefore === 0n || elapsedSecs === 0) return 0;

  // Share price change
  const priceBefore = (assetsBefore * 10n ** 18n) / sharesBefore;
  const priceAfter  = sharesAfter > 0n
    ? (assetsAfter  * 10n ** 18n) / sharesAfter
    : priceBefore;

  if (priceAfter <= priceBefore) return 0;

  const gain = Number(priceAfter - priceBefore) / Number(priceBefore);
  const annualised = gain * (SECONDS_PER_YEAR / elapsedSecs);
  return Math.round(annualised * 10_000);
}
