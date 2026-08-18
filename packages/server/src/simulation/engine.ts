import {
  BASE_PRICES,
  COMPANY_INDUSTRIES,
  MAX_CATCHUP_HOURS,
  WORLD_DEMAND_TUNING,
  type BuildingTypeId,
  type CompanyIndustryId,
} from "@dominion/shared";
import { prisma } from "../db.js";
import { tickCompany } from "./companies.js";
import { computeConsumption } from "./consumption.js";
import { maybeRollEvent } from "./events.js";
import { ensureMarketSeeded, TRADEABLE_RESOURCES, tickMarket, type TradeableResource } from "./market.js";
import { maybeExpand, settleNpcSurplus, type MutableResources } from "./npcEconomy.js";
import { maybeHire, settleNpcCompanyTrading, type MutableCompanyState } from "./npcCompanyEconomy.js";
import { computeProduction } from "./production.js";
import type { CompanySnapshot, SettlementSnapshot } from "./types.js";

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

async function loadCompanySnapshots(): Promise<CompanySnapshot[]> {
  const companies = await prisma.company.findMany();
  return companies.map((c) => ({
    id: c.id,
    name: c.name,
    ownerId: c.ownerId,
    industry: c.industry as CompanyIndustryId,
    cash: c.cash,
    inputStock: c.inputStock,
    goodsStock: c.goodsStock,
    workersAssigned: c.workersAssigned,
    lastTickAt: c.lastTickAt,
  }));
}

/**
 * One simulation step. Runs unconditionally for every settlement and company
 * (player and NPC alike), driven by wall-clock time elapsed since each
 * entity's last tick. That single rate-times-elapsed-hours formula is what
 * powers both the routine minute-by-minute loop and "the server was down /
 * player was away for hours" catch-up — there's no separate offline code
 * path. Settlements and companies share one `flows` accumulator so their
 * economies interact through the same market prices, closed out by a single
 * tickMarket call at the end.
 */
export async function runTick(): Promise<{ settlementsProcessed: number; companiesProcessed: number }> {
  await ensureMarketSeeded();
  const snapshots = await loadSnapshots();
  const companies = await loadCompanySnapshots();

  const marketRows = await prisma.marketResource.findMany();
  const prices = Object.fromEntries(
    TRADEABLE_RESOURCES.map((r) => [r, marketRows.find((m) => m.resourceType === r)?.price ?? BASE_PRICES[r]]),
  ) as Record<TradeableResource, number>;

  const flows = Object.fromEntries(
    TRADEABLE_RESOURCES.map((r) => [r, { supply: 0, demand: 0 }]),
  ) as Record<TradeableResource, { supply: number; demand: number }>;

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
    flows.goods.demand +=
      settlement.population.count * WORLD_DEMAND_TUNING.goodsDemandPerCapitaPerHour * elapsedHours;

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

  for (const company of companies) {
    const rawElapsedHours = (now.getTime() - company.lastTickAt.getTime()) / (1000 * 60 * 60);
    const elapsedHours = Math.max(0, Math.min(MAX_CATCHUP_HOURS, rawElapsedHours));
    if (elapsedHours <= 0) continue;

    const result = tickCompany(company, elapsedHours);
    const industry = COMPANY_INDUSTRIES[company.industry];

    flows[industry.inputResource].demand += result.inputConsumed;
    flows.goods.supply += result.goodsProduced;

    const state: MutableCompanyState = {
      cash: result.cash,
      inputStock: result.inputStock,
      goodsStock: result.goodsStock,
    };

    if (!company.ownerId) {
      await settleNpcCompanyTrading(company, state, prices);
      await maybeHire(company, state);
    }

    await prisma.company.update({
      where: { id: company.id },
      data: {
        cash: state.cash,
        inputStock: state.inputStock,
        goodsStock: state.goodsStock,
        lastTickAt: now,
        totalExpenses: { increment: result.wagesPaid },
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

  return { settlementsProcessed: snapshots.length, companiesProcessed: companies.length };
}
