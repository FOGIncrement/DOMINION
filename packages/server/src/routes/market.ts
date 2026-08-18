import { Router } from "express";
import { z } from "zod";
import { TRADE_FEE } from "@dominion/shared";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/index.js";
import { applyTradeImpact } from "../simulation/market.js";

export const marketRouter = Router();

marketRouter.get("/", async (_req, res) => {
  const resources = await prisma.marketResource.findMany();
  const history = await prisma.priceHistoryPoint.findMany({
    orderBy: { recordedAt: "desc" },
    take: 3 * 200, // ~200 most recent points per resource, plenty for a sparkline
  });

  res.json({
    resources,
    history: history.reverse(),
  });
});

marketRouter.use(requireAuth);

// Settlements only ever hold food/wood/stone directly — "goods" is a
// company-level resource, traded through /api/companies/:id/trade instead.
const SETTLEMENT_TRADEABLE_RESOURCES = ["food", "wood", "stone"] as const;

const tradeSchema = z.object({
  resourceType: z.enum(SETTLEMENT_TRADEABLE_RESOURCES),
  side: z.enum(["buy", "sell"]),
  quantity: z.number().positive(),
});

marketRouter.post("/trade", async (req: AuthedRequest, res) => {
  const parsed = tradeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid trade request" });
    return;
  }
  const { resourceType, side, quantity } = parsed.data;

  const settlement = await prisma.settlement.findUnique({
    where: { playerId: req.playerId! },
    include: { buildings: true },
  });
  if (!settlement) {
    res.status(404).json({ error: "No settlement found for this player" });
    return;
  }

  const market = await prisma.marketResource.findUnique({ where: { resourceType } });
  if (!market) {
    res.status(404).json({ error: "Market not initialized yet" });
    return;
  }

  const hasMarketplace = settlement.buildings.some((b) => b.type === "marketplace");
  const fee = hasMarketplace ? TRADE_FEE.withMarketplace : TRADE_FEE.base;

  if (side === "sell") {
    if (settlement[resourceType] < quantity) {
      res.status(400).json({ error: `Not enough ${resourceType} to sell` });
      return;
    }
    const grossProceeds = quantity * market.price * (1 - fee);

    const government = await prisma.government.findUnique({ where: { playerId: req.playerId! } });
    const tax = government ? grossProceeds * government.incomeTaxRate : 0;
    const proceeds = grossProceeds - tax;

    const updates = [
      prisma.settlement.update({
        where: { id: settlement.id },
        data: {
          [resourceType]: settlement[resourceType] - quantity,
          gold: settlement.gold + proceeds,
        },
      }),
      prisma.marketTrade.create({
        data: { settlementId: settlement.id, resourceType, side, quantity, price: market.price },
      }),
    ];
    if (government && tax > 0) {
      updates.push(prisma.government.update({ where: { id: government.id }, data: { treasury: { increment: tax } } }));
    }

    await prisma.$transaction(updates);
    const newPrice = await applyTradeImpact(resourceType, "sell", quantity);
    res.json({ ok: true, proceeds, tax, newPrice });
    return;
  }

  const cost = quantity * market.price * (1 + fee);
  if (settlement.gold < cost) {
    res.status(400).json({ error: "Not enough gold for that purchase" });
    return;
  }
  const newAmount = Math.min(settlement.storageCap, settlement[resourceType] + quantity);

  await prisma.$transaction([
    prisma.settlement.update({
      where: { id: settlement.id },
      data: { [resourceType]: newAmount, gold: settlement.gold - cost },
    }),
    prisma.marketTrade.create({
      data: { settlementId: settlement.id, resourceType, side, quantity, price: market.price },
    }),
  ]);
  const newPrice = await applyTradeImpact(resourceType, "buy", quantity);
  res.json({ ok: true, cost, newPrice });
});
