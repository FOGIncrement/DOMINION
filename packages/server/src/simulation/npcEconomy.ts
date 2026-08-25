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

const PRODUCE_PRIORITY_WHEN_HUNGRY: Record<string, number> = { food: 0, wood: 1, stone: 2 };
const PRODUCE_PRIORITY_WHEN_FED: Record<string, number> = { food: 1, wood: 0, stone: 2 };

/**
 * Nothing else ever assigns workers to an NPC settlement's own buildings —
 * reconcileWorkersWithPopulation only ever scales assigned workers *down*
 * when population shrinks below what's assigned (starvation). Without an
 * upward counterpart, a settlement that ever dips to zero assigned workers
 * (a bad early tick, a starvation spiral) stays there forever: zero workers
 * means zero food production, which means it's never well-fed, which means
 * population can never grow past the starvation floor to justify reassigning
 * anyone. This is what actually breaks that deadlock, called once per NPC
 * settlement per tick after the down-scale reconciliation has been applied.
 * `currentAssignments` is mutated in place so the caller's view of who's
 * working stays accurate for anything reading it later in the same tick.
 */
export async function maybeAssignIdleWorkers(
  settlement: SettlementSnapshot,
  currentAssignments: Map<string, number>,
  newPopulationCount: number,
  wellFed: boolean,
): Promise<void> {
  const totalAssigned = [...currentAssignments.values()].reduce((sum, n) => sum + n, 0);
  let idle = Math.floor(newPopulationCount) - totalAssigned;
  if (idle <= 0) return;

  const producing = settlement.buildings.filter((b) => BUILDING_TYPES[b.type].producesResource);
  if (producing.length === 0) return;

  const priority = wellFed ? PRODUCE_PRIORITY_WHEN_FED : PRODUCE_PRIORITY_WHEN_HUNGRY;
  const ordered = [...producing].sort(
    (a, b) =>
      (priority[BUILDING_TYPES[a.type].producesResource!] ?? 3) -
      (priority[BUILDING_TYPES[b.type].producesResource!] ?? 3),
  );

  for (const building of ordered) {
    if (idle <= 0) break;
    const maxWorkers = BUILDING_TYPES[building.type].maxWorkers;
    const current = currentAssignments.get(building.id) ?? building.workersAssigned;
    const room = maxWorkers - current;
    if (room <= 0) continue;

    const toAssign = Math.min(room, idle);
    idle -= toAssign;
    currentAssignments.set(building.id, current + toAssign);
    await prisma.building.update({
      where: { id: building.id },
      data: { workersAssigned: current + toAssign },
    });
  }
}
