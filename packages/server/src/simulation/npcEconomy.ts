import { prisma } from "../db.js";
import { getConfig } from "../gameConfigStore.js";
import { applyTradeImpact, type TradeableResource } from "./market.js";
import type { SettlementSnapshot } from "./types.js";

// Exported: directSales.ts shares this same buffer target for the
// owned-Retail purchase path, so the two mechanisms top off toward one
// consistent number instead of drifting apart.
export const STOCK_BUFFER: Record<TradeableResource, number> = { food: 80, wood: 60, stone: 40 };

// Buy food once stock drops this low — well under the sell buffer (80) so
// buying and selling can never thrash against each other in the same tick.
export const FOOD_SHORTAGE_BUY_THRESHOLD = 30;

// Same idea for wood/stone, but a much smaller trigger — running out only
// stalls maybeExpand for a tick, not a starvation spiral, so there's no
// need to react as eagerly as food does.
const MATERIAL_SHORTAGE_BUY_THRESHOLD: Record<"wood" | "stone", number> = { wood: 20, stone: 15 };

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
 * A settlement short on food beyond its own production buys the shortfall
 * from the shared world market — the last-resort fallback once a player
 * settlement's owned Retail company (see maybeBuyFromOwnedRetail in
 * directSales.ts, tried first) can't fully cover the need, or has none.
 * Runs for every settlement, player and NPC alike: NPC settlements never
 * had any alternative here since they can't own a Retail company, and
 * player settlements had *no* safety net at all before this was extended to
 * them — not parity with NPCs, strictly worse, since an absent player's
 * nation could starve to zero with nothing to stop it. See
 * maybeCoverMaterialShortfall for the wood/stone counterpart.
 */
export async function maybeCoverFoodShortfall(
  state: MutableResources,
  prices: Record<TradeableResource, number>,
): Promise<void> {
  if (state.food >= FOOD_SHORTAGE_BUY_THRESHOLD || state.gold <= 0) return;

  const price = prices.food;
  const need = STOCK_BUFFER.food - state.food;
  const affordable = state.gold / price;
  const toBuy = Math.max(0, Math.min(need, affordable));
  if (toBuy > 0.01) {
    state.food += toBuy;
    state.gold -= toBuy * price;
    await applyTradeImpact("food", "buy", toBuy);
  }
}

/**
 * The wood/stone counterpart to maybeCoverFoodShortfall. Lower stakes than
 * food — running out just stalls maybeExpand for a tick, not a survival
 * crisis. Runs for every settlement (extended alongside maybeCoverFoodShortfall);
 * only NPC settlements actually act on the result today since maybeExpand
 * (the thing this unblocks) is NPC-only, but there's no reason to withhold
 * the purchase itself from a player settlement that happens to be low on
 * materials for some other reason. Called before maybeExpand each tick so a
 * purchase this tick can actually fund that same tick's expansion, not just
 * top up for next time.
 */
export async function maybeCoverMaterialShortfall(
  state: MutableResources,
  prices: Record<TradeableResource, number>,
): Promise<void> {
  if (state.gold <= 0) return;

  for (const resourceType of ["wood", "stone"] as const) {
    if (state[resourceType] >= MATERIAL_SHORTAGE_BUY_THRESHOLD[resourceType]) continue;

    const price = prices[resourceType];
    const need = STOCK_BUFFER[resourceType] - state[resourceType];
    const affordable = state.gold / price;
    const toBuy = Math.max(0, Math.min(need, affordable));
    if (toBuy > 0.01) {
      state[resourceType] += toBuy;
      state.gold -= toBuy * price;
      await applyTradeImpact(resourceType, "buy", toBuy);
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
  const config = getConfig();
  if (state.gold < config.NPC_GROWTH_TUNING.minGoldToExpand) return null;
  if (Math.random() > config.NPC_GROWTH_TUNING.expandChancePerTick) return null;

  const producing = settlement.buildings.filter((b) => config.BUILDING_TYPES[b.type].producesResource);
  if (producing.length === 0) return null;

  const choice = producing[Math.floor(Math.random() * producing.length)];
  const def = config.BUILDING_TYPES[choice.type];
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
  const buildingTypes = getConfig().BUILDING_TYPES;
  const totalAssigned = [...currentAssignments.values()].reduce((sum, n) => sum + n, 0);
  let idle = Math.floor(newPopulationCount) - totalAssigned;
  if (idle <= 0) return;

  const producing = settlement.buildings.filter((b) => buildingTypes[b.type].producesResource);
  if (producing.length === 0) return;

  const priority = wellFed ? PRODUCE_PRIORITY_WHEN_FED : PRODUCE_PRIORITY_WHEN_HUNGRY;
  const ordered = [...producing].sort(
    (a, b) =>
      (priority[buildingTypes[a.type].producesResource!] ?? 3) -
      (priority[buildingTypes[b.type].producesResource!] ?? 3),
  );

  for (const building of ordered) {
    if (idle <= 0) break;
    const maxWorkers = buildingTypes[building.type].maxWorkers;
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
