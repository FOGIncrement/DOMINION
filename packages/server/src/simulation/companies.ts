import { COMPANY_INDUSTRIES, computeCompanyHourlyRates } from "@dominion/shared";
import type { CompanySnapshot } from "./types.js";

export interface CompanyTickResult {
  inputStock: number;
  goodsStock: number;
  cash: number;
  inputConsumed: number; // feeds the input resource's demand flow
  goodsProduced: number; // feeds the goods supply flow
  wagesPaid: number; // lifetime expense tracking
}

/**
 * Production is capped by available inputStock — a company that runs out of
 * raw material just produces less that tick, a real scarcity constraint
 * rather than an unbounded number. Wages are paid regardless of whether
 * production happened (cash can go negative; no forced layoffs/bankruptcy
 * in this pass, see Stage 2 plan).
 */
export function tickCompany(company: CompanySnapshot, elapsedHours: number): CompanyTickResult {
  const industry = COMPANY_INDUSTRIES[company.industry];
  const rates = computeCompanyHourlyRates(industry, company.workersAssigned, company.level);

  // An extraction industry (no inputResource at all) is never stock-gated —
  // it produces straight from labor. Only a processing industry that's
  // temporarily out of input stock falls back to the "no input available"
  // case below.
  const desiredInput = rates.inputPerHour * elapsedHours;
  const actualInput = industry.inputResource ? Math.min(desiredInput, company.inputStock) : 0;
  const fulfillment = !industry.inputResource ? 1 : desiredInput > 0 ? actualInput / desiredInput : 0;

  // contractOnly (Construction) produces nothing at all, regardless of
  // whatever goodsPerWorkerPerHour happens to be set to — its revenue is
  // one-off government zone commissions, not market goods.
  const goodsProduced = industry.contractOnly ? 0 : rates.goodsPerHour * elapsedHours * fulfillment;
  const wagesPaid = rates.wagePerHour * elapsedHours;

  return {
    inputStock: company.inputStock - actualInput,
    goodsStock: company.goodsStock + goodsProduced,
    cash: company.cash - wagesPaid,
    inputConsumed: actualInput,
    goodsProduced,
    wagesPaid,
  };
}
