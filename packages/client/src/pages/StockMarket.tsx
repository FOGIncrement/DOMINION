import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { COMPANY_INDUSTRIES, type CompanyIndustryId } from "@dominion/shared";
import { api, ApiError, type StockSummary } from "../api/client.js";
import { useGameState, usePortfolio, useStockDetail, useStocks } from "../api/hooks.js";
import { CompanyAvatar } from "../industryMeta.js";
import Sparkline from "../components/Sparkline.js";

const STOCK_ACCENT = "var(--series-goods)";

function formatSigned(value: number, digits = 1): string {
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return `±0`;
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

type SortKey = "marketCap" | "sharePrice" | "profitRatePerHour";
const SORT_LABELS: Record<SortKey, string> = {
  marketCap: "Market cap",
  sharePrice: "Price",
  profitRatePerHour: "Profit/hr",
};

function PortfolioSummary() {
  const { data: portfolio } = usePortfolio();

  if (!portfolio || portfolio.holdings.length === 0) return null;

  const totalValue = portfolio.holdings.reduce((sum, h) => sum + h.value, 0);

  return (
    <div className="card">
      <h2 className="card__title">My Portfolio</h2>
      <div className="summary-bar">
        <div className="summary-stat">
          <div className="summary-stat__label">Holdings</div>
          <div className="summary-stat__value">{portfolio.holdings.length}</div>
        </div>
        <div className="summary-stat">
          <div className="summary-stat__label">Total value</div>
          <div className="summary-stat__value">{totalValue.toFixed(0)}g</div>
        </div>
      </div>
      <div className="scroll-table">
        <table className="settlement-table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Shares</th>
              <th>Price</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {portfolio.holdings.map((h) => (
              <tr key={h.companyId}>
                <td>{h.companyName}</td>
                <td>{h.shares.toFixed(1)}</td>
                <td>{h.sharePrice.toFixed(2)}g</td>
                <td>{h.value.toFixed(0)}g</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StockDetail({ companyId }: { companyId: string }) {
  const { data: stock } = useStockDetail(companyId);
  const { data: gameState } = useGameState();
  const queryClient = useQueryClient();
  const [shares, setShares] = useState(5);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["stockDetail", companyId] });
    queryClient.invalidateQueries({ queryKey: ["stocks"] });
    queryClient.invalidateQueries({ queryKey: ["portfolio"] });
    queryClient.invalidateQueries({ queryKey: ["gameState"] });
  };

  const buy = useMutation({
    mutationFn: () => api.tradeStock(companyId, "buy", shares),
    onSuccess: (res) => {
      setError(null);
      setMessage(`Bought ${shares} shares for ${res.cost?.toFixed(0)} gold.`);
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Buy failed"),
  });

  const sell = useMutation({
    mutationFn: () => api.tradeStock(companyId, "sell", shares),
    onSuccess: (res) => {
      setError(null);
      setMessage(`Sold ${shares} shares for ${res.proceeds?.toFixed(0)} gold.`);
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Sell failed"),
  });

  if (!stock) return <div className="empty-state">Loading stock...</div>;

  const prices = stock.history.map((h) => h.price);
  const profitClass = stock.profitRatePerHour >= 0 ? "up" : "down";

  return (
    <>
      <div className="cc-detail__header">
        <div className="cc-detail__title-row">
          <CompanyAvatar industry={stock.industry as CompanyIndustryId} size="lg" />
          <div>
            <div className="cc-detail__title-row">
              <span className="cc-detail__name">{stock.name}</span>
              <span className="archetype-tag">{COMPANY_INDUSTRIES[stock.industry as CompanyIndustryId]?.name}</span>
            </div>
            <div className="cc-detail__meta">{stock.sharePrice.toFixed(2)}g/share · {stock.controllerLabel}</div>
          </div>
        </div>
        <Sparkline values={prices.length > 1 ? prices : [stock.sharePrice, stock.sharePrice]} accentColor={STOCK_ACCENT} />
      </div>

      <div className="cc-stat-grid">
        <div className="cc-stat-tile">
          <div className="cc-stat-tile__label">Share price</div>
          <div className="cc-stat-tile__value">{stock.sharePrice.toFixed(2)}g</div>
        </div>
        <div className="cc-stat-tile">
          <div className="cc-stat-tile__label">Profit/hr</div>
          <div className={`cc-stat-tile__value stat-tile__delta--${profitClass}`}>
            {formatSigned(stock.profitRatePerHour, 2)}g
          </div>
        </div>
        <div className="cc-stat-tile">
          <div className="cc-stat-tile__label">Market cap</div>
          <div className="cc-stat-tile__value">{stock.marketCap.toFixed(0)}g</div>
        </div>
        <div className="cc-stat-tile">
          <div className="cc-stat-tile__label">Shares outstanding</div>
          <div className="cc-stat-tile__value">{stock.sharesOutstanding}</div>
        </div>
        <div className="cc-stat-tile">
          <div className="cc-stat-tile__label">Cash on hand</div>
          <div className="cc-stat-tile__value">{stock.cash.toFixed(0)}g</div>
        </div>
        <div className="cc-stat-tile">
          <div className="cc-stat-tile__label">Employees</div>
          <div className="cc-stat-tile__value">{stock.workersAssigned}</div>
        </div>
      </div>

      <div className="cc-info-box">
        Majority (&gt;50%) control changes hands automatically — the controlling shareholder shown above may be a
        player or an NPC investor, not necessarily whoever founded the company.
      </div>

      <div className="card-section-label" style={{ marginTop: 0 }}>Trade Shares</div>
      {error && <div className="auth-error">{error}</div>}
      {message && !error && <div className="suggestion">{message}</div>}
      <div className="trade-row" style={{ marginTop: 0 }}>
        <input type="number" min={1} value={shares} onChange={(e) => setShares(Math.max(1, Number(e.target.value)))} />
        <button className="btn btn--accent" disabled={buy.isPending} onClick={() => buy.mutate()}>
          Buy
        </button>
        <button className="btn" disabled={sell.isPending} onClick={() => sell.mutate()}>
          Sell
        </button>
      </div>
      {gameState && (
        <p className="suggestion" style={{ marginTop: 8 }}>
          You have {Math.floor(gameState.settlement.gold)} gold available.
        </p>
      )}

      <div className="card-section-label">Top Shareholders</div>
      {stock.topShareholders.length === 0 ? (
        <div className="empty-state">No shares issued to anyone yet.</div>
      ) : (
        <table className="settlement-table">
          <thead>
            <tr>
              <th>Holder</th>
              <th>Shares</th>
              <th>% of company</th>
            </tr>
          </thead>
          <tbody>
            {stock.topShareholders.map((sh, i) => (
              <tr key={i}>
                <td>
                  {sh.name}
                  {sh.isPlayer && " (Player)"}
                </td>
                <td>{sh.shares.toFixed(1)}</td>
                <td>{sh.percent.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export default function StockMarket() {
  const { data: stocks, isLoading } = useStocks();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [industryFilter, setIndustryFilter] = useState<"all" | CompanyIndustryId>("all");
  const [ownerFilter, setOwnerFilter] = useState<"all" | "player" | "npc">("all");
  const [sortKey, setSortKey] = useState<SortKey>("marketCap");

  const allStocks = stocks?.stocks ?? [];
  const industriesInUse = [...new Set(allStocks.map((s) => s.industry as CompanyIndustryId))];

  const visibleStocks = useMemo(() => {
    const filtered = allStocks.filter((s) => {
      if (search && !s.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (industryFilter !== "all" && s.industry !== industryFilter) return false;
      if (ownerFilter === "player" && !s.isPlayerOwned) return false;
      if (ownerFilter === "npc" && s.isPlayerOwned) return false;
      return true;
    });
    return [...filtered].sort((a, b) => b[sortKey] - a[sortKey]);
  }, [allStocks, search, industryFilter, ownerFilter, sortKey]);

  // Defaults to whatever currently heads the sorted/filtered list, so the
  // highlighted sidebar row always matches the top row on first paint.
  useEffect(() => {
    if (!selectedId && visibleStocks.length > 0) setSelectedId(visibleStocks[0].id);
  }, [visibleStocks, selectedId]);

  return (
    <div className="page page--full">
      <PortfolioSummary />

      <div className="cc-shell">
        {isLoading || !stocks ? (
          <div style={{ padding: 20 }}>
            <div className="loading">Loading stocks...</div>
          </div>
        ) : allStocks.length === 0 ? (
          <div style={{ padding: 20 }}>
            <div className="empty-state">No companies have gone public yet.</div>
          </div>
        ) : (
          <>
            <div className="cc-toolbar">
              <input type="text" placeholder="Search companies..." value={search} onChange={(e) => setSearch(e.target.value)} />
              <div className="cc-chips">
                <button className={`cc-chip${industryFilter === "all" ? " cc-chip--active" : ""}`} onClick={() => setIndustryFilter("all")}>
                  All
                </button>
                {industriesInUse.map((id) => (
                  <button key={id} className={`cc-chip${industryFilter === id ? " cc-chip--active" : ""}`} onClick={() => setIndustryFilter(id)}>
                    {COMPANY_INDUSTRIES[id].name}
                  </button>
                ))}
              </div>
              <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value as typeof ownerFilter)}>
                <option value="all">All owners</option>
                <option value="player">Player-owned</option>
                <option value="npc">NPC-owned</option>
              </select>
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
                {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                  <option key={key} value={key}>
                    Sort: {SORT_LABELS[key]}
                  </option>
                ))}
              </select>
            </div>

            <div className="cc-body">
              <div className="cc-sidebar">
                <div className="cc-sidebar__head">
                  <span className="cc-sidebar__head-label">Companies</span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{visibleStocks.length}</span>
                </div>
                <div className="cc-sidebar__list">
                  {visibleStocks.length === 0 ? (
                    <div className="empty-state">No companies match those filters.</div>
                  ) : (
                    visibleStocks.map((s: StockSummary) => (
                      <button
                        key={s.id}
                        className={`cc-row${s.id === selectedId ? " cc-row--selected" : ""}`}
                        onClick={() => setSelectedId(s.id)}
                      >
                        <CompanyAvatar industry={s.industry as CompanyIndustryId} />
                        <div className="cc-row__body">
                          <div className="cc-row__name-line">
                            <span className="cc-row__name">{s.name}</span>
                          </div>
                          <div className="cc-row__meta">
                            {COMPANY_INDUSTRIES[s.industry as CompanyIndustryId]?.name} · {s.isPlayerOwned ? "Player" : "NPC"}
                          </div>
                        </div>
                        <div className="cc-row__right">
                          <div className="cc-row__cash">{s.sharePrice.toFixed(2)}g</div>
                          <div className="icon-row__meta" style={{ color: s.profitRatePerHour >= 0 ? "var(--success)" : "var(--critical)" }}>
                            {formatSigned(s.profitRatePerHour, 1)}/hr
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="cc-detail">
                {!selectedId ? (
                  <div className="empty-state">Select a company from the list.</div>
                ) : (
                  <StockDetail companyId={selectedId} />
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
