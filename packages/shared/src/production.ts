import { BUILDING_TYPES, TECHS } from "./gameConfig.js";
import type { BuildingTypeId, ResourceType, TechId } from "./types.js";

export interface ProducingBuilding {
  type: BuildingTypeId;
  workersAssigned: number;
  level: number;
}

/**
 * Hourly production rate for a settlement, before elapsed time is applied.
 * Shared by the server tick (which multiplies by elapsed hours) and the
 * client (which shows it directly as a "+X/hr" rate so players don't have
 * to sit and watch integers creep up to tell whether production is working).
 */
export function computeHourlyProduction(
  buildings: ProducingBuilding[],
  techIds: string[],
): Record<ResourceType, number> {
  const totals: Record<ResourceType, number> = { food: 0, wood: 0, stone: 0, gold: 0 };

  const techBonusByBuilding = new Map<BuildingTypeId, number>();
  for (const techId of techIds) {
    const tech = TECHS[techId as TechId];
    if (tech?.productionBonus) {
      const current = techBonusByBuilding.get(tech.productionBonus.buildingType) ?? 1;
      techBonusByBuilding.set(
        tech.productionBonus.buildingType,
        current * tech.productionBonus.multiplier,
      );
    }
  }

  for (const building of buildings) {
    const def = BUILDING_TYPES[building.type];
    if (!def.producesResource || !def.productionPerWorkerPerHour) continue;
    if (building.workersAssigned <= 0) continue;

    const bonus = techBonusByBuilding.get(building.type) ?? 1;
    totals[def.producesResource] +=
      def.productionPerWorkerPerHour * building.workersAssigned * building.level * bonus;
  }

  return totals;
}
