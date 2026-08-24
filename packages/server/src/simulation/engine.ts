import {
  BASE_PRICES,
  COMPANY_INDUSTRIES,
  MAX_CATCHUP_HOURS,
  REFERENCE_TICK_HOURS,
  WORLD_DEMAND_TUNING,
  computeTargetSharePrice,
  computeUnemployment,
  computeWelfareCostPerHour,
  type BuildingTypeId,
  type CompanyIndustryId,
} from "@dominion/shared";
import { prisma } from "../db.js";
import { accrueDepositInterest, accrueLoanInterest, isLoanDefaulted, maybeBorrow, maybeRepayLoan } from "./banks.js";
import { tickCompany } from "./companies.js";
import { autoCloseCompany, shouldAutoClose, shouldForceLayoff } from "./companyFailure.js";
import { settleContract } from "./contracts.js";
import { computeConsumption, reconcileWorkersWithPopulation } from "./consumption.js";
import { maybeRollEvent } from "./events.js";
import { ensureMarketSeeded, TRADEABLE_RESOURCES, tickMarket, type TradeableResource } from "./market.js";
import { maybeExpand, settleNpcSurplus, type MutableResources } from "./npcEconomy.js";
import { maybeHire, maybeUpgradeCompany, settleNpcCompanyTrading, type MutableCompanyState } from "./npcCompanyEconomy.js";
import { runNpcInvestorTick, type PublicCompanyForInvesting } from "./npcInvestors.js";
import { computeProduction } from "./production.js";
import { driftSharePrice, maybeDividend } from "./stocks.js";
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
  const companies = await prisma.company.findMany({ where: { closedAt: null } });
  return companies.map((c) => ({
    id: c.id,
    name: c.name,
    ownerId: c.ownerId,
    industry: c.industry as CompanyIndustryId,
    cash: c.cash,
    inputStock: c.inputStock,
    goodsStock: c.goodsStock,
    workersAssigned: c.workersAssigned,
    level: c.level,
    isPublic: c.isPublic,
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

  // A company's jobs belong to whoever founded it, not wherever majority
  // control currently sits via Acquisitions — used below to compute each
  // player settlement's employment for welfare spending.
  const companyWorkersByOwner = new Map<string, number>();
  for (const company of companies) {
    if (!company.ownerId) continue;
    companyWorkersByOwner.set(
      company.ownerId,
      (companyWorkersByOwner.get(company.ownerId) ?? 0) + company.workersAssigned,
    );
  }

  const marketRows = await prisma.marketResource.findMany();
  const prices = Object.fromEntries(
    TRADEABLE_RESOURCES.map((r) => [r, marketRows.find((m) => m.resourceType === r)?.price ?? BASE_PRICES[r]]),
  ) as Record<TradeableResource, number>;

  const flows = Object.fromEntries(
    TRADEABLE_RESOURCES.map((r) => [r, { supply: 0, demand: 0 }]),
  ) as Record<TradeableResource, { supply: number; demand: number }>;

  const now = new Date();

  // How much real time this call represents for the shared market/stock
  // pricing — normally ~1 minute (the scheduler's cadence), but can be much
  // larger for a cheat-forced catch-up. tickMarket/driftSharePrice scale
  // their price steps by this so a big jump actually reaches the target.
  const worldState = await prisma.worldState.findUnique({ where: { id: 1 } });
  const worldElapsedHours = Math.max(
    0,
    Math.min(
      MAX_CATCHUP_HOURS,
      worldState ? (now.getTime() - worldState.lastTickAt.getTime()) / (1000 * 60 * 60) : REFERENCE_TICK_HOURS,
    ),
  );

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

    const workerAdjustments = reconcileWorkersWithPopulation(settlement, consumption.newPopulationCount);
    for (const adjustment of workerAdjustments) {
      await prisma.building.update({
        where: { id: adjustment.buildingId },
        data: { workersAssigned: adjustment.workersAssigned },
      });
    }

    if (settlement.playerId) {
      const buildingWorkers = settlement.buildings.reduce((sum, b) => sum + b.workersAssigned, 0);
      const companyWorkers = companyWorkersByOwner.get(settlement.playerId) ?? 0;
      const unemployed = computeUnemployment(consumption.newPopulationCount, buildingWorkers + companyWorkers);

      if (unemployed > 0) {
        const government = await prisma.government.findUnique({ where: { playerId: settlement.playerId } });
        if (government) {
          const welfareCost =
            computeWelfareCostPerHour(unemployed, government.welfareRatePerUnemployedPerHour) * elapsedHours;
          await prisma.government.update({
            where: { id: government.id },
            data: { treasury: { decrement: welfareCost } },
          });
        }
      }
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

    if (industry.inputResource) {
      flows[industry.inputResource].demand += result.inputConsumed;
    }
    flows[industry.outputResource].supply += result.goodsProduced;

    const state: MutableCompanyState = {
      cash: result.cash,
      inputStock: result.inputStock,
      goodsStock: result.goodsStock,
    };

    let revenue = 0;
    if (!company.ownerId) {
      revenue = await settleNpcCompanyTrading(company, state, prices);
      await maybeHire(company, state);
      await maybeUpgradeCompany(company, state);
      await maybeRepayLoan(company.id, state);
      await maybeBorrow(company.id, state);
    }

    if (shouldAutoClose(industry, state.cash, company.isPublic)) {
      await autoCloseCompany(company.id);
      continue;
    }

    const workersAssigned = shouldForceLayoff(state.cash, company.workersAssigned)
      ? company.workersAssigned - 1
      : company.workersAssigned;

    await prisma.company.update({
      where: { id: company.id },
      data: {
        cash: state.cash,
        inputStock: state.inputStock,
        goodsStock: state.goodsStock,
        workersAssigned,
        lastTickAt: now,
        totalExpenses: { increment: result.wagesPaid },
        totalRevenue: { increment: revenue },
      },
    });
  }

  // Loans: accrue compounding interest and check for default. Loans move
  // cash directly between a company and a bank — they don't touch the
  // commodity `flows` accumulator above.
  const activeLoans = await prisma.loan.findMany({ where: { defaultedAt: null } });
  for (const loan of activeLoans) {
    const rawElapsedHours = (now.getTime() - loan.lastAccrualAt.getTime()) / (1000 * 60 * 60);
    const elapsedHours = Math.max(0, Math.min(MAX_CATCHUP_HOURS, rawElapsedHours));
    if (elapsedHours <= 0) continue;

    const newBalance = accrueLoanInterest(loan, elapsedHours);
    // A term loan's deadline is a hard cutoff, independent of the revolving
    // ratio-based check — the discount it got at creation (see banks.ts) was
    // priced on the certainty of repayment by this date, not on balance growth.
    const pastMaturity = loan.maturityAt !== null && now >= loan.maturityAt && newBalance > 0;
    const defaulted = pastMaturity || isLoanDefaulted({ ...loan, outstandingBalance: newBalance });

    await prisma.loan.update({
      where: { id: loan.id },
      data: { outstandingBalance: newBalance, lastAccrualAt: now, defaultedAt: defaulted ? now : undefined },
    });
  }

  // Deposits: accrue compounding interest, same idiom as loans. A pure
  // ledger figure — doesn't touch bank.cash (see accrueDepositInterest).
  const activeDeposits = await prisma.deposit.findMany();
  for (const deposit of activeDeposits) {
    const rawElapsedHours = (now.getTime() - deposit.lastAccrualAt.getTime()) / (1000 * 60 * 60);
    const elapsedHours = Math.max(0, Math.min(MAX_CATCHUP_HOURS, rawElapsedHours));
    if (elapsedHours <= 0) continue;

    const newAmount = accrueDepositInterest(deposit, elapsedHours);
    await prisma.deposit.update({ where: { id: deposit.id }, data: { amount: newAmount, lastAccrualAt: now } });
  }

  // Contracts: settle standing supply agreements between companies, capped
  // by scarcity (seller's goodsStock, buyer's cash) — see settleContract.
  // Goods and gold move directly between the two companies, outside the
  // market's flows accumulator, same as how a manual trade moves cash but a
  // contract additionally moves the resource without touching market price.
  const activeContracts = await prisma.contract.findMany({
    where: { cancelledAt: null, acceptedAt: { not: null }, expiresAt: { gt: now } },
    include: { seller: true, buyer: true },
  });
  for (const contract of activeContracts) {
    const rawElapsedHours = (now.getTime() - contract.lastSettledAt.getTime()) / (1000 * 60 * 60);
    const elapsedHours = Math.max(0, Math.min(MAX_CATCHUP_HOURS, rawElapsedHours));
    if (elapsedHours <= 0) continue;

    const { transferred, grossCost } = settleContract(
      contract,
      elapsedHours,
      contract.seller.goodsStock,
      contract.buyer.cash,
    );
    if (transferred <= 0) {
      await prisma.contract.update({ where: { id: contract.id }, data: { lastSettledAt: now } });
      continue;
    }

    const sellerGovernment = contract.seller.ownerId
      ? await prisma.government.findUnique({ where: { playerId: contract.seller.ownerId } })
      : null;
    const tax = sellerGovernment ? grossCost * sellerGovernment.corporateTaxRate : 0;
    const netProceeds = grossCost - tax;

    await prisma.$transaction([
      prisma.company.update({
        where: { id: contract.sellerCompanyId },
        data: { goodsStock: { decrement: transferred }, cash: { increment: netProceeds }, totalRevenue: { increment: netProceeds } },
      }),
      prisma.company.update({
        where: { id: contract.buyerCompanyId },
        data: { inputStock: { increment: transferred }, cash: { decrement: grossCost } },
      }),
      prisma.contract.update({ where: { id: contract.id }, data: { lastSettledAt: now } }),
    ]);
  }

  // Public companies: revalue shares off this tick's fundamentals, then let
  // NPC investors react. Runs after the loop above so totalRevenue/cash
  // already reflect anything that happened this tick.
  const publicCompanies = await prisma.company.findMany({ where: { isPublic: true } });
  const investingSnapshot: PublicCompanyForInvesting[] = [];

  for (const company of publicCompanies) {
    const targetPrice = computeTargetSharePrice(company, now);
    const newPrice = driftSharePrice(company.sharePrice, targetPrice, worldElapsedHours);

    await prisma.company.update({ where: { id: company.id }, data: { sharePrice: newPrice } });
    await prisma.sharePriceHistoryPoint.create({ data: { companyId: company.id, price: newPrice } });

    investingSnapshot.push({
      id: company.id,
      name: company.name,
      ownerId: company.ownerId,
      isPublic: true,
      cash: company.cash,
      sharePrice: newPrice,
      priceDeltaThisTick: newPrice - company.sharePrice,
      sharesOutstanding: company.sharesOutstanding,
      totalRevenue: company.totalRevenue,
      totalExpenses: company.totalExpenses,
      foundedAt: company.foundedAt,
    });
  }

  await runNpcInvestorTick(investingSnapshot);

  for (const company of publicCompanies) {
    await maybeDividend(company);
  }

  await tickMarket(flows, worldElapsedHours);
  await maybeRollEvent(snapshots);

  await prisma.worldState.upsert({
    where: { id: 1 },
    update: { lastTickAt: now },
    create: { id: 1, lastTickAt: now },
  });

  return { settlementsProcessed: snapshots.length, companiesProcessed: companies.length };
}
