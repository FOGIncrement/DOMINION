import { BOND_TUNING, CORPORATE_BOND_TUNING } from "./gameConfig.js";
import { computeMaxLoanAmount } from "./loans.js";

export interface BondTermOption {
  hours: number;
  label: string;
  rateBonus: number; // added to baseRatePerHour — longer lock-up, better yield
}

// The mirror image of LOAN_TERM_OPTIONS's discount: there the borrower buys
// a lower rate by committing to a term; here the lender (bondholder) is
// rewarded with a higher rate for locking capital up longer, the standard
// bond-yield-curve shape.
export const BOND_TERM_OPTIONS: BondTermOption[] = [
  { hours: 72, label: "3-day term", rateBonus: 0 },
  { hours: 168, label: "7-day term", rateBonus: 0.0004 },
  { hours: 720, label: "30-day term", rateBonus: 0.001 },
];

export function computeBondRate(termHours: number): number {
  const term = BOND_TERM_OPTIONS.find((t) => t.hours === termHours);
  return BOND_TUNING.baseRatePerHour + (term?.rateBonus ?? 0);
}

export function computeBondRedemptionValue(principal: number, interestRatePerHour: number, termHours: number): number {
  return principal * (1 + interestRatePerHour * termHours);
}

/**
 * A company is a riskier borrower than a government — it can go bankrupt
 * and close before maturity, a government never does — so a corporate bond
 * prices in a risk premium on top of the same term-length base rate a
 * government bond gets, scaled by how large the issuance is relative to the
 * company's own cash. Directly mirrors computeLoanRate's utilization-based
 * premium (same computeMaxLoanAmount "5x cash" capacity idea), just applied
 * to bond issuance instead of loan borrowing.
 */
export function computeCorporateBondRate(termHours: number, issuedAmount: number, companyCash: number): number {
  const baseRate = computeBondRate(termHours);
  const maxCapacity = computeMaxLoanAmount(companyCash);
  const utilization = maxCapacity > 0 ? Math.min(1, issuedAmount / maxCapacity) : 1;
  return baseRate * (1 + utilization * CORPORATE_BOND_TUNING.maxRiskPremium);
}
