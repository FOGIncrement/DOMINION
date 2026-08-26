import { Router } from "express";
import { z } from "zod";
import { computeProfitRatePerHour } from "@dominion/shared";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/index.js";
import { getConfig } from "../gameConfigStore.js";
import { announceControlChangeIfAny, getControllerLabel, getControllingPlayerId } from "../simulation/control.js";
import { applyShareTradeImpact, availableShareFloat } from "../simulation/stocks.js";

export const stocksRouter = Router();

stocksRouter.get("/", async (_req, res) => {
  const companies = await prisma.company.findMany({ where: { isPublic: true } });
  res.json({
    stocks: companies.map((c) => ({
      id: c.id,
      name: c.name,
      industry: c.industry,
      sharePrice: c.sharePrice,
      sharesOutstanding: c.sharesOutstanding,
      marketCap: c.sharePrice * c.sharesOutstanding,
      isPlayerOwned: c.ownerId !== null,
      profitRatePerHour: computeProfitRatePerHour(c),
    })),
  });
});

stocksRouter.get("/:companyId", async (req, res) => {
  const company = await prisma.company.findUnique({ where: { id: req.params.companyId } });
  if (!company || !company.isPublic) {
    res.status(404).json({ error: "Stock not found" });
    return;
  }

  const history = await prisma.sharePriceHistoryPoint.findMany({
    where: { companyId: company.id },
    orderBy: { recordedAt: "desc" },
    take: 100,
  });

  const holdings = await prisma.shareholding.findMany({
    where: { companyId: company.id, shares: { gt: 0.0001 } },
    include: { player: { include: { settlement: true } }, npcInvestor: true },
    orderBy: { shares: "desc" },
    take: 10,
  });

  res.json({
    id: company.id,
    name: company.name,
    industry: company.industry,
    cash: company.cash,
    sharePrice: company.sharePrice,
    sharesOutstanding: company.sharesOutstanding,
    marketCap: company.sharePrice * company.sharesOutstanding,
    totalRevenue: company.totalRevenue,
    totalExpenses: company.totalExpenses,
    profitRatePerHour: computeProfitRatePerHour(company),
    workersAssigned: company.workersAssigned,
    ipoAt: company.ipoAt,
    controllerLabel: await getControllerLabel(company),
    history: history.reverse().map((h) => ({ price: h.price, recordedAt: h.recordedAt })),
    topShareholders: holdings.map((h) => ({
      name: h.player?.settlement?.name ?? h.npcInvestor?.name ?? "Unknown",
      isPlayer: h.playerId !== null,
      shares: h.shares,
      percent: company.sharesOutstanding > 0 ? (h.shares / company.sharesOutstanding) * 100 : 0,
    })),
  });
});

stocksRouter.use(requireAuth);

stocksRouter.get("/me/portfolio", async (req: AuthedRequest, res) => {
  const holdings = await prisma.shareholding.findMany({
    where: { playerId: req.playerId!, shares: { gt: 0.0001 } },
    include: { company: true },
  });
  res.json({
    holdings: holdings.map((h) => ({
      companyId: h.companyId,
      companyName: h.company.name,
      shares: h.shares,
      sharePrice: h.company.sharePrice,
      value: h.shares * h.company.sharePrice,
    })),
  });
});

const tradeSchema = z.object({ side: z.enum(["buy", "sell"]), shares: z.number().positive() });

stocksRouter.post("/:companyId/trade", async (req: AuthedRequest, res) => {
  const parsed = tradeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid trade request" });
    return;
  }

  const company = await prisma.company.findUnique({ where: { id: req.params.companyId } });
  if (!company || !company.isPublic) {
    res.status(404).json({ error: "Stock not found" });
    return;
  }

  const settlement = await prisma.settlement.findUnique({ where: { playerId: req.playerId! } });
  if (!settlement) {
    res.status(404).json({ error: "No settlement found for this player" });
    return;
  }

  const beforeControllerId = await getControllingPlayerId(company);
  const { side, shares } = parsed.data;

  if (side === "buy") {
    const float = await availableShareFloat(company.id, company.sharesOutstanding);
    if (shares > float) {
      res.status(400).json({ error: `Only ${float.toFixed(1)} shares available to buy` });
      return;
    }

    const cost = shares * company.sharePrice;
    if (settlement.gold < cost) {
      res.status(400).json({ error: "Not enough gold for that purchase" });
      return;
    }

    const existing = await prisma.shareholding.findUnique({
      where: { companyId_playerId: { companyId: company.id, playerId: req.playerId! } },
    });

    await prisma.settlement.update({ where: { id: settlement.id }, data: { gold: settlement.gold - cost } });
    if (existing) {
      await prisma.shareholding.update({ where: { id: existing.id }, data: { shares: existing.shares + shares } });
    } else {
      await prisma.shareholding.create({ data: { companyId: company.id, playerId: req.playerId!, shares } });
    }
    const newPrice = await applyShareTradeImpact(company.id, "buy", shares, company.sharePrice, getConfig().STOCK_TUNING);
    await announceControlChangeIfAny(company, beforeControllerId);
    res.json({ ok: true, cost, newPrice });
    return;
  }

  const holding = await prisma.shareholding.findUnique({
    where: { companyId_playerId: { companyId: company.id, playerId: req.playerId! } },
  });
  if (!holding || holding.shares < shares) {
    res.status(400).json({ error: "Not enough shares to sell" });
    return;
  }

  const proceeds = shares * company.sharePrice;
  await prisma.shareholding.update({ where: { id: holding.id }, data: { shares: holding.shares - shares } });
  await prisma.settlement.update({ where: { id: settlement.id }, data: { gold: settlement.gold + proceeds } });
  const newPrice = await applyShareTradeImpact(company.id, "sell", shares, company.sharePrice, getConfig().STOCK_TUNING);
  await announceControlChangeIfAny(company, beforeControllerId);
  res.json({ ok: true, proceeds, newPrice });
});
