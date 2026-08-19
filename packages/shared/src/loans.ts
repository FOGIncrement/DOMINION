import { BANK_TUNING } from "./gameConfig.js";

/**
 * Credit was previously a pass/fail gate at BANK_TUNING.maxLoanToCashRatio —
 * any amount under the cap cost the same flat bank rate. Real lending prices
 * risk continuously: the more of a company's credit limit a loan uses up,
 * the higher the rate. Shared by the loan-request route (which charges it)
 * and the client (which quotes it before the player commits), so the quote
 * always matches what actually gets charged.
 */
export function computeMaxLoanAmount(companyCash: number): number {
  return companyCash * BANK_TUNING.maxLoanToCashRatio;
}

export function computeLoanRate(baseRatePerHour: number, requestedAmount: number, companyCash: number): number {
  const maxLoan = computeMaxLoanAmount(companyCash);
  const utilization = maxLoan > 0 ? Math.min(1, requestedAmount / maxLoan) : 1;
  return baseRatePerHour * (1 + utilization * BANK_TUNING.maxRiskPremium);
}
