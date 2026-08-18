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

export interface WorkerAdjustment {
  buildingId: string;
  workersAssigned: number;
}

/**
 * If population has shrunk below the total workers currently assigned
 * across all buildings (e.g. starvation), proportionally lay off workers so
 * the two stay consistent. Without this, buildings keep holding workers the
 * settlement no longer has, and the player can't even unassign them — the
 * population cap check on increasing workers blocks decreasing too since
 * the existing total already exceeds it.
 */
export function reconcileWorkersWithPopulation(
  settlement: SettlementSnapshot,
  newPopulationCount: number,
): WorkerAdjustment[] {
  const totalAssigned = settlement.buildings.reduce((sum, b) => sum + b.workersAssigned, 0);
  if (totalAssigned <= newPopulationCount) return [];

  const scale = newPopulationCount / totalAssigned;
  const adjustments: WorkerAdjustment[] = [];
  for (const building of settlement.buildings) {
    if (building.workersAssigned <= 0) continue;
    const newCount = Math.floor(building.workersAssigned * scale);
    if (newCount !== building.workersAssigned) {
      adjustments.push({ buildingId: building.id, workersAssigned: newCount });
    }
  }
  return adjustments;
}
