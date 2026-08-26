import { BANK_TUNING } from "./gameConfig.js";

/**
 * Credit was previously a pass/fail gate at BANK_TUNING.maxLoanToCashRatio —
 * any amount under the cap cost the same flat bank rate. Real lending prices
 * risk continuously: the more of a company's credit limit a loan uses up,
 * the higher the rate. Shared by the loan-request route (which charges it)
 * and the client (which quotes it before the player commits), so the quote
 * always matches what actually gets charged.
 */
export function computeMaxLoanAmount(companyCash: number, bankTuning: typeof BANK_TUNING = BANK_TUNING): number {
  return companyCash * bankTuning.maxLoanToCashRatio;
}

/**
 * Committing to a fixed term (see LOAN_TERM_OPTIONS) gets a rate discount —
 * the bank has certainty about repayment timing instead of an open-ended
 * revolving balance. The trade-off lives in the tick engine, not here: a
 * term loan defaults immediately at maturity if any balance remains,
 * regardless of how close it is to BANK_TUNING.defaultMultiplier.
 */
export function computeLoanRate(
  baseRatePerHour: number,
  requestedAmount: number,
  companyCash: number,
  termDiscount = 0,
  bankTuning: typeof BANK_TUNING = BANK_TUNING,
): number {
  const maxLoan = computeMaxLoanAmount(companyCash, bankTuning);
  const utilization = maxLoan > 0 ? Math.min(1, requestedAmount / maxLoan) : 1;
  const riskRate = baseRatePerHour * (1 + utilization * bankTuning.maxRiskPremium);
  return riskRate * (1 - termDiscount);
}

export interface LoanTermOption {
  hours: number;
  label: string;
  rateDiscount: number; // fraction subtracted from the risk-priced rate
}

// Longer commitment buys a deeper discount, but a term loan's maturity is a
// hard deadline (see engine.ts) rather than the soft, ratio-based default a
// revolving loan gets — more certainty for the bank, less flexibility for
// the borrower.
export const LOAN_TERM_OPTIONS: LoanTermOption[] = [
  { hours: 72, label: "3-day term", rateDiscount: 0.1 },
  { hours: 168, label: "7-day term", rateDiscount: 0.2 },
  { hours: 720, label: "30-day term", rateDiscount: 0.35 },
];
