import { COMPANY_FACILITY_TUNING, COMPANY_UPGRADE_TUNING } from "./gameConfig.js";
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

/**
 * A company's worker cap grows with its level (per-worker efficiency stat,
 * a modest cap bump) AND its facility count (how many sites apply that same
 * level) — the two compose multiplicatively: level raises the per-facility
 * baseline, facilityCount multiplies it wholesale.
 */
export function computeCompanyMaxWorkers(
  industry: CompanyIndustryDef,
  level: number,
  upgradeTuning: typeof COMPANY_UPGRADE_TUNING = COMPANY_UPGRADE_TUNING,
  facilityCount: number = 1,
): number {
  return (industry.maxWorkers + (level - 1) * upgradeTuning.extraWorkersPerLevel) * facilityCount;
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

/** Gold cost to go from `facilityCount` to `facilityCount + 1`, or null once maxFacilities is reached. */
export function computeCompanyFacilityCost(
  industry: CompanyIndustryDef,
  facilityCount: number,
  facilityTuning: typeof COMPANY_FACILITY_TUNING = COMPANY_FACILITY_TUNING,
): number | null {
  if (facilityCount >= facilityTuning.maxFacilities) return null;
  return industry.foundingCost * facilityTuning.costMultiplierPerFacility ** facilityCount;
}
