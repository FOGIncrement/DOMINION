import { BOND_TUNING } from "./gameConfig.js";

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
