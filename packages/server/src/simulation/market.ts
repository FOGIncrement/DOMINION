import { prisma } from "../db.js";
import { BASE_PRICES, MARKET_TUNING } from "@dominion/shared";

export type TradeableResource = "food" | "wood" | "stone";
export const TRADEABLE_RESOURCES: TradeableResource[] = ["food", "wood", "stone"];

export interface ResourceFlow {
  supply: number;
  demand: number;
}

function clampPrice(resourceType: TradeableResource, price: number): number {
  const base = BASE_PRICES[resourceType];
  const min = base * MARKET_TUNING.minPriceRatio;
  const max = base * MARKET_TUNING.maxPriceRatio;
  return Math.min(max, Math.max(min, price));
}

export async function ensureMarketSeeded() {
  for (const resourceType of TRADEABLE_RESOURCES) {
    const existing = await prisma.marketResource.findUnique({ where: { resourceType } });
    if (!existing) {
      await prisma.marketResource.create({
        data: {
          resourceType,
          supply: 1,
          demand: 1,
          price: BASE_PRICES[resourceType],
        },
      });
    }
  }
}

export async function tickMarket(flows: Record<TradeableResource, ResourceFlow>) {
  for (const resourceType of TRADEABLE_RESOURCES) {
    const current = await prisma.marketResource.findUniqueOrThrow({ where: { resourceType } });
    const flow = flows[resourceType];

    const smoothedSupply =
      current.supply * (1 - MARKET_TUNING.smoothing) + flow.supply * MARKET_TUNING.smoothing;
    const smoothedDemand =
      current.demand * (1 - MARKET_TUNING.smoothing) + flow.demand * MARKET_TUNING.smoothing;

    const safeSupply = Math.max(0.01, smoothedSupply);
    const ratio = smoothedDemand / safeSupply;
    const base = BASE_PRICES[resourceType];
    const targetPrice = clampPrice(resourceType, base * ratio);

    const maxStep = current.price * MARKET_TUNING.maxPriceStepPerTick;
    const direction = Math.sign(targetPrice - current.price);
    const step = Math.min(Math.abs(targetPrice - current.price), maxStep);
    const newPrice = clampPrice(resourceType, current.price + direction * step);

    await prisma.marketResource.update({
      where: { resourceType },
      data: {
        supply: smoothedSupply,
        demand: smoothedDemand,
        price: newPrice,
        updatedAt: new Date(),
      },
    });

    await prisma.priceHistoryPoint.create({
      data: { resourceType, price: newPrice },
    });
  }
}

export async function applyTradeImpact(
  resourceType: TradeableResource,
  side: "buy" | "sell",
  quantity: number,
): Promise<number> {
  const current = await prisma.marketResource.findUniqueOrThrow({ where: { resourceType } });
  const direction = side === "buy" ? 1 : -1;
  const impact = current.price * MARKET_TUNING.tradeImpact * quantity * direction;
  const newPrice = clampPrice(resourceType, current.price + impact);
  await prisma.marketResource.update({
    where: { resourceType },
    data: { price: newPrice },
  });
  return newPrice;
}
