import { getConfig } from "../gameConfigStore.js";
import type { SettlementSnapshot } from "./types.js";

export interface ConsumptionResult {
  foodConsumed: number;
  newPopulationCount: number;
  newHappiness: number;
  wellFed: boolean;
}

// House (the building that used to be the only source of population
// capacity) is gone along with the rest of the legacy building economy —
// capacity is now a flat base plus a bonus per territory the settlement's
// own player owns (0 for NPC settlements, which don't own territory). Reads
// through getConfig() (not a static import) so it picks up live admin edits.
export function housingCapacity(territoriesOwned: number): number {
  const tuning = getConfig().HOUSING_TUNING;
  return tuning.base + territoriesOwned * tuning.perTerritory;
}

export function computeConsumption(
  settlement: SettlementSnapshot,
  foodAvailableAfterProduction: number,
  elapsedHours: number,
  territoriesOwned: number,
): ConsumptionResult {
  const populationTuning = getConfig().POPULATION_TUNING;
  const { count, happiness } = settlement.population;
  const foodNeeded = count * populationTuning.foodConsumptionPerCapitaPerHour * elapsedHours;
  const wellFed = foodAvailableAfterProduction >= foodNeeded;
  const capacity = housingCapacity(territoriesOwned);

  let newPopulationCount = count;
  let newHappiness = happiness;

  if (wellFed) {
    if (count < capacity) {
      const growth = count * populationTuning.growthRatePerHourWhenFed * elapsedHours;
      newPopulationCount = Math.min(capacity, count + growth);
    }
    newHappiness = Math.min(1, happiness + populationTuning.happinessRecoveryPerHour * elapsedHours);
  } else {
    const shrink = count * populationTuning.starvationShrinkPerHourWhenHungry * elapsedHours;
    newPopulationCount = Math.max(1, count - shrink);
    newHappiness = Math.max(
      0,
      happiness - populationTuning.happinessDeclinePerHourWhenHungry * elapsedHours,
    );
  }

  return {
    foodConsumed: Math.min(foodNeeded, foodAvailableAfterProduction),
    newPopulationCount,
    newHappiness,
    wellFed,
  };
}

