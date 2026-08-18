import type { CompanyIndustryDef } from "./types.js";

export interface CompanyHourlyRates {
  inputPerHour: number;
  goodsPerHour: number;
  wagePerHour: number;
}

/**
 * Hourly rates for a company at its current headcount, before elapsed time
 * or input-stock scarcity are applied. Shared by the server tick (which
 * applies both) and the client (which shows the rate directly), same
 * reasoning as computeHourlyProduction for settlement buildings.
 */
export function computeCompanyHourlyRates(
  industry: CompanyIndustryDef,
  workersAssigned: number,
): CompanyHourlyRates {
  return {
    inputPerHour: industry.inputPerWorkerPerHour * workersAssigned,
    goodsPerHour: industry.goodsPerWorkerPerHour * workersAssigned,
    wagePerHour: industry.wagePerWorkerPerHour * workersAssigned,
  };
}
