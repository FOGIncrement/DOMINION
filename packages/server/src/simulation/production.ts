import { BUILDING_TYPES, computeHourlyProduction } from "@dominion/shared";
import type { SettlementSnapshot, TickResourceDelta } from "./types.js";

export function computeProduction(
  settlement: SettlementSnapshot,
  elapsedHours: number,
  buildingTypes?: typeof BUILDING_TYPES,
): TickResourceDelta {
  const hourly = computeHourlyProduction(settlement.buildings, settlement.techIds, buildingTypes);
  return {
    food: hourly.food * elapsedHours,
    wood: hourly.wood * elapsedHours,
    stone: hourly.stone * elapsedHours,
    gold: hourly.gold * elapsedHours,
  };
}
