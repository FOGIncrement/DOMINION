import { Router } from "express";
import { z } from "zod";
import {
  COMPANY_INDUSTRIES,
  COMPANY_INDUSTRY_IDS,
  computeCompanyHourlyRates,
  type CompanyIndustryId,
} from "@dominion/shared";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/index.js";
import { applyTradeImpact } from "../simulation/market.js";

export const companiesRouter = Router();

companiesRouter.get("/", async (_req, res) => {
  const companies = await prisma.company.findMany({ orderBy: { foundedAt: "asc" } });
  res.json({
    companies: companies.map((c) => ({
      id: c.id,
      name: c.name,
      industry: c.industry,
      industryName: COMPANY_INDUSTRIES[c.industry as CompanyIndustryId]?.name ?? c.industry,
      isPlayerOwned: c.ownerId !== null,
      workersAssigned: c.workersAssigned,
      cash: Math.round(c.cash),
      foundedAt: c.foundedAt,
    })),
  });
});

companiesRouter.use(requireAuth);

companiesRouter.get("/mine", async (req: AuthedRequest, res) => {
  const companies = await prisma.company.findMany({ where: { ownerId: req.playerId! } });
  res.json({
    companies: companies.map((c) => {
      const industry = COMPANY_INDUSTRIES[c.industry as CompanyIndustryId];
      return {
        id: c.id,
        name: c.name,
        industry: c.industry,
        cash: c.cash,
        inputStock: c.inputStock,
        goodsStock: c.goodsStock,
        workersAssigned: c.workersAssigned,
        maxWorkers: industry.maxWorkers,
        totalRevenue: c.totalRevenue,
        totalExpenses: c.totalExpenses,
        foundedAt: c.foundedAt,
        rates: computeCompanyHourlyRates(industry, c.workersAssigned),
      };
    }),
  });
});

const foundSchema = z.object({
  name: z.string().min(2).max(60),
  industry: z.enum(COMPANY_INDUSTRY_IDS),
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
  if (settlement.gold < industry.foundingCost) {
    res.status(400).json({ error: `Need ${industry.foundingCost} gold to found a ${industry.name}` });
    return;
  }

  const [, company] = await prisma.$transaction([
    prisma.settlement.update({
      where: { id: settlement.id },
      data: { gold: settlement.gold - industry.foundingCost },
    }),
    prisma.company.create({
      data: {
        ownerId: req.playerId!,
        name: parsed.data.name,
        industry: parsed.data.industry,
        cash: industry.foundingCost,
      },
    }),
  ]);

  res.status(201).json({ ok: true, companyId: company.id });
});

async function loadOwnedCompany(id: string, playerId: string) {
  const company = await prisma.company.findUnique({ where: { id } });
  if (!company || company.ownerId !== playerId) return null;
  return company;
}

const workersSchema = z.object({ workersAssigned: z.number().int().min(0) });

companiesRouter.post("/:id/workers", async (req: AuthedRequest, res) => {
  const parsed = workersSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const company = await loadOwnedCompany(req.params.id, req.playerId!);
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }

  const industry = COMPANY_INDUSTRIES[company.industry as CompanyIndustryId];
  const workersAssigned = Math.min(parsed.data.workersAssigned, industry.maxWorkers);

  await prisma.company.update({ where: { id: company.id }, data: { workersAssigned } });
  res.json({ ok: true, workersAssigned });
});

const tradeSchema = z.object({ side: z.enum(["buy", "sell"]), quantity: z.number().positive() });

companiesRouter.post("/:id/trade", async (req: AuthedRequest, res) => {
  const parsed = tradeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid trade request" });
    return;
  }

  const company = await loadOwnedCompany(req.params.id, req.playerId!);
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }

  const industry = COMPANY_INDUSTRIES[company.industry as CompanyIndustryId];
  const { side, quantity } = parsed.data;

  if (side === "buy") {
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
    res.status(400).json({ error: "Not enough goods in stock to sell" });
    return;
  }
  const market = await prisma.marketResource.findUnique({ where: { resourceType: "goods" } });
  if (!market) {
    res.status(404).json({ error: "Market not initialized yet" });
    return;
  }
  const proceeds = quantity * market.price;

  await prisma.$transaction([
    prisma.company.update({
      where: { id: company.id },
      data: {
        cash: company.cash + proceeds,
        goodsStock: company.goodsStock - quantity,
        totalRevenue: { increment: proceeds },
      },
    }),
    prisma.marketTrade.create({
      data: { companyId: company.id, resourceType: "goods", side, quantity, price: market.price },
    }),
  ]);
  const newPrice = await applyTradeImpact("goods", "sell", quantity);
  res.json({ ok: true, proceeds, newPrice });
});

const withdrawSchema = z.object({ amount: z.number().positive() });

companiesRouter.post("/:id/withdraw", async (req: AuthedRequest, res) => {
  const parsed = withdrawSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid amount" });
    return;
  }

  const company = await loadOwnedCompany(req.params.id, req.playerId!);
  if (!company) {
    res.status(404).json({ error: "Company not found" });
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
