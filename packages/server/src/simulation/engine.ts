import {
  CELLS_PER_ZONE_SLOT,
  MAX_CATCHUP_HOURS,
  REFERENCE_TICK_HOURS,
  ZONE_TYPES,
  computeBondRedemptionValue,
  computeCompanyMaxWorkers,
  computeTargetSharePrice,
  computeUnemployment,
  computeWelfareCostPerHour,
  type CompanyIndustryId,
  type MarketResourceType,
  type ZoneTypeId,
} from "@dominion/shared";
import { prisma } from "../db.js";
import { getConfig } from "../gameConfigStore.js";
import { accrueDepositInterest, accrueLoanInterest, isLoanDefaulted, maybeBorrow, maybeRepayLoan } from "./banks.js";
import { tickCompany } from "./companies.js";
import { autoCloseCompany, shouldAutoClose, shouldForceLayoff } from "./companyFailure.js";
import { settleContract } from "./contracts.js";
import { getControllingPlayerId } from "./control.js";
import { computeConsumption } from "./consumption.js";
import { applyLuxuryGoodsPurchase, maybeBuyFromOwnedRetail } from "./directSales.js";
import { maybeRollEvent } from "./events.js";
import { ensureMarketSeeded, TRADEABLE_RESOURCES, tickMarket, type TradeableResource } from "./market.js";
import { maybeCoverFoodShortfall, type MutableResources } from "./npcEconomy.js";
import {
  maybeExpandCompany,
  maybeFoundNpcCompany,
  maybeHire,
  maybeUpgradeCompany,
  settleNpcCompanyTrading,
  type MutableCompanyState,
} from "./npcCompanyEconomy.js";
import { runNpcInvestorTick, type PublicCompanyForInvesting } from "./npcInvestors.js";
import { driftSharePrice, maybeDividend } from "./stocks.js";
import type { CompanySnapshot, SettlementSnapshot } from "./types.js";

async function loadSnapshots(): Promise<SettlementSnapshot[]> {
  const settlements = await prisma.settlement.findMany({
    include: { population: true },
  });

  return settlements
    .filter((s) => s.population)
    .map((s) => ({
      id: s.id,
      name: s.name,
      playerId: s.playerId,
      archetype: (s.archetype as SettlementSnapshot["archetype"]) ?? null,
      food: s.food,
      gold: s.gold,
      storageCap: s.storageCap,
      lastTickAt: s.lastTickAt,
      population: {
        count: s.population!.count,
        growthRate: s.population!.growthRate,
        happiness: s.population!.happiness,
      },
    }));
}

async function loadCompanySnapshots(): Promise<CompanySnapshot[]> {
  const companies = await prisma.company.findMany({ where: { closedAt: null } });
  // One query for every company's resource stocks, grouped in memory — the
  // old inputStock/goodsStock scalars lived on Company itself; now each
  // company can hold several, in CompanyResourceStock.
  const allStocks = await prisma.companyResourceStock.findMany({
    where: { companyId: { in: companies.map((c) => c.id) } },
  });
  const stocksByCompany = new Map<string, Partial<Record<MarketResourceType, number>>>();
  for (const row of allStocks) {
    const bucket = stocksByCompany.get(row.companyId) ?? {};
    bucket[row.resourceType as MarketResourceType] = row.amount;
    stocksByCompany.set(row.companyId, bucket);
  }

  return companies.map((c) => ({
    id: c.id,
    name: c.name,
    ownerId: c.ownerId,
    industry: c.industry as CompanyIndustryId,
    cash: c.cash,
    stocks: stocksByCompany.get(c.id) ?? {},
    workersAssigned: c.workersAssigned,
    autoStaff: c.autoStaff,
    level: c.level,
    facilityCount: c.facilityCount,
    isPublic: c.isPublic,
    sharesOutstanding: c.sharesOutstanding,
    lastTickAt: c.lastTickAt,
    territorySeedIndex: c.territorySeedIndex,
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

  // Same "founder, not current controller" idiom as companyWorkersByOwner
  // just above — a settlement's Retail/Bakery direct purchases (below) go
  // to whichever of that industry its own player founded, looked up once
  // here instead of a query per settlement.
  const ownedCompaniesByOwnerAndIndustry = new Map<string, CompanySnapshot[]>();
  for (const company of companies) {
    if (!company.ownerId) continue;
    const key = `${company.ownerId}:${company.industry}`;
    const list = ownedCompaniesByOwnerAndIndustry.get(key) ?? [];
    list.push(company);
    ownedCompaniesByOwnerAndIndustry.set(key, list);
  }

  // All of an owner's companies regardless of industry — used by organic
  // hiring below, which can auto-staff any industry, not just Retail/Bakery.
  const ownedCompaniesByOwner = new Map<string, CompanySnapshot[]>();
  for (const company of companies) {
    if (!company.ownerId) continue;
    const list = ownedCompaniesByOwner.get(company.ownerId) ?? [];
    list.push(company);
    ownedCompaniesByOwner.set(company.ownerId, list);
  }

  // Revenue booked by a settlement buying directly from a company it owns
  // (directSales.ts) — folded into that company's totalRevenue when the
  // company loop persists it below, the same "accumulate now, apply at the
  // company's own update" idiom the loan/deposit ledgers further down use.
  const ownedSaleRevenueByCompanyId = new Map<string, number>();

  // House (the building that used to be the sole source of population
  // capacity) is gone — capacity now scales with territory count instead
  // (see consumption.ts's housingCapacity), batched once here rather than
  // a query per settlement.
  const territoryCounts = await prisma.territory.groupBy({ by: ["ownerId"], _count: { _all: true } });
  const territoriesByOwner = new Map(territoryCounts.map((t) => [t.ownerId, t._count._all]));

  const config = getConfig();
  const marketRows = await prisma.marketResource.findMany();
  const prices = Object.fromEntries(
    TRADEABLE_RESOURCES.map((r) => [r, marketRows.find((m) => m.resourceType === r)?.price ?? config.BASE_PRICES[r]]),
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

    // No more passive building production (see the legacy-building-economy
    // removal) — food comes entirely from the new land-gated `farm` company
    // selling into the market, reached here only via maybeCoverFoodShortfall
    // below, same as every other resource in the recipe economy.
    const state: MutableResources = {
      food: settlement.food,
      gold: settlement.gold,
    };

    if (settlement.playerId) {
      const retailCompanies = ownedCompaniesByOwnerAndIndustry.get(`${settlement.playerId}:retail`) ?? [];
      const retailSale = maybeBuyFromOwnedRetail(retailCompanies, state, prices);
      if (retailSale) {
        ownedSaleRevenueByCompanyId.set(
          retailSale.companyId,
          (ownedSaleRevenueByCompanyId.get(retailSale.companyId) ?? 0) + retailSale.revenue,
        );
      }
    }
    // Every settlement, not just NPCs — see the doc comment on
    // maybeCoverFoodShortfall in npcEconomy.ts for why.
    await maybeCoverFoodShortfall(state, prices);

    const territoriesOwned = settlement.playerId ? (territoriesByOwner.get(settlement.playerId) ?? 0) : 0;
    const consumption = computeConsumption(settlement, state.food, elapsedHours, territoriesOwned);
    state.food = Math.max(0, state.food - consumption.foodConsumed);

    flows.food.demand += consumption.foodConsumed;
    flows.goods.demand +=
      settlement.population.count * config.WORLD_DEMAND_TUNING.goodsDemandPerCapitaPerHour * elapsedHours;

    // Player settlements only: spend surplus gold on "goods" from the open
    // market for a happiness boost beyond plain food sufficiency (see
    // directSales.ts) — market-only now that Bakery produces "bread," not
    // "goods" (see the recipe-economy plan). NPC settlements deliberately
    // get no equivalent lever — this is a treasury-spending decision.
    let finalHappiness = consumption.newHappiness;
    if (settlement.playerId) {
      const luxury = await applyLuxuryGoodsPurchase(settlement, state, prices, elapsedHours);
      finalHappiness = Math.min(1, finalHappiness + luxury.happinessBoost);
    }

    if (settlement.playerId) {
      // Organic hiring: idle population fills the open slots of any company
      // this player opted into auto-staffing (Company.autoStaff). Mutates
      // the CompanySnapshot objects in place rather than writing to the DB
      // directly — the company tick loop later in this same runTick()
      // persists workersAssigned unconditionally from these same snapshot
      // references every tick, so a direct write here would just get
      // clobbered back to its pre-hire value (same constraint directSales.ts
      // already works around for retail/luxury purchases).
      const ownedCompanies = ownedCompaniesByOwner.get(settlement.playerId) ?? [];
      let idleForHiring = Math.max(
        0,
        consumption.newPopulationCount - (companyWorkersByOwner.get(settlement.playerId) ?? 0),
      );
      if (idleForHiring > 0) {
        for (const company of ownedCompanies) {
          if (idleForHiring <= 0) break;
          if (!company.autoStaff) continue;
          const industry = config.COMPANY_INDUSTRIES[company.industry];
          const room =
            computeCompanyMaxWorkers(industry, company.level, config.COMPANY_UPGRADE_TUNING, company.facilityCount) -
            company.workersAssigned;
          if (room <= 0) continue;
          const toAssign = Math.min(room, idleForHiring);
          company.workersAssigned += toAssign;
          idleForHiring -= toAssign;
        }
        companyWorkersByOwner.set(
          settlement.playerId,
          ownedCompanies.reduce((sum, c) => sum + c.workersAssigned, 0),
        );
      }

      const companyWorkers = companyWorkersByOwner.get(settlement.playerId) ?? 0;
      const unemployed = computeUnemployment(consumption.newPopulationCount, companyWorkers);

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
        gold: state.gold,
        lastTickAt: now,
        population: {
          update: {
            count: consumption.newPopulationCount,
            happiness: finalHappiness,
          },
        },
      },
    });
  }

  for (const company of companies) {
    const rawElapsedHours = (now.getTime() - company.lastTickAt.getTime()) / (1000 * 60 * 60);
    const elapsedHours = Math.max(0, Math.min(MAX_CATCHUP_HOURS, rawElapsedHours));
    if (elapsedHours <= 0) continue;

    const industry = config.COMPANY_INDUSTRIES[company.industry];
    const result = tickCompany(company, elapsedHours, industry, config.COMPANY_UPGRADE_TUNING);

    // Every resource the recipe touched this tick feeds the market's
    // supply/demand accounting — negative deltas are consumption, positive
    // are production. Replaces the old single inputResource/outputResource
    // writes now that a company can touch several resources at once.
    for (const [resource, delta] of Object.entries(result.stockDeltas)) {
      const r = resource as MarketResourceType;
      if (delta < 0) flows[r].demand += -delta;
      else if (delta > 0) flows[r].supply += delta;
    }

    const stocks: Partial<Record<MarketResourceType, number>> = { ...company.stocks };
    for (const [resource, delta] of Object.entries(result.stockDeltas)) {
      const r = resource as MarketResourceType;
      stocks[r] = (stocks[r] ?? 0) + delta;
    }
    const state: MutableCompanyState = { cash: result.cash, stocks };

    // Gate on actual control, not raw ownership — a company a founding
    // player still technically "owns" but has lost majority control of (an
    // NPC investor bought >50%, see control.ts) needs the same autonomous
    // management an NPC-founded company gets, or it just sits frozen: no
    // selling stock, no hiring, no loan upkeep, forever. getControllingPlayerId
    // already short-circuits to company.ownerId for private/non-majority
    // cases, so this costs an extra query only for genuinely contested
    // public companies.
    const controllingPlayerId = await getControllingPlayerId(company);
    let revenue = 0;
    if (!controllingPlayerId) {
      revenue = await settleNpcCompanyTrading(company, state, prices);
      await maybeHire(company, state);
      await maybeUpgradeCompany(company, state);
      await maybeExpandCompany(company, state);
      await maybeRepayLoan(company.id, state);
      await maybeBorrow(company.id, state);
    }
    // A direct sale to its own founder's settlement (directSales.ts), if
    // any — folded in here so it counts toward totalRevenue the same as any
    // other sale, which is what IPO eligibility/share pricing/dividends key
    // off of.
    revenue += ownedSaleRevenueByCompanyId.get(company.id) ?? 0;

    if (shouldAutoClose(industry, state.cash, company.isPublic, config.COMPANY_FAILURE_TUNING)) {
      await autoCloseCompany(company.id, state.cash);
      continue;
    }

    const workersAssigned = shouldForceLayoff(state.cash, company.workersAssigned)
      ? company.workersAssigned - 1
      : company.workersAssigned;

    await prisma.$transaction([
      prisma.company.update({
        where: { id: company.id },
        data: {
          cash: state.cash,
          workersAssigned,
          lastTickAt: now,
          totalExpenses: { increment: result.wagesPaid },
          totalRevenue: { increment: revenue },
        },
      }),
      ...Object.entries(state.stocks).map(([resource, amount]) =>
        prisma.companyResourceStock.upsert({
          where: { companyId_resourceType: { companyId: company.id, resourceType: resource } },
          create: { companyId: company.id, resourceType: resource, amount: amount ?? 0 },
          update: { amount: amount ?? 0 },
        }),
      ),
    ]);
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
    const defaulted = pastMaturity || isLoanDefaulted({ ...loan, outstandingBalance: newBalance }, config.BANK_TUNING);

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

  // Bonds: redeemed once, in full, at maturity — unlike a loan or deposit
  // there's no accrual step, since a bond's value is fixed at issuance.
  // Redemption is capped by the issuing government's treasury (the same
  // "can't pay out more than it has" idiom deposit withdrawals already get
  // from bank liquidity), and marked redeemed regardless of whether the
  // payout was full or partial — this is an automatic tick-driven event, not
  // a player action the holder can just retry once the government has more
  // treasury, so leaving it "stuck" indefinitely isn't the right failure
  // mode. A holder of a bond from an over-extended government genuinely
  // eats the shortfall, a real economic stake matching this game's other
  // debt instruments.
  const maturedBonds = await prisma.bond.findMany({
    where: { redeemedAt: null, maturesAt: { lte: now } },
    include: { government: true },
  });
  const treasuryLedger = new Map<string, number>();
  for (const bond of maturedBonds) {
    const redemptionValue = computeBondRedemptionValue(bond.principal, bond.interestRatePerHour, bond.termHours);
    const availableTreasury = treasuryLedger.get(bond.governmentId) ?? bond.government.treasury;
    const payout = Math.min(redemptionValue, Math.max(0, availableTreasury));
    treasuryLedger.set(bond.governmentId, availableTreasury - payout);

    await prisma.$transaction([
      prisma.government.update({ where: { id: bond.governmentId }, data: { treasury: { decrement: payout } } }),
      prisma.settlement.update({ where: { playerId: bond.holderId }, data: { gold: { increment: payout } } }),
      prisma.bond.update({ where: { id: bond.id }, data: { redeemedAt: now } }),
    ]);
  }

  // Corporate bonds: the same maturity-redemption idiom as government
  // bonds, capped by the issuing company's cash instead of a treasury. A
  // company that closes before maturity redeems its bonds immediately at
  // closure time instead (buildCorporateBondClosureOps, pro-rata across
  // whatever's outstanding) — since that already runs earlier in this same
  // tick (the company loop, above), any bond belonging to a company that
  // auto-closed this tick is already redeemedAt-set by the time this query
  // runs, so it's naturally excluded here rather than double-processed.
  const maturedCorporateBonds = await prisma.corporateBond.findMany({
    where: { redeemedAt: null, maturesAt: { lte: now } },
    include: { company: true },
  });
  const companyCashLedger = new Map<string, number>();
  for (const bond of maturedCorporateBonds) {
    const redemptionValue = computeBondRedemptionValue(bond.principal, bond.interestRatePerHour, bond.termHours);
    const availableCash = companyCashLedger.get(bond.companyId) ?? bond.company.cash;
    const payout = Math.min(redemptionValue, Math.max(0, availableCash));
    companyCashLedger.set(bond.companyId, availableCash - payout);

    await prisma.$transaction([
      prisma.company.update({ where: { id: bond.companyId }, data: { cash: { decrement: payout } } }),
      prisma.settlement.update({ where: { playerId: bond.holderId }, data: { gold: { increment: payout } } }),
      prisma.corporateBond.update({ where: { id: bond.id }, data: { redeemedAt: now } }),
    ]);
  }

  // Zone projects: a one-time commission maturing into permanent founding
  // capacity, closer in shape to a Bond's one-time maturity payout (above)
  // than to Contract's per-tick settlement (below) — money and goods
  // already changed hands at acceptance (routes/infrastructure.ts).
  // Completion just records the SettlementZone row; nothing consults it
  // per-tick the way techs aren't "applied" either — capacity is read live
  // whenever POST /companies checks it.
  const dueZoneProjects = await prisma.zoneProject.findMany({
    where: { acceptedAt: { not: null }, completedAt: null, cancelledAt: null, completesAt: { lte: now } },
  });
  for (const project of dueZoneProjects) {
    const zoneDef = ZONE_TYPES[project.zoneType as ZoneTypeId];
    // Capacity granted comes from the placed rectangle's actual area, not
    // ZONE_TYPES' flat suggestion — that field is advisory-only now (see
    // ZoneDef.slotsGranted). Legacy projects from before placement existed
    // have null dimensions and fall back to 0 rather than crashing.
    const area = (project.zoneWidth ?? 0) * (project.zoneHeight ?? 0);
    const slotsGranted = Math.floor(area / CELLS_PER_ZONE_SLOT);
    await prisma.$transaction([
      prisma.settlementZone.create({
        data: {
          settlementId: project.settlementId,
          type: project.zoneType,
          slotsGranted,
          zoneX: project.zoneX,
          zoneY: project.zoneY,
          zoneWidth: project.zoneWidth,
          zoneHeight: project.zoneHeight,
        },
      }),
      prisma.zoneProject.update({ where: { id: project.id }, data: { completedAt: now } }),
    ]);
    await prisma.event.create({
      data: {
        settlementId: project.settlementId,
        type: "zone_completed",
        title: `${zoneDef.name} Completed`,
        description: `${zoneDef.name} construction has finished — founding capacity for ${zoneDef.industries.length > 1 ? "matching industries" : "retail companies"} has increased by ${slotsGranted}.`,
      },
    });
  }

  // Contracts: settle standing supply agreements between companies, capped
  // by scarcity (seller's stock of the contract's own resourceType, buyer's
  // cash) — see settleContract. Goods and gold move directly between the
  // two companies, outside the market's flows accumulator, same as how a
  // manual trade moves cash but a contract additionally moves the resource
  // without touching market price.
  const activeContracts = await prisma.contract.findMany({
    where: { cancelledAt: null, acceptedAt: { not: null }, expiresAt: { gt: now } },
    include: { seller: true, buyer: true },
  });

  // Every seller's current stock of exactly the resource its contract(s)
  // trade — a contract only ever concerns one resourceType, so this is a
  // single lookup per (company, resource) pair, not the whole stock table.
  const sellerStockRows = await prisma.companyResourceStock.findMany({
    where: {
      OR: activeContracts.map((c) => ({ companyId: c.sellerCompanyId, resourceType: c.resourceType })),
    },
  });
  const sellerStockKey = (companyId: string, resourceType: string) => `${companyId}:${resourceType}`;
  const sellerStockByKey = new Map(sellerStockRows.map((r) => [sellerStockKey(r.companyId, r.resourceType), r.amount]));

  // Two contracts can share the same seller (or buyer) and both get settled
  // in this same loop. The stock/cash rows queried above are a snapshot
  // taken once before any of them settle — using that snapshot directly
  // would let every contract on that company check scarcity against the
  // same start-of-tick number, so their transfers stack past what the
  // company actually has. These ledgers track the running balance across
  // the loop so the second contract on a company sees what the first one
  // already took.
  const stockLedger = new Map<string, number>();
  const cashLedger = new Map<string, number>();
  const ledgerStock = (companyId: string, resourceType: string, fallback: number) =>
    stockLedger.get(sellerStockKey(companyId, resourceType)) ?? fallback;
  const ledgerCash = (companyId: string, fallback: number) => cashLedger.get(companyId) ?? fallback;

  for (const contract of activeContracts) {
    const rawElapsedHours = (now.getTime() - contract.lastSettledAt.getTime()) / (1000 * 60 * 60);
    const elapsedHours = Math.max(0, Math.min(MAX_CATCHUP_HOURS, rawElapsedHours));
    if (elapsedHours <= 0) continue;

    const sellerStock = ledgerStock(
      contract.sellerCompanyId,
      contract.resourceType,
      sellerStockByKey.get(sellerStockKey(contract.sellerCompanyId, contract.resourceType)) ?? 0,
    );
    const buyerCash = ledgerCash(contract.buyerCompanyId, contract.buyer.cash);

    const { transferred, grossCost } = settleContract(contract, elapsedHours, sellerStock, buyerCash);
    if (transferred <= 0) {
      await prisma.contract.update({ where: { id: contract.id }, data: { lastSettledAt: now } });
      continue;
    }

    const sellerGovernment = contract.seller.ownerId
      ? await prisma.government.findUnique({ where: { playerId: contract.seller.ownerId } })
      : null;
    const tax = sellerGovernment ? grossCost * sellerGovernment.corporateTaxRate : 0;
    const netProceeds = grossCost - tax;

    stockLedger.set(sellerStockKey(contract.sellerCompanyId, contract.resourceType), sellerStock - transferred);
    cashLedger.set(contract.buyerCompanyId, buyerCash - grossCost);
    cashLedger.set(contract.sellerCompanyId, ledgerCash(contract.sellerCompanyId, contract.seller.cash) + netProceeds);

    await prisma.$transaction([
      prisma.companyResourceStock.upsert({
        where: { companyId_resourceType: { companyId: contract.sellerCompanyId, resourceType: contract.resourceType } },
        create: { companyId: contract.sellerCompanyId, resourceType: contract.resourceType, amount: sellerStock - transferred },
        update: { amount: sellerStock - transferred },
      }),
      prisma.company.update({
        where: { id: contract.sellerCompanyId },
        data: { cash: { increment: netProceeds }, totalRevenue: { increment: netProceeds } },
      }),
      prisma.companyResourceStock.upsert({
        where: { companyId_resourceType: { companyId: contract.buyerCompanyId, resourceType: contract.resourceType } },
        create: { companyId: contract.buyerCompanyId, resourceType: contract.resourceType, amount: transferred },
        update: { amount: { increment: transferred } },
      }),
      prisma.company.update({
        where: { id: contract.buyerCompanyId },
        data: { cash: { decrement: grossCost } },
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
    const targetPrice = computeTargetSharePrice(company, now, config.STOCK_TUNING);
    const newPrice = driftSharePrice(company.sharePrice, targetPrice, worldElapsedHours, config.STOCK_TUNING);

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
    await maybeDividend(company, config.DIVIDEND_TUNING);
  }

  await tickMarket(flows, worldElapsedHours);
  await maybeRollEvent(snapshots);
  await maybeFoundNpcCompany(snapshots.length);

  await prisma.worldState.upsert({
    where: { id: 1 },
    update: { lastTickAt: now },
    create: { id: 1, lastTickAt: now },
  });

  return { settlementsProcessed: snapshots.length, companiesProcessed: companies.length };
}
