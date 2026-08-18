import { BASE_HOUSING_CAPACITY, BUILDING_TYPES, POPULATION_TUNING } from "@dominion/shared";
import type { SettlementSnapshot } from "./types.js";

export interface ConsumptionResult {
  foodConsumed: number;
  newPopulationCount: number;
  newHappiness: number;
  wellFed: boolean;
}

export function housingCapacity(settlement: SettlementSnapshot): number {
  let capacity = BASE_HOUSING_CAPACITY;
  for (const building of settlement.buildings) {
    const def = BUILDING_TYPES[building.type];
    if (def.populationCapacity) {
      capacity += def.populationCapacity * building.level;
    }
  }
  return capacity;
}

export function computeConsumption(
  settlement: SettlementSnapshot,
  foodAvailableAfterProduction: number,
  elapsedHours: number,
): ConsumptionResult {
  const { count, happiness } = settlement.population;
  const foodNeeded = count * POPULATION_TUNING.foodConsumptionPerCapitaPerHour * elapsedHours;
  const wellFed = foodAvailableAfterProduction >= foodNeeded;
  const capacity = housingCapacity(settlement);

  let newPopulationCount = count;
  let newHappiness = happiness;

  if (wellFed) {
    if (count < capacity) {
      const growth = count * POPULATION_TUNING.growthRatePerHourWhenFed * elapsedHours;
      newPopulationCount = Math.min(capacity, count + growth);
    }
    newHappiness = Math.min(1, happiness + POPULATION_TUNING.happinessRecoveryPerHour * elapsedHours);
  } else {
    const shrink = count * POPULATION_TUNING.starvationShrinkPerHourWhenHungry * elapsedHours;
    newPopulationCount = Math.max(1, count - shrink);
    newHappiness = Math.max(
      0,
      happiness - POPULATION_TUNING.happinessDeclinePerHourWhenHungry * elapsedHours,
    );
  }

  return {
    foodConsumed: Math.min(foodNeeded, foodAvailableAfterProduction),
    newPopulationCount,
    newHappiness,
    wellFed,
  };
}
