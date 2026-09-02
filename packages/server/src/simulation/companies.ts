import { COMPANY_UPGRADE_TUNING, computeCompanyHourlyRates, type CompanyIndustryDef, type MarketResourceType } from "@dominion/shared";
import type { CompanySnapshot } from "./types.js";

export interface CompanyTickResult {
  // Positive = produced (added to stock), negative = consumed (subtracted
  // from stock) — one entry per resource this recipe touches, replacing the
  // old single inputStock/goodsStock deltas.
  stockDeltas: Partial<Record<MarketResourceType, number>>;
  cash: number;
  wagesPaid: number; // lifetime expense tracking
}

/**
 * Production is bottlenecked by whichever input has the least stock
 * relative to what this tick needs — a recipe can't make 3/4 of a batch by
 * spending proportionally 3/4 of every ingredient if one ingredient is
 * fully out; it makes however many whole/fractional batches the scarcest
 * ingredient allows, and consumes exactly that same fraction of every
 * ingredient (not `min(desired, stock)` per input independently, which
 * would overdraw abundant ingredients while a scarce one is still
 * rationing). An industry with no inputs (a land-gated pure-extraction
 * company) always has fulfillment 1 — nothing to bottleneck on. Wages are
 * paid regardless of whether production happened (cash can go negative; no
 * forced layoffs/bankruptcy in this pass, see companyFailure.ts).
 */
export function tickCompany(
  company: CompanySnapshot,
  elapsedHours: number,
  industry: CompanyIndustryDef,
  upgradeTuning: typeof COMPANY_UPGRADE_TUNING = COMPANY_UPGRADE_TUNING,
): CompanyTickResult {
  const rates = computeCompanyHourlyRates(industry, company.workersAssigned, company.level, upgradeTuning);

  let fulfillment = 1;
  for (const input of industry.inputs) {
    const desired = (rates.inputs[input.resource] ?? 0) * elapsedHours;
    if (desired <= 0) continue;
    const available = company.stocks[input.resource] ?? 0;
    fulfillment = Math.min(fulfillment, available / desired);
  }
  fulfillment = Math.max(0, Math.min(1, fulfillment));

  const stockDeltas: Partial<Record<MarketResourceType, number>> = {};
  for (const input of industry.inputs) {
    const desired = (rates.inputs[input.resource] ?? 0) * elapsedHours;
    if (desired <= 0) continue;
    stockDeltas[input.resource] = (stockDeltas[input.resource] ?? 0) - desired * fulfillment;
  }
  for (const output of industry.outputs) {
    const desired = (rates.outputs[output.resource] ?? 0) * elapsedHours;
    if (desired <= 0) continue;
    stockDeltas[output.resource] = (stockDeltas[output.resource] ?? 0) + desired * fulfillment;
  }

  const wagesPaid = rates.wagePerHour * elapsedHours;

  return {
    stockDeltas,
    cash: company.cash - wagesPaid,
    wagesPaid,
  };
}
