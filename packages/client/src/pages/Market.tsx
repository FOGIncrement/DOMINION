import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { RESOURCE_LABELS } from "@dominion/shared";
import { api, ApiError } from "../api/client.js";
import { useGameState, useMarket } from "../api/hooks.js";
import Sparkline from "../components/Sparkline.js";

// Settlements only ever hold food directly now (wood/stone removed with the
// legacy building economy) — every other market commodity trades through
// companies (Companies page) instead.
type MarketDisplayResource = "food" | "goods";

const DISPLAY_RESOURCES: MarketDisplayResource[] = ["food", "goods"];

const ACCENT: Record<MarketDisplayResource, string> = {
  food: "var(--series-food)",
  goods: "var(--series-goods)",
};

const LABELS: Record<MarketDisplayResource, string> = {
  ...RESOURCE_LABELS,
  goods: "Goods",
};

export default function Market() {
  const { data: market, isLoading } = useMarket();
  const { data: gameState } = useGameState();
  const queryClient = useQueryClient();

  const resourceType = "food" as const;
  const [side, setSide] = useState<"buy" | "sell">("sell");
  const [quantity, setQuantity] = useState(10);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trade = useMutation({
    mutationFn: () => api.trade(resourceType, side, quantity),
    onSuccess: (res) => {
      setError(null);
      const taxNote = res.tax && res.tax > 0 ? ` (${res.tax.toFixed(0)}g income tax)` : "";
      setResult(
        side === "sell"
          ? `Sold ${quantity} ${resourceType} for ${res.proceeds?.toFixed(0) ?? "?"} gold${taxNote}. New price: ${res.newPrice.toFixed(2)}.`
          : `Bought ${quantity} ${resourceType} for ${res.cost?.toFixed(0) ?? "?"} gold. New price: ${res.newPrice.toFixed(2)}.`,
      );
      queryClient.invalidateQueries({ queryKey: ["gameState"] });
      queryClient.invalidateQueries({ queryKey: ["market"] });
      queryClient.invalidateQueries({ queryKey: ["government"] });
    },
    onError: (err) => {
      setResult(null);
      setError(err instanceof ApiError ? err.message : "Trade failed");
    },
  });

  if (isLoading || !market) {
    return (
      <div className="page page--full">
        <div className="loading">Loading market...</div>
      </div>
    );
  }

  return (
    <div className="page page--full">
      <div>
        <div className="stat-tile-row">
          {DISPLAY_RESOURCES.map((type) => {
            const resource = market.resources.find((r) => r.resourceType === type);
            const points = market.history.filter((h) => h.resourceType === type).slice(-30);
            const prices = points.map((p) => p.price);
            const first = prices[0];
            const last = resource?.price ?? prices[prices.length - 1] ?? 0;
            const delta = first !== undefined ? last - first : 0;
            const deltaClass = delta > 0.001 ? "up" : delta < -0.001 ? "down" : "";

            return (
              <div className="stat-tile" key={type}>
                <div className="stat-tile__label">
                  <span className="resource-pill__dot" style={{ background: ACCENT[type] }} />
                  {LABELS[type]}
                </div>
                <div className="stat-tile__value">{last.toFixed(2)}g</div>
                {first !== undefined && (
                  <div className={`stat-tile__delta${deltaClass ? ` stat-tile__delta--${deltaClass}` : ""}`}>
                    {delta >= 0 ? "+" : ""}
                    {delta.toFixed(2)} recently
                  </div>
                )}
                {type === "goods" && <div className="stat-tile__delta">Traded via your companies</div>}
                <div className="stat-tile__spark">
                  <Sparkline values={prices.length > 1 ? prices : [last, last]} accentColor={ACCENT[type]} />
                </div>
              </div>
            );
          })}
        </div>

        <div className="card">
          <h2 className="card__title">Trade</h2>
          {error && <div className="auth-error">{error}</div>}
          {result && <div className="suggestion">{result}</div>}
          <div className="trade-row">
            <span className="suggestion" style={{ padding: 0, border: "none" }}>
              {RESOURCE_LABELS.food}
            </span>
            <select value={side} onChange={(e) => setSide(e.target.value as "buy" | "sell")}>
              <option value="sell">Sell</option>
              <option value="buy">Buy</option>
            </select>
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
            />
            <button className="btn btn--accent" disabled={trade.isPending} onClick={() => trade.mutate()}>
              {side === "sell" ? "Sell" : "Buy"}
            </button>
          </div>
          {gameState && (
            <p className="suggestion" style={{ marginTop: 10 }}>
              You hold {Math.floor(gameState.settlement[resourceType])} {resourceType} and{" "}
              {Math.floor(gameState.settlement.gold)} gold.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
