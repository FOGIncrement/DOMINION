import { BUILDING_TYPES, NPC_GROWTH_TUNING } from "@dominion/shared";
import { prisma } from "../db.js";
import { applyTradeImpact, type TradeableResource } from "./market.js";
import type { SettlementSnapshot } from "./types.js";

const STOCK_BUFFER: Record<TradeableResource, number> = { food: 80, wood: 60, stone: 40 };

export interface MutableResources {
  food: number;
  wood: number;
  stone: number;
  gold: number;
}

/**
 * NPCs sell whatever they're holding above a working buffer back to the
 * world market for gold. This is what actually funds NPC expansion and is
 * what makes them believable counterparties for player trades.
 */
export async function settleNpcSurplus(
  state: MutableResources,
  prices: Record<TradeableResource, number>,
): Promise<void> {
  for (const resourceType of ["food", "wood", "stone"] as TradeableResource[]) {
    const buffer = STOCK_BUFFER[resourceType];
    const stock = state[resourceType];
    if (stock > buffer) {
      const excess = stock - buffer;
      state[resourceType] = buffer;
      state.gold += excess * prices[resourceType];
      await applyTradeImpact(resourceType, "sell", excess);
    }
  }
}

/**
 * Small chance per tick for a cash-rich NPC settlement to reinvest in another
 * copy of a producing building it already runs. Not full agent AI, but
 * enough for the world to visibly grow between visits.
 */
export async function maybeExpand(
  settlement: SettlementSnapshot,
  state: MutableResources,
): Promise<string | null> {
  if (state.gold < NPC_GROWTH_TUNING.minGoldToExpand) return null;
  if (Math.random() > NPC_GROWTH_TUNING.expandChancePerTick) return null;

  const producing = settlement.buildings.filter((b) => BUILDING_TYPES[b.type].producesResource);
  if (producing.length === 0) return null;

  const choice = producing[Math.floor(Math.random() * producing.length)];
  const def = BUILDING_TYPES[choice.type];
  const costWood = def.cost.wood ?? 0;
  const costStone = def.cost.stone ?? 0;
  if (state.wood < costWood || state.stone < costStone) return null;

  state.wood -= costWood;
  state.stone -= costStone;

  await prisma.building.create({
    data: {
      settlementId: settlement.id,
      type: choice.type,
      workersAssigned: def.maxWorkers,
    },
  });

  return choice.type;
}
