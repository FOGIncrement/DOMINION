import { Router } from "express";
import { z } from "zod";
import {
  COMPANY_INDUSTRY_IDS,
  ZONE_BASELINE_FREE_SLOTS,
  ZONE_TYPES,
  computeCompanyFacilityCost,
  computeCompanyHourlyRates,
  computeCompanyMaxWorkers,
  computeCompanyUpgradeCost,
  computeTargetSharePrice,
  zoneCategoryForIndustry,
  type CompanyIndustryId,
  type MarketResourceType,
} from "@dominion/shared";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/index.js";
import { getConfig } from "../gameConfigStore.js";
import { applyTradeImpact } from "../simulation/market.js";
import { getControllerLabel, getControllingPlayerId } from "../simulation/control.js";
import { buildCorporateBondClosureOps } from "../simulation/corporateBonds.js";
import { computeZoneCategoryUsage, countLegacyFoundings, findFreeCellInZoneCategory } from "./infrastructure.js";

export const companiesRouter = Router();

companiesRouter.get("/", async (_req, res) => {
  const config = getConfig();
  const companies = await prisma.company.findMany({ where: { closedAt: null }, orderBy: { foundedAt: "asc" } });
  res.json({
    companies: companies.map((c) => ({
      id: c.id,
      name: c.name,
      industry: c.industry,
      industryName: config.COMPANY_INDUSTRIES[c.industry as CompanyIndustryId]?.name ?? c.industry,
      isPlayerOwned: c.ownerId !== null,
      workersAssigned: c.workersAssigned,
      level: c.level,
      facilityCount: c.facilityCount,
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
  const config = getConfig();

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

  // One query for every owned company's resource stocks, grouped in memory
  // — replaces the old single inputStock/goodsStock scalars.
  const stockRows = await prisma.companyResourceStock.findMany({
    where: { companyId: { in: companies.map((c) => c.id) } },
  });
  const stocksByCompany = new Map<string, Partial<Record<MarketResourceType, number>>>();
  for (const row of stockRows) {
    const bucket = stocksByCompany.get(row.companyId) ?? {};
    bucket[row.resourceType as MarketResourceType] = row.amount;
    stocksByCompany.set(row.companyId, bucket);
  }

  const withControl = await Promise.all(
    companies.map(async (c) => {
      const industry = config.COMPANY_INDUSTRIES[c.industry as CompanyIndustryId];
      const controllerId = await getControllingPlayerId(c);
      const controlledByMe = controllerId === playerId;
      return {
        id: c.id,
        name: c.name,
        industry: c.industry,
        territorySeedIndex: c.territorySeedIndex,
        zoneId: c.zoneId,
        cellX: c.cellX,
        cellY: c.cellY,
        cash: c.cash,
        stocks: stocksByCompany.get(c.id) ?? {},
        workersAssigned: c.workersAssigned,
        autoStaff: c.autoStaff,
        maxWorkers: computeCompanyMaxWorkers(industry, c.level, config.COMPANY_UPGRADE_TUNING, c.facilityCount),
        level: c.level,
        upgradeCost: computeCompanyUpgradeCost(industry, c.level, config.COMPANY_UPGRADE_TUNING),
        facilityCount: c.facilityCount,
        expandCost: computeCompanyFacilityCost(industry, c.facilityCount, config.COMPANY_FACILITY_TUNING),
        totalRevenue: c.totalRevenue,
        totalExpenses: c.totalExpenses,
        foundedAt: c.foundedAt,
        rates: computeCompanyHourlyRates(industry, c.workersAssigned, c.level, config.COMPANY_UPGRADE_TUNING),
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

  const industry = getConfig().COMPANY_INDUSTRIES[parsed.data.industry];

  // Land-gated industries (Power Plant, Wheat Farm, etc.) are founded on a
  // specific owned territory instead — see routes/territory.ts's POST
  // /:seedIndex/found. zoneCategoryForIndustry below would throw for one of
  // these (they're deliberately absent from every ZONE_TYPES.industries
  // list), so this has to be checked first.
  if (industry.requiresTerritory) {
    res.status(400).json({ error: `${industry.name} must be founded on a territory you own, not through zoning` });
    return;
  }

  // Founding capacity is shared per zone category (industrial vs. retail),
  // not per individual industry — a baseline free allowance plus whatever
  // zones this settlement has completed. Only gates NEW foundings; existing
  // companies (including any founded before this cap existed) are never
  // retroactively touched. NPC founding (routes elsewhere) is unaffected —
  // NPC settlements have no Government to commission a zone through.
  const zoneType = zoneCategoryForIndustry(industry.id);
  const zoneDef = ZONE_TYPES[zoneType];
  const { used: usedInCategory, available: capacity } = await computeZoneCategoryUsage(
    req.playerId!,
    settlement.id,
    zoneType,
  );
  if (usedInCategory >= capacity) {
    res.status(400).json({
      error: `Not enough ${zoneDef.name} capacity (${usedInCategory}/${capacity} used) — commission a ${zoneDef.name} from your government to found more.`,
    });
    return;
  }

  // Founding Grid: this route doesn't let the player choose a cell (see
  // POST /at-cell for that) — it stays position-less while the player's
  // free ZONE_BASELINE_FREE_SLOTS allowance covers it, exactly like before
  // this feature existed. Once that's exhausted, it still works — it just
  // auto-places the company on the first free cell in one of the player's
  // own completed zones of the right type, rather than newly requiring a
  // trip to the map. The capacity check above already guarantees a free
  // cell exists whenever legacyUsed has run out, so a null placement here
  // would mean that invariant broke (e.g. a race) — treated the same as
  // ordinary capacity exhaustion rather than a distinct error.
  let placement: { zoneId: string; cellX: number; cellY: number } | null = null;
  const legacyUsed = await countLegacyFoundings(req.playerId!, zoneType);
  if (legacyUsed >= ZONE_BASELINE_FREE_SLOTS[zoneType]) {
    placement = await findFreeCellInZoneCategory(req.playerId!, settlement.id, zoneType);
    if (!placement) {
      res.status(400).json({
        error: `Not enough ${zoneDef.name} capacity (${usedInCategory}/${capacity} used) — commission a ${zoneDef.name} from your government to found more.`,
      });
      return;
    }
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
        ...(placement ? { zoneId: placement.zoneId, cellX: placement.cellX, cellY: placement.cellY } : {}),
      },
    }),
  ]);

  res.status(201).json({ ok: true, companyId: company.id });
});

const foundAtCellSchema = z.object({
  name: z.string().min(2).max(60),
  industry: z.enum(COMPANY_INDUSTRY_IDS),
  seedMoney: z.number().min(0).max(1_000_000).default(0),
  zoneId: z.string().min(1),
  cellX: z.number().int().min(0),
  cellY: z.number().int().min(0),
});

// Founding Grid — the map-driven founding path (packages/client/src/pages/
// Map.tsx's inline drawer): the player picks the exact cell, rather than
// this route or the zone-capacity pool picking one for them. Deliberately
// does NOT call computeZoneCategoryUsage — confirming this one specific
// cell is free, inside a zone the player owns, of the right type, *is* the
// capacity check now (see computeZoneCategoryUsage's own comment).
companiesRouter.post("/at-cell", async (req: AuthedRequest, res) => {
  const parsed = foundAtCellSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const { name, industry: industryId, seedMoney, zoneId, cellX, cellY } = parsed.data;

  const settlement = await prisma.settlement.findUnique({ where: { playerId: req.playerId! } });
  if (!settlement) {
    res.status(404).json({ error: "No settlement found for this player" });
    return;
  }

  const zone = await prisma.settlementZone.findUnique({ where: { id: zoneId } });
  if (!zone) {
    res.status(404).json({ error: "No such zone" });
    return;
  }
  if (zone.settlementId !== settlement.id) {
    res.status(403).json({ error: "You don't control this zone" });
    return;
  }
  if (zone.zoneX === null || zone.zoneY === null || zone.zoneWidth === null || zone.zoneHeight === null) {
    res.status(400).json({ error: "This zone has no placement" });
    return;
  }

  const industry = getConfig().COMPANY_INDUSTRIES[industryId];
  if (industry.requiresTerritory) {
    res.status(400).json({ error: `${industry.name} must be founded on a territory you own, not through zoning` });
    return;
  }

  const zoneDef = ZONE_TYPES[zone.type as keyof typeof ZONE_TYPES];
  if (!zoneDef.industries.includes(industryId)) {
    res.status(400).json({ error: `${industry.name} can't be founded in a ${zoneDef.name}` });
    return;
  }

  if (
    cellX < zone.zoneX ||
    cellX >= zone.zoneX + zone.zoneWidth ||
    cellY < zone.zoneY ||
    cellY >= zone.zoneY + zone.zoneHeight
  ) {
    res.status(400).json({ error: "That cell is outside this zone" });
    return;
  }

  const occupant = await prisma.company.findFirst({ where: { zoneId, cellX, cellY, closedAt: null } });
  if (occupant) {
    res.status(400).json({ error: `That square is already occupied by ${occupant.name}` });
    return;
  }

  const totalCost = industry.foundingCost + seedMoney;
  if (settlement.gold < totalCost) {
    res.status(400).json({ error: `Need ${totalCost} gold to found a ${industry.name} with that much seed money` });
    return;
  }

  const [, company] = await prisma.$transaction([
    prisma.settlement.update({ where: { id: settlement.id }, data: { gold: settlement.gold - totalCost } }),
    prisma.company.create({
      data: { ownerId: req.playerId!, name, industry: industryId, cash: totalCost, zoneId, cellX, cellY },
    }),
  ]);

  res.status(201).json({ ok: true, companyId: company.id, zoneId, cellX, cellY });
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

  const config = getConfig();
  const industry = config.COMPANY_INDUSTRIES[company.industry as CompanyIndustryId];
  const workersAssigned = Math.min(
    parsed.data.workersAssigned,
    computeCompanyMaxWorkers(industry, company.level, config.COMPANY_UPGRADE_TUNING, company.facilityCount),
  );

  // Population cap, with the same "decreasing is always allowed" exception.
  // Drawn from the FOUNDER's population (company.ownerId), not whoever
  // currently controls it — a company's jobs belong to whoever founded it,
  // same idiom the tick engine's employment/welfare accounting already
  // uses. A company with no owner (NPC-founded) never counted toward any
  // player's population, so there's nothing to check here.
  if (company.ownerId && workersAssigned > company.workersAssigned) {
    const settlement = await prisma.settlement.findUnique({
      where: { playerId: company.ownerId },
      include: { population: true },
    });
    if (settlement?.population) {
      const otherCompanies = await prisma.company.findMany({
        where: { ownerId: company.ownerId, closedAt: null, id: { not: company.id } },
        select: { workersAssigned: true },
      });
      const otherCompanyWorkers = otherCompanies.reduce((sum, c) => sum + c.workersAssigned, 0);

      if (otherCompanyWorkers + workersAssigned > settlement.population.count) {
        res.status(400).json({ error: "Not enough available population for that many workers" });
        return;
      }
    }
  }

  await prisma.company.update({ where: { id: company.id }, data: { workersAssigned } });
  res.json({ ok: true, workersAssigned });
});

const autoStaffSchema = z.object({ enabled: z.boolean() });

// Opting a company into "organic hiring" — see the settlement loop in
// simulation/engine.ts for what this actually does at tick time. Purely a
// flag flip here, no worker-count side effects of its own.
companiesRouter.post("/:id/auto-staff", async (req: AuthedRequest, res) => {
  const parsed = autoStaffSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const { company, controlled } = await loadControlledCompany(req.params.id, req.playerId!);
  if (!company || !controlled) {
    respondNotControlled(res, company);
    return;
  }

  await prisma.company.update({ where: { id: company.id }, data: { autoStaff: parsed.data.enabled } });
  res.json({ ok: true, autoStaff: parsed.data.enabled });
});

companiesRouter.post("/:id/upgrade", async (req: AuthedRequest, res) => {
  const { company, controlled } = await loadControlledCompany(req.params.id, req.playerId!);
  if (!company || !controlled) {
    respondNotControlled(res, company);
    return;
  }

  const config = getConfig();
  const industry = config.COMPANY_INDUSTRIES[company.industry as CompanyIndustryId];
  const cost = computeCompanyUpgradeCost(industry, company.level, config.COMPANY_UPGRADE_TUNING);
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

companiesRouter.post("/:id/expand", async (req: AuthedRequest, res) => {
  const { company, controlled } = await loadControlledCompany(req.params.id, req.playerId!);
  if (!company || !controlled) {
    respondNotControlled(res, company);
    return;
  }

  const config = getConfig();
  const industry = config.COMPANY_INDUSTRIES[company.industry as CompanyIndustryId];
  const cost = computeCompanyFacilityCost(industry, company.facilityCount, config.COMPANY_FACILITY_TUNING);
  if (cost === null) {
    res.status(400).json({ error: "Already at max facilities" });
    return;
  }

  // No zone-capacity gate here (removed with the Founding Grid feature) — a
  // facility expansion is "more sites running the same practices," an
  // economic-scaling lever (see COMPANY_FACILITY_TUNING), not a claim on
  // more physical zoning footprint. Zone capacity is now spent by occupying
  // a cell at founding time (see computeZoneCategoryUsage's comment); this
  // company already did that once and doesn't need to do it again to grow.
  // computeCompanyFacilityCost's escalating gold cost below is the only
  // brake on facility growth from here.
  if (company.cash < cost) {
    res.status(400).json({ error: `Need ${cost.toFixed(0)} gold in company cash to expand` });
    return;
  }

  const facilityCount = company.facilityCount + 1;
  await prisma.company.update({ where: { id: company.id }, data: { cash: company.cash - cost, facilityCount } });
  res.json({ ok: true, facilityCount, cost });
});

// A company can now hold several resources (its full recipe's inputs and
// outputs), so a trade has to say which one — buy is only valid for one of
// the industry's actual inputs, sell only for one of its actual outputs.
const tradeSchema = z.object({
  side: z.enum(["buy", "sell"]),
  resource: z.string(),
  quantity: z.number().positive(),
});

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

  const industry = getConfig().COMPANY_INDUSTRIES[company.industry as CompanyIndustryId];
  const { side, quantity } = parsed.data;
  const resource = parsed.data.resource as MarketResourceType;

  if (side === "buy") {
    if (!industry.inputs.some((i) => i.resource === resource)) {
      res.status(400).json({ error: `${industry.name} companies don't use ${resource} as an input` });
      return;
    }

    const market = await prisma.marketResource.findUnique({ where: { resourceType: resource } });
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
      prisma.company.update({ where: { id: company.id }, data: { cash: company.cash - cost } }),
      prisma.companyResourceStock.upsert({
        where: { companyId_resourceType: { companyId: company.id, resourceType: resource } },
        create: { companyId: company.id, resourceType: resource, amount: quantity },
        update: { amount: { increment: quantity } },
      }),
      prisma.marketTrade.create({
        data: { companyId: company.id, resourceType: resource, side, quantity, price: market.price },
      }),
    ]);
    const newPrice = await applyTradeImpact(resource, "buy", quantity);
    res.json({ ok: true, cost, newPrice });
    return;
  }

  if (!industry.outputs.some((o) => o.resource === resource)) {
    res.status(400).json({ error: `${industry.name} companies don't produce ${resource}` });
    return;
  }
  const stockRow = await prisma.companyResourceStock.findUnique({
    where: { companyId_resourceType: { companyId: company.id, resourceType: resource } },
  });
  const currentStock = stockRow?.amount ?? 0;
  if (currentStock < quantity) {
    res.status(400).json({ error: `Not enough ${resource} in stock to sell` });
    return;
  }
  const market = await prisma.marketResource.findUnique({ where: { resourceType: resource } });
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
        totalRevenue: { increment: grossProceeds },
        totalExpenses: { increment: tax },
      },
    }),
    prisma.companyResourceStock.update({
      where: { companyId_resourceType: { companyId: company.id, resourceType: resource } },
      data: { amount: { decrement: quantity } },
    }),
    prisma.marketTrade.create({
      data: { companyId: company.id, resourceType: resource, side, quantity, price: market.price },
    }),
  ];
  if (government && tax > 0) {
    updates.push(prisma.government.update({ where: { id: government.id }, data: { treasury: { increment: tax } } }));
  }

  await prisma.$transaction(updates);
  const newPrice = await applyTradeImpact(resource, "sell", quantity);
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

  const stockTuning = getConfig().STOCK_TUNING;
  const profit = company.totalRevenue - company.totalExpenses;
  if (profit < stockTuning.minProfitToIPO) {
    res.status(400).json({
      error: `Needs at least ${stockTuning.minProfitToIPO} gold of lifetime profit to IPO (currently ${profit.toFixed(0)})`,
    });
    return;
  }

  const sharesOutstanding = stockTuning.sharesOutstandingAtIPO;
  const sharePrice = computeTargetSharePrice({ ...company, sharesOutstanding }, new Date(), stockTuning);

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
