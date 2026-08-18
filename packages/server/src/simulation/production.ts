import { computeHourlyProduction } from "@dominion/shared";
import type { SettlementSnapshot, TickResourceDelta } from "./types.js";

export function computeProduction(
  settlement: SettlementSnapshot,
  elapsedHours: number,
): TickResourceDelta {
  const hourly = computeHourlyProduction(settlement.buildings, settlement.techIds);
  return {
    food: hourly.food * elapsedHours,
    wood: hourly.wood * elapsedHours,
    stone: hourly.stone * elapsedHours,
    gold: hourly.gold * elapsedHours,
  };
}
