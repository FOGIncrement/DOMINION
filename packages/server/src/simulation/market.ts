import { prisma } from "../db.js";
import {
  BASE_PRICES,
  MARKET_RESOURCE_TYPES,
  MARKET_TUNING,
  REFERENCE_TICK_HOURS,
  type MarketResourceType,
} from "@dominion/shared";
import { getConfig } from "../gameConfigStore.js";

export type TradeableResource = MarketResourceType;
export const TRADEABLE_RESOURCES: TradeableResource[] = [...MARKET_RESOURCE_TYPES];

export interface ResourceFlow {
  supply: number;
  demand: number;
}

function clampPrice(
  resourceType: TradeableResource,
  price: number,
  basePrices: typeof BASE_PRICES,
  marketTuning: typeof MARKET_TUNING,
): number {
  const base = basePrices[resourceType];
  const min = base * marketTuning.minPriceRatio;
  const max = base * marketTuning.maxPriceRatio;
  return Math.min(max, Math.max(min, price));
}

export async function ensureMarketSeeded() {
  const basePrices = getConfig().BASE_PRICES;
  for (const resourceType of TRADEABLE_RESOURCES) {
    const existing = await prisma.marketResource.findUnique({ where: { resourceType } });
    if (!existing) {
      await prisma.marketResource.create({
        data: {
          resourceType,
          supply: 1,
          demand: 1,
          price: basePrices[resourceType],
        },
      });
    }
  }
}

export async function tickMarket(flows: Record<TradeableResource, ResourceFlow>, elapsedHours: number = REFERENCE_TICK_HOURS) {
  const config = getConfig();
  const stepMultiplier = Math.max(1, elapsedHours / REFERENCE_TICK_HOURS);

  for (const resourceType of TRADEABLE_RESOURCES) {
    const current = await prisma.marketResource.findUniqueOrThrow({ where: { resourceType } });
    const flow = flows[resourceType];

    const smoothedSupply =
      current.supply * (1 - config.MARKET_TUNING.smoothing) + flow.supply * config.MARKET_TUNING.smoothing;
    const smoothedDemand =
      current.demand * (1 - config.MARKET_TUNING.smoothing) + flow.demand * config.MARKET_TUNING.smoothing;

    const safeSupply = Math.max(0.01, smoothedSupply);
    const ratio = smoothedDemand / safeSupply;
    const base = config.BASE_PRICES[resourceType];
    const targetPrice = clampPrice(resourceType, base * ratio, config.BASE_PRICES, config.MARKET_TUNING);

    // Scaled by elapsed time so a big catch-up (offline, or a cheat-forced
    // jump) actually reaches the target instead of taking one normal-sized
    // step regardless of how much time passed — see REFERENCE_TICK_HOURS.
    const maxStep = current.price * config.MARKET_TUNING.maxPriceStepPerTick * stepMultiplier;
    const direction = Math.sign(targetPrice - current.price);
    const step = Math.min(Math.abs(targetPrice - current.price), maxStep);
    const newPrice = clampPrice(resourceType, current.price + direction * step, config.BASE_PRICES, config.MARKET_TUNING);

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
  const config = getConfig();
  const current = await prisma.marketResource.findUniqueOrThrow({ where: { resourceType } });
  const direction = side === "buy" ? 1 : -1;
  const impact = current.price * config.MARKET_TUNING.tradeImpact * quantity * direction;
  const newPrice = clampPrice(resourceType, current.price + impact, config.BASE_PRICES, config.MARKET_TUNING);
  await prisma.marketResource.update({
    where: { resourceType },
    data: { price: newPrice },
  });
  return newPrice;
}
