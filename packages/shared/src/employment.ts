/**
 * Employment is computed, not stored — same philosophy as control in the
 * Acquisitions work. Shared by the tick engine (which deducts welfare) and
 * the government route (which displays it), so the number a player sees is
 * calculated exactly the same way as what actually gets charged.
 */
export function computeUnemployment(populationCount: number, employedCount: number): number {
  return Math.max(0, populationCount - employedCount);
}

export function computeWelfareCostPerHour(
  unemployedCount: number,
  welfareRatePerUnemployedPerHour: number,
): number {
  return unemployedCount * welfareRatePerUnemployedPerHour;
}
