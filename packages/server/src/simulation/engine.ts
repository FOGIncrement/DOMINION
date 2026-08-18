import { MAX_CATCHUP_HOURS, WORLD_DEMAND_TUNING, type BuildingTypeId } from "@dominion/shared";
import { prisma } from "../db.js";
import { computeConsumption } from "./consumption.js";
import { maybeRollEvent } from "./events.js";
import { ensureMarketSeeded, tickMarket, type TradeableResource } from "./market.js";
import { maybeExpand, settleNpcSurplus, type MutableResources } from "./npcEconomy.js";
import { computeProduction } from "./production.js";
import type { SettlementSnapshot } from "./types.js";

async function loadSnapshots(): Promise<SettlementSnapshot[]> {
  const settlements = await prisma.settlement.findMany({
    include: { population: true, buildings: true, techs: true },
  });

  return settlements
    .filter((s) => s.population)
    .map((s) => ({
      id: s.id,
      name: s.name,
      playerId: s.playerId,
      archetype: (s.archetype as SettlementSnapshot["archetype"]) ?? null,
      food: s.food,
      wood: s.wood,
      stone: s.stone,
      gold: s.gold,
      storageCap: s.storageCap,
      lastTickAt: s.lastTickAt,
      population: {
        count: s.population!.count,
        growthRate: s.population!.growthRate,
        happiness: s.population!.happiness,
      },
      buildings: s.buildings.map((b) => ({
        id: b.id,
        type: b.type as BuildingTypeId,
        workersAssigned: b.workersAssigned,
        level: b.level,
      })),
      techIds: s.techs.map((t) => t.techId),
    }));
}

/**
 * One simulation step. Runs unconditionally for every settlement (player and
 * NPC alike), driven by wall-clock time elapsed since each settlement's last
 * tick. That single rate-times-elapsed-hours formula is what powers both the
 * routine minute-by-minute loop and "the server was down / player was away
 * for hours" catch-up — there's no separate offline code path.
 */
export async function runTick(): Promise<{ settlementsProcessed: number }> {
  await ensureMarketSeeded();
  const snapshots = await loadSnapshots();

  const marketRows = await prisma.marketResource.findMany();
  const prices: Record<TradeableResource, number> = {
    food: marketRows.find((m) => m.resourceType === "food")?.price ?? 2,
    wood: marketRows.find((m) => m.resourceType === "wood")?.price ?? 3,
    stone: marketRows.find((m) => m.resourceType === "stone")?.price ?? 4,
  };

  const flows: Record<TradeableResource, { supply: number; demand: number }> = {
    food: { supply: 0, demand: 0 },
    wood: { supply: 0, demand: 0 },
    stone: { supply: 0, demand: 0 },
  };

  const now = new Date();

  for (const settlement of snapshots) {
    const rawElapsedHours = (now.getTime() - settlement.lastTickAt.getTime()) / (1000 * 60 * 60);
    const elapsedHours = Math.max(0, Math.min(MAX_CATCHUP_HOURS, rawElapsedHours));
    if (elapsedHours <= 0) continue;

    const production = computeProduction(settlement, elapsedHours);

    flows.food.supply += production.food;
    flows.wood.supply += production.wood;
    flows.stone.supply += production.stone;

    const state: MutableResources = {
      food: Math.min(settlement.storageCap, settlement.food + production.food),
      wood: Math.min(settlement.storageCap, settlement.wood + production.wood),
      stone: Math.min(settlement.storageCap, settlement.stone + production.stone),
      gold: settlement.gold + production.gold,
    };

    const consumption = computeConsumption(settlement, state.food, elapsedHours);
    state.food = Math.max(0, state.food - consumption.foodConsumed);

    flows.food.demand += consumption.foodConsumed;
    flows.wood.demand +=
      settlement.population.count * WORLD_DEMAND_TUNING.woodDemandPerCapitaPerHour * elapsedHours;
    flows.stone.demand +=
      settlement.population.count * WORLD_DEMAND_TUNING.stoneDemandPerCapitaPerHour * elapsedHours;

    if (!settlement.playerId) {
      await settleNpcSurplus(state, prices);
      await maybeExpand(settlement, state);
    }

    await prisma.settlement.update({
      where: { id: settlement.id },
      data: {
        food: Math.min(settlement.storageCap, state.food),
        wood: Math.min(settlement.storageCap, state.wood),
        stone: Math.min(settlement.storageCap, state.stone),
        gold: state.gold,
        lastTickAt: now,
        population: {
          update: {
            count: consumption.newPopulationCount,
            happiness: consumption.newHappiness,
          },
        },
      },
    });
  }

  await tickMarket(flows);
  await maybeRollEvent(snapshots);

  await prisma.worldState.upsert({
    where: { id: 1 },
    update: { lastTickAt: now },
    create: { id: 1, lastTickAt: now },
  });

  return { settlementsProcessed: snapshots.length };
}
