import { STOCK_TUNING } from "./gameConfig.js";

export interface ProfitInputs {
  totalRevenue: number;
  totalExpenses: number;
  foundedAt: Date | string;
}

/**
 * Lifetime-average hourly profit — deliberately simple (no rolling-window
 * bookkeeping needed) while still being a real fundamentals signal, not a
 * random number. Less reactive to a company's very recent performance than
 * a trailing window would be; a reasonable MVP tradeoff.
 */
export function computeProfitRatePerHour(company: ProfitInputs, now: Date = new Date()): number {
  const foundedAt = typeof company.foundedAt === "string" ? new Date(company.foundedAt) : company.foundedAt;
  const hoursSinceFounded = Math.max(0.01, (now.getTime() - foundedAt.getTime()) / (1000 * 60 * 60));
  return (company.totalRevenue - company.totalExpenses) / hoursSinceFounded;
}

export interface ValuationInputs extends ProfitInputs {
  cash: number;
  sharesOutstanding: number;
}

/** A "P/E"-like multiple of profit rate plus a book-value (cash/share) component. */
export function computeTargetSharePrice(company: ValuationInputs, now: Date = new Date()): number {
  if (company.sharesOutstanding <= 0) return 0;
  const profitRate = computeProfitRatePerHour(company, now);
  const valuation = profitRate * STOCK_TUNING.profitMultiplier + company.cash * STOCK_TUNING.bookValueWeight;
  return Math.max(STOCK_TUNING.minSharePrice, valuation / company.sharesOutstanding);
}
