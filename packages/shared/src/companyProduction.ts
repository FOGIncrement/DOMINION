import { COMPANY_UPGRADE_TUNING } from "./gameConfig.js";
import type { CompanyIndustryDef } from "./types.js";

export interface CompanyHourlyRates {
  inputPerHour: number;
  goodsPerHour: number;
  wagePerHour: number;
}

/**
 * Hourly rates for a company at its current headcount and level, before
 * elapsed time or input-stock scarcity are applied. Shared by the server
 * tick (which applies both) and the client (which shows the rate directly),
 * same reasoning as computeHourlyProduction for settlement buildings. Level
 * raises input/output efficiency; wages scale with headcount only.
 */
export function computeCompanyHourlyRates(
  industry: CompanyIndustryDef,
  workersAssigned: number,
  level: number,
  upgradeTuning: typeof COMPANY_UPGRADE_TUNING = COMPANY_UPGRADE_TUNING,
): CompanyHourlyRates {
  const outputMultiplier = 1 + (level - 1) * upgradeTuning.outputBonusPerLevel;
  return {
    inputPerHour: industry.inputPerWorkerPerHour * workersAssigned * outputMultiplier,
    goodsPerHour: industry.goodsPerWorkerPerHour * workersAssigned * outputMultiplier,
    wagePerHour: industry.wagePerWorkerPerHour * workersAssigned,
  };
}

/** A company's worker cap grows with its level, mirroring the founding maxWorkers as the level-1 baseline. */
export function computeCompanyMaxWorkers(
  industry: CompanyIndustryDef,
  level: number,
  upgradeTuning: typeof COMPANY_UPGRADE_TUNING = COMPANY_UPGRADE_TUNING,
): number {
  return industry.maxWorkers + (level - 1) * upgradeTuning.extraWorkersPerLevel;
}

/** Gold cost to go from `level` to `level + 1`, or null once maxLevel is reached. */
export function computeCompanyUpgradeCost(
  industry: CompanyIndustryDef,
  level: number,
  upgradeTuning: typeof COMPANY_UPGRADE_TUNING = COMPANY_UPGRADE_TUNING,
): number | null {
  if (level >= upgradeTuning.maxLevel) return null;
  return industry.foundingCost * upgradeTuning.costMultiplierPerLevel ** level;
}
