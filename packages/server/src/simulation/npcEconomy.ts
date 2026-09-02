import { applyTradeImpact, type TradeableResource } from "./market.js";

// Exported: directSales.ts shares this same buffer target for the
// owned-Retail purchase path, so the two mechanisms top off toward one
// consistent number instead of drifting apart.
export const STOCK_BUFFER: Record<"food", number> = { food: 80 };

// Buy food once stock drops this low — well under the sell buffer (80) so
// buying and selling can never thrash against each other in the same tick.
export const FOOD_SHORTAGE_BUY_THRESHOLD = 30;

export interface MutableResources {
  food: number;
  gold: number;
}

/**
 * A settlement short on food beyond its own production buys the shortfall
 * from the shared world market — the last-resort fallback once a player
 * settlement's owned Retail company (see maybeBuyFromOwnedRetail in
 * directSales.ts, tried first) can't fully cover the need, or has none.
 * Runs for every settlement, player and NPC alike: NPC settlements never
 * had any alternative here since they can't own a Retail company, and
 * player settlements had *no* safety net at all before this was extended to
 * them — not parity with NPCs, strictly worse, since an absent player's
 * nation could starve to zero with nothing to stop it. Since the legacy
 * Farm building was removed (2026-09-03), this is now every settlement's
 * primary food source too, not just a fallback — backed by the new
 * land-gated `farm` company (see COMPANY_INDUSTRIES) actually supplying the
 * market, not just demand-side buying with nothing behind it.
 */
export async function maybeCoverFoodShortfall(
  state: MutableResources,
  prices: Record<TradeableResource, number>,
): Promise<void> {
  if (state.food >= FOOD_SHORTAGE_BUY_THRESHOLD || state.gold <= 0) return;

  const price = prices.food;
  const need = STOCK_BUFFER.food - state.food;
  const affordable = state.gold / price;
  const toBuy = Math.max(0, Math.min(need, affordable));
  if (toBuy > 0.01) {
    state.food += toBuy;
    state.gold -= toBuy * price;
    await applyTradeImpact("food", "buy", toBuy);
  }
}
