import { COMPANY_INDUSTRIES, NPC_COMPANY_TUNING } from "@dominion/shared";
import { prisma } from "../db.js";
import { applyTradeImpact, type TradeableResource } from "./market.js";
import type { CompanySnapshot } from "./types.js";

export interface MutableCompanyState {
  cash: number;
  inputStock: number;
  goodsStock: number;
}

/**
 * NPC-owned companies auto-trade every tick: top up input stock when low,
 * sell off goods held above a working buffer. Directly parallel to
 * settleNpcSurplus for NPC settlements. Returns revenue earned this tick so
 * the caller can credit totalRevenue — without this, NPC company P&L (and
 * therefore stock valuation) never reflects their actual goods sales.
 */
export async function settleNpcCompanyTrading(
  company: CompanySnapshot,
  state: MutableCompanyState,
  prices: Record<TradeableResource, number>,
): Promise<number> {
  const industry = COMPANY_INDUSTRIES[company.industry];
  const inputPrice = prices[industry.inputResource];
  let revenue = 0;

  if (state.inputStock < NPC_COMPANY_TUNING.inputBuffer && state.cash > 0) {
    const need = NPC_COMPANY_TUNING.inputBuffer - state.inputStock;
    const affordable = state.cash / inputPrice;
    const toBuy = Math.max(0, Math.min(need, affordable));
    if (toBuy > 0.01) {
      state.inputStock += toBuy;
      state.cash -= toBuy * inputPrice;
      await applyTradeImpact(industry.inputResource, "buy", toBuy);
    }
  }

  if (state.goodsStock > NPC_COMPANY_TUNING.goodsSellBuffer) {
    const excess = state.goodsStock - NPC_COMPANY_TUNING.goodsSellBuffer;
    state.goodsStock -= excess;
    revenue = excess * prices.goods;
    state.cash += revenue;
    await applyTradeImpact("goods", "sell", excess);
  }

  return revenue;
}

/** Small chance for a cash-rich NPC company to hire another worker, mirroring maybeExpand for settlements. */
export async function maybeHire(company: CompanySnapshot, state: MutableCompanyState): Promise<void> {
  const industry = COMPANY_INDUSTRIES[company.industry];
  if (company.workersAssigned >= industry.maxWorkers) return;
  if (state.cash < NPC_COMPANY_TUNING.minCashToHire) return;
  if (Math.random() > NPC_COMPANY_TUNING.hireChancePerTick) return;

  await prisma.company.update({
    where: { id: company.id },
    data: { workersAssigned: company.workersAssigned + 1 },
  });
}
