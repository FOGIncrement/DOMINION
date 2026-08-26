import { getConfig } from "../gameConfigStore.js";
import { applyTradeImpact, type TradeableResource } from "./market.js";
import { STOCK_BUFFER, type MutableResources } from "./npcEconomy.js";
import type { CompanySnapshot, SettlementSnapshot } from "./types.js";

export interface DirectSaleResult {
  companyId: string;
  quantity: number;
  revenue: number;
}

/**
 * A settlement buying directly from a company its own player owns — Retail
 * (food) and Bakery-as-luxury (goods) below. Mutates the winning company's
 * goodsStock/cash on the same CompanySnapshot object already sitting in the
 * tick's `companies` array; never writes to the DB. That array is loaded
 * once at the top of runTick(), before the settlement loop runs — the
 * company loop (which runs after every settlement is already persisted)
 * writes each company with an absolute value computed from that same
 * object, so a DB write made here would just be silently clobbered a moment
 * later. Mutating in place means that later write picks up the change
 * automatically (verified against tickCompany, which reads
 * company.goodsStock/cash straight off the snapshot it's given).
 */
export function buyFromOwnedCompany(
  candidates: CompanySnapshot[],
  desiredQuantity: number,
  goldBudget: number,
  unitPrice: number,
): DirectSaleResult | null {
  if (desiredQuantity <= 0.01 || goldBudget <= 0 || candidates.length === 0) return null;

  // Deepest-stocked company gets first crack — an arbitrary but stable
  // tie-break for a player who owns more than one of the same industry.
  const company = [...candidates].sort((a, b) => b.goodsStock - a.goodsStock)[0];
  if (company.goodsStock <= 0.01) return null;

  const affordable = goldBudget / unitPrice;
  const quantity = Math.max(0, Math.min(desiredQuantity, affordable, company.goodsStock));
  if (quantity <= 0.01) return null;

  const revenue = quantity * unitPrice;
  company.goodsStock -= quantity;
  company.cash += revenue;
  return { companyId: company.id, quantity, revenue };
}

/**
 * Tops a settlement's food up toward the same STOCK_BUFFER.food target the
 * shared-market fallback (maybeCoverFoodShortfall) uses, but without that
 * function's low (30) trigger threshold — that threshold exists to stop
 * shared-market buy/sell thrashing, which doesn't apply here since this
 * trade never touches the market. Retail is meant to be an ongoing consumer
 * channel, not an emergency-only backstop, so it engages any time food is
 * below the target. Synchronous and DB-free — see buyFromOwnedCompany.
 */
export function maybeBuyFromOwnedRetail(
  retailCompanies: CompanySnapshot[],
  state: MutableResources,
  prices: Record<TradeableResource, number>,
): DirectSaleResult | null {
  if (state.gold <= 0) return null;
  const need = STOCK_BUFFER.food - state.food;
  if (need <= 0.01) return null;

  const price = prices.food * getConfig().RETAIL_TUNING.markup;
  const sale = buyFromOwnedCompany(retailCompanies, need, state.gold, price);
  if (sale) {
    state.food += sale.quantity;
    state.gold -= sale.revenue;
  }
  return sale;
}

/**
 * Player-settlement-only luxury lever: spend a bounded slice of on-hand gold
 * on Bakery-made "goods" for a happiness boost beyond plain food
 * sufficiency, preferring a Bakery this settlement's own player owns before
 * falling back to the shared market. Unlike the owned-company path, the
 * market fallback DOES call applyTradeImpact — there's no guaranteed
 * private counterparty there, so it's a real market trade. No
 * Settlement.goods field exists or is added: goods bought this way are
 * consumed for happiness the instant they're bought, never stockpiled.
 */
export async function applyLuxuryGoodsPurchase(
  settlement: SettlementSnapshot,
  state: MutableResources,
  prices: Record<TradeableResource, number>,
  bakeryCompanies: CompanySnapshot[],
  elapsedHours: number,
): Promise<{ happinessBoost: number; sale: DirectSaleResult | null }> {
  const luxuryTuning = getConfig().LUXURY_GOODS_TUNING;
  const desired = settlement.population.count * luxuryTuning.goodsWantedPerCapitaPerHour * elapsedHours;
  if (desired <= 0.01 || state.gold <= 0) return { happinessBoost: 0, sale: null };

  const goldBudget = state.gold * luxuryTuning.maxGoldSpendFraction;
  const price = prices.goods * luxuryTuning.markup;

  const sale = buyFromOwnedCompany(bakeryCompanies, desired, goldBudget, price);
  let fulfilled = sale?.quantity ?? 0;
  let spent = sale?.revenue ?? 0;

  const remainingDesired = desired - fulfilled;
  const remainingBudget = goldBudget - spent;
  if (remainingDesired > 0.01 && remainingBudget > 0.01) {
    const marketQuantity = Math.max(0, Math.min(remainingDesired, remainingBudget / price));
    if (marketQuantity > 0.01) {
      await applyTradeImpact("goods", "buy", marketQuantity);
      fulfilled += marketQuantity;
      spent += marketQuantity * price;
    }
  }

  state.gold -= spent;
  const happinessBoost = luxuryTuning.happinessBoostPerHour * (fulfilled / desired) * elapsedHours;
  return { happinessBoost, sale };
}
