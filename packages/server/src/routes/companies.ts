import { Router } from "express";
import { z } from "zod";
import {
  COMPANY_INDUSTRIES,
  COMPANY_INDUSTRY_IDS,
  STOCK_TUNING,
  ZONE_BASELINE_FREE_SLOTS,
  ZONE_TYPES,
  computeCompanyHourlyRates,
  computeCompanyMaxWorkers,
  computeCompanyUpgradeCost,
  computeTargetSharePrice,
  zoneCategoryForIndustry,
  type CompanyIndustryId,
} from "@dominion/shared";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/index.js";
import { applyTradeImpact } from "../simulation/market.js";
import { getControllerLabel, getControllingPlayerId } from "../simulation/control.js";
import { buildCorporateBondClosureOps } from "../simulation/corporateBonds.js";

export const companiesRouter = Router();

companiesRouter.get("/", async (_req, res) => {
  const companies = await prisma.company.findMany({ where: { closedAt: null }, orderBy: { foundedAt: "asc" } });
  res.json({
    companies: companies.map((c) => ({
      id: c.id,
      name: c.name,
      industry: c.industry,
      industryName: COMPANY_INDUSTRIES[c.industry as CompanyIndustryId]?.name ?? c.industry,
      isPlayerOwned: c.ownerId !== null,
      workersAssigned: c.workersAssigned,
      level: c.level,
      cash: Math.round(c.cash),
      foundedAt: c.foundedAt,
      isPublic: c.isPublic,
      sharePrice: c.sharePrice,
    })),
  });
});

companiesRouter.use(requireAuth);

companiesRouter.get("/mine", async (req: AuthedRequest, res) => {
  const playerId = req.playerId!;

  // "Mine" means founder OR controller — a company acquired by buying a
  // majority stake belongs here just as much as one you founded, and a
  // founder who's lost control still needs to see that it happened.
  const majorityHeld = await prisma.shareholding.findMany({
    where: { playerId, shares: { gt: 0 } },
    include: { company: true },
  });
  const acquiredIds = majorityHeld
    .filter((h) => h.company.isPublic && h.shares > h.company.sharesOutstanding * 0.5)
    .map((h) => h.companyId);

  const companies = await prisma.company.findMany({
    where: { closedAt: null, OR: [{ ownerId: playerId }, { id: { in: acquiredIds } }] },
  });

  const withControl = await Promise.all(
    companies.map(async (c) => {
      const industry = COMPANY_INDUSTRIES[c.industry as CompanyIndustryId];
      const controllerId = await getControllingPlayerId(c);
      const controlledByMe = controllerId === playerId;
      return {
        id: c.id,
        name: c.name,
        industry: c.industry,
        cash: c.cash,
        inputStock: c.inputStock,
        goodsStock: c.goodsStock,
        workersAssigned: c.workersAssigned,
        maxWorkers: computeCompanyMaxWorkers(industry, c.level),
        level: c.level,
        upgradeCost: computeCompanyUpgradeCost(industry, c.level),
        totalRevenue: c.totalRevenue,
        totalExpenses: c.totalExpenses,
        foundedAt: c.foundedAt,
        rates: computeCompanyHourlyRates(industry, c.workersAssigned, c.level),
        isPublic: c.isPublic,
        sharePrice: c.sharePrice,
        sharesOutstanding: c.sharesOutstanding,
        isFounder: c.ownerId === playerId,
        controlledByMe,
        controllerLabel: controlledByMe ? "You" : await getControllerLabel(c),
      };
    }),
  );

  res.json({ companies: withControl });
});

const foundSchema = z.object({
  name: z.string().min(2).max(60),
  industry: z.enum(COMPANY_INDUSTRY_IDS),
  // Extra capital beyond the flat founding cost — a cushion against the
  // wage-driven forced-layoff/auto-close consequences (see
  // simulation/companyFailure.ts) at the price of tying up more settlement
  // gold up front. No upper cap beyond what the player can afford.
  seedMoney: z.number().min(0).max(1_000_000).default(0),
});

companiesRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = foundSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const settlement = await prisma.settlement.findUnique({ where: { playerId: req.playerId! } });
  if (!settlement) {
    res.status(404).json({ error: "No settlement found for this player" });
    return;
  }

  const industry = COMPANY_INDUSTRIES[parsed.data.industry];

  // Founding capacity is shared per zone category (industrial vs. retail),
  // not per individual industry — a baseline free allowance plus whatever
  // zones this settlement has completed. Only gates NEW foundings; existing
  // companies (including any founded before this cap existed) are never
  // retroactively touched. NPC founding (routes elsewhere) is unaffected —
  // NPC settlements have no Government to commission a zone through.
  const zoneType = zoneCategoryForIndustry(industry.id);
  const zoneDef = ZONE_TYPES[zoneType];
  const [usedInCategory, zones] = await Promise.all([
    prisma.company.count({
      where: { ownerId: req.playerId!, closedAt: null, industry: { in: zoneDef.industries } },
    }),
    prisma.settlementZone.findMany({ where: { settlementId: settlement.id, type: zoneType } }),
  ]);
  const capacity = ZONE_BASELINE_FREE_SLOTS[zoneType] + zones.reduce((sum, z) => sum + z.slotsGranted, 0);
  if (usedInCategory >= capacity) {
    res.status(400).json({
      error: `Not enough ${zoneDef.name} capacity (${usedInCategory}/${capacity} used) — commission a ${zoneDef.name} from your government to found more.`,
    });
    return;
  }

  const totalCost = industry.foundingCost + parsed.data.seedMoney;
  if (settlement.gold < totalCost) {
    res.status(400).json({ error: `Need ${totalCost} gold to found a ${industry.name} with that much seed money` });
    return;
  }

  const [, company] = await prisma.$transaction([
    prisma.settlement.update({
      where: { id: settlement.id },
      data: { gold: settlement.gold - totalCost },
    }),
    prisma.company.create({
      data: {
        ownerId: req.playerId!,
        name: parsed.data.name,
        industry: parsed.data.industry,
        cash: totalCost,
      },
    }),
  ]);

  res.status(201).json({ ok: true, companyId: company.id });
});

/**
 * Distinguishes "doesn't exist" (404) from "exists but you don't control
 * it" (403) — the latter matters now that companies are visibly listed
 * publicly and can change hands without the requester's involvement. A
 * closed company reads as "doesn't exist" too — it's gone, same as a 404.
 */
async function loadControlledCompany(id: string, playerId: string) {
  const company = await prisma.company.findUnique({ where: { id } });
  if (!company || company.closedAt) return { company: null, controlled: false } as const;
  const controllerId = await getControllingPlayerId(company);
  return { company, controlled: controllerId === playerId } as const;
}

function respondNotControlled(res: import("express").Response, company: unknown) {
  if (!company) {
    res.status(404).json({ error: "Company not found" });
  } else {
    res.status(403).json({ error: "You don't control this company" });
  }
}

const workersSchema = z.object({ workersAssigned: z.number().int().min(0) });

companiesRouter.post("/:id/workers", async (req: AuthedRequest, res) => {
  const parsed = workersSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const { company, controlled } = await loadControlledCompany(req.params.id, req.playerId!);
  if (!company || !controlled) {
    respondNotControlled(res, company);
    return;
  }

  const industry = COMPANY_INDUSTRIES[company.industry as CompanyIndustryId];
  const workersAssigned = Math.min(parsed.data.workersAssigned, computeCompanyMaxWorkers(industry, company.level));

  // Same population cap /game/workers enforces on the building side, and
  // the same "decreasing is always allowed" exception. Drawn from the
  // FOUNDER's population (company.ownerId), not whoever currently controls
  // it — a company's jobs belong to whoever founded it, same idiom the tick
  // engine's employment/welfare accounting already uses. A company with no
  // owner (NPC-founded) never counted toward any player's population, so
  // there's nothing to check here.
  if (company.ownerId && workersAssigned > company.workersAssigned) {
    const settlement = await prisma.settlement.findUnique({
      where: { playerId: company.ownerId },
      include: { population: true, buildings: true },
    });
    if (settlement?.population) {
      const buildingWorkers = settlement.buildings.reduce((sum, b) => sum + b.workersAssigned, 0);
      const otherCompanies = await prisma.company.findMany({
        where: { ownerId: company.ownerId, closedAt: null, id: { not: company.id } },
        select: { workersAssigned: true },
      });
      const otherCompanyWorkers = otherCompanies.reduce((sum, c) => sum + c.workersAssigned, 0);

      if (buildingWorkers + otherCompanyWorkers + workersAssigned > settlement.population.count) {
        res.status(400).json({ error: "Not enough available population for that many workers" });
        return;
      }
    }
  }

  await prisma.company.update({ where: { id: company.id }, data: { workersAssigned } });
  res.json({ ok: true, workersAssigned });
});

companiesRouter.post("/:id/upgrade", async (req: AuthedRequest, res) => {
  const { company, controlled } = await loadControlledCompany(req.params.id, req.playerId!);
  if (!company || !controlled) {
    respondNotControlled(res, company);
    return;
  }

  const industry = COMPANY_INDUSTRIES[company.industry as CompanyIndustryId];
  const cost = computeCompanyUpgradeCost(industry, company.level);
  if (cost === null) {
    res.status(400).json({ error: "Already at max level" });
    return;
  }
  if (company.cash < cost) {
    res.status(400).json({ error: `Need ${cost.toFixed(0)} gold in company cash to upgrade` });
    return;
  }

  const level = company.level + 1;
  await prisma.company.update({ where: { id: company.id }, data: { cash: company.cash - cost, level } });
  res.json({ ok: true, level, cost });
});

const tradeSchema = z.object({ side: z.enum(["buy", "sell"]), quantity: z.number().positive() });

companiesRouter.post("/:id/trade", async (req: AuthedRequest, res) => {
  const parsed = tradeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid trade request" });
    return;
  }

  const { company, controlled } = await loadControlledCompany(req.params.id, req.playerId!);
  if (!company || !controlled) {
    respondNotControlled(res, company);
    return;
  }

  const industry = COMPANY_INDUSTRIES[company.industry as CompanyIndustryId];
  const { side, quantity } = parsed.data;

  if (industry.contractOnly) {
    res.status(400).json({
      error: `${industry.name} companies don't trade goods — they earn revenue by fulfilling government zone commissions instead`,
    });
    return;
  }

  if (side === "buy") {
    if (!industry.inputResource) {
      res.status(400).json({
        error: `${industry.name} companies don't buy any input — they produce ${industry.outputResource} directly`,
      });
      return;
    }

    const market = await prisma.marketResource.findUnique({ where: { resourceType: industry.inputResource } });
    if (!market) {
      res.status(404).json({ error: "Market not initialized yet" });
      return;
    }
    const cost = quantity * market.price;
    if (company.cash < cost) {
      res.status(400).json({ error: "Not enough company cash for that purchase" });
      return;
    }

    await prisma.$transaction([
      prisma.company.update({
        where: { id: company.id },
        data: { cash: company.cash - cost, inputStock: company.inputStock + quantity },
      }),
      prisma.marketTrade.create({
        data: { companyId: company.id, resourceType: industry.inputResource, side, quantity, price: market.price },
      }),
    ]);
    const newPrice = await applyTradeImpact(industry.inputResource, "buy", quantity);
    res.json({ ok: true, cost, newPrice });
    return;
  }

  if (company.goodsStock < quantity) {
    res.status(400).json({ error: `Not enough ${industry.outputResource} in stock to sell` });
    return;
  }
  const market = await prisma.marketResource.findUnique({ where: { resourceType: industry.outputResource } });
  if (!market) {
    res.status(404).json({ error: "Market not initialized yet" });
    return;
  }
  const grossProceeds = quantity * market.price;

  const government = await prisma.government.findUnique({ where: { playerId: req.playerId! } });
  const tax = government ? grossProceeds * government.corporateTaxRate : 0;
  const proceeds = grossProceeds - tax;

  const updates = [
    prisma.company.update({
      where: { id: company.id },
      data: {
        cash: company.cash + proceeds,
        goodsStock: company.goodsStock - quantity,
        totalRevenue: { increment: grossProceeds },
        totalExpenses: { increment: tax },
      },
    }),
    prisma.marketTrade.create({
      data: { companyId: company.id, resourceType: industry.outputResource, side, quantity, price: market.price },
    }),
  ];
  if (government && tax > 0) {
    updates.push(prisma.government.update({ where: { id: government.id }, data: { treasury: { increment: tax } } }));
  }

  await prisma.$transaction(updates);
  const newPrice = await applyTradeImpact(industry.outputResource, "sell", quantity);
  res.json({ ok: true, proceeds, tax, newPrice });
});

const withdrawSchema = z.object({ amount: z.number().positive() });

companiesRouter.post("/:id/withdraw", async (req: AuthedRequest, res) => {
  const parsed = withdrawSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid amount" });
    return;
  }

  const { company, controlled } = await loadControlledCompany(req.params.id, req.playerId!);
  if (!company || !controlled) {
    respondNotControlled(res, company);
    return;
  }
  if (company.cash < parsed.data.amount) {
    res.status(400).json({ error: "Not enough company cash" });
    return;
  }

  const settlement = await prisma.settlement.findUnique({ where: { playerId: req.playerId! } });
  if (!settlement) {
    res.status(404).json({ error: "No settlement found for this player" });
    return;
  }

  await prisma.$transaction([
    prisma.company.update({ where: { id: company.id }, data: { cash: company.cash - parsed.data.amount } }),
    prisma.settlement.update({ where: { id: settlement.id }, data: { gold: settlement.gold + parsed.data.amount } }),
  ]);

  res.json({ ok: true });
});

const bailoutSchema = z.object({ amount: z.number().positive() });

companiesRouter.post("/:id/bailout", async (req: AuthedRequest, res) => {
  const parsed = bailoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid amount" });
    return;
  }

  const { company, controlled } = await loadControlledCompany(req.params.id, req.playerId!);
  if (!company || !controlled) {
    respondNotControlled(res, company);
    return;
  }
  if (company.cash >= 0) {
    res.status(400).json({ error: "This company isn't in debt — nothing to bail out" });
    return;
  }

  const settlement = await prisma.settlement.findUnique({ where: { playerId: req.playerId! } });
  if (!settlement) {
    res.status(404).json({ error: "No settlement found for this player" });
    return;
  }

  const deficit = -company.cash;
  const amount = Math.min(parsed.data.amount, deficit);
  if (settlement.gold < amount) {
    res.status(400).json({ error: "Not enough settlement gold for that bailout" });
    return;
  }

  await prisma.$transaction([
    prisma.company.update({ where: { id: company.id }, data: { cash: company.cash + amount } }),
    prisma.settlement.update({ where: { id: settlement.id }, data: { gold: settlement.gold - amount } }),
  ]);

  res.json({ ok: true, amount, remainingDeficit: deficit - amount });
});

companiesRouter.post("/:id/close", async (req: AuthedRequest, res) => {
  const { company, controlled } = await loadControlledCompany(req.params.id, req.playerId!);
  if (!company || !controlled) {
    respondNotControlled(res, company);
    return;
  }
  if (company.isPublic) {
    // "Public" alone isn't the real blocker — a company that IPO'd but where
    // the founder still holds every share (nobody ever bought in, or they
    // bought the float back) has nothing outside to protect. Only block when
    // shares are actually held by someone other than the founder.
    const outsideShares = await prisma.shareholding.aggregate({
      where: { companyId: company.id, NOT: { playerId: company.ownerId } },
      _sum: { shares: true },
    });
    if ((outsideShares._sum.shares ?? 0) > 0.0001) {
      res.status(400).json({ error: "Can't close a public company while it has outside shareholders" });
      return;
    }
  }

  const settlement = await prisma.settlement.findUnique({ where: { playerId: req.playerId! } });
  if (!settlement) {
    res.status(404).json({ error: "No settlement found for this player" });
    return;
  }

  // Bondholders are creditors and get priority over whatever the founder
  // recovers — see buildCorporateBondClosureOps.
  const { ops: bondOps, remainingCash: recoveredCash } = await buildCorporateBondClosureOps(
    company.id,
    Math.max(0, company.cash),
  );

  await prisma.$transaction([
    prisma.company.update({
      where: { id: company.id },
      data: { closedAt: new Date(), workersAssigned: 0, cash: 0 },
    }),
    // Shares in a closed company are worthless — same idiom as zeroing cash
    // above. Only ever reaches here holding the founder's own IPO shares
    // (the check above already rejected any real outside holding), but
    // clearing unconditionally avoids leaving a stale positive balance in
    // the founder's own portfolio for a company that no longer trades.
    prisma.shareholding.deleteMany({ where: { companyId: company.id } }),
    prisma.loan.updateMany({
      where: { companyId: company.id, defaultedAt: null },
      data: { defaultedAt: new Date() },
    }),
    ...bondOps,
    prisma.settlement.update({ where: { id: settlement.id }, data: { gold: { increment: recoveredCash } } }),
  ]);
  res.json({ ok: true, recoveredCash });
});

companiesRouter.post("/:id/ipo", async (req: AuthedRequest, res) => {
  const { company, controlled } = await loadControlledCompany(req.params.id, req.playerId!);
  if (!company || !controlled) {
    respondNotControlled(res, company);
    return;
  }
  if (company.isPublic) {
    res.status(400).json({ error: "Already public" });
    return;
  }

  const profit = company.totalRevenue - company.totalExpenses;
  if (profit < STOCK_TUNING.minProfitToIPO) {
    res.status(400).json({
      error: `Needs at least ${STOCK_TUNING.minProfitToIPO} gold of lifetime profit to IPO (currently ${profit.toFixed(0)})`,
    });
    return;
  }

  const sharesOutstanding = STOCK_TUNING.sharesOutstandingAtIPO;
  const sharePrice = computeTargetSharePrice({ ...company, sharesOutstanding });

  await prisma.$transaction([
    prisma.company.update({
      where: { id: company.id },
      data: { isPublic: true, sharesOutstanding, sharePrice, ipoAt: new Date() },
    }),
    prisma.shareholding.create({
      data: { companyId: company.id, playerId: req.playerId!, shares: sharesOutstanding },
    }),
  ]);

  res.status(201).json({ ok: true, sharePrice, sharesOutstanding });
});
