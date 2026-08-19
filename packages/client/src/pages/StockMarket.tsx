import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { COMPANY_INDUSTRIES } from "@dominion/shared";
import { api, ApiError, type StockSummary } from "../api/client.js";
import { useGameState, usePortfolio, useStockDetail, useStocks } from "../api/hooks.js";
import Sparkline from "../components/Sparkline.js";

const STOCK_ACCENT = "var(--series-goods)";

function formatSigned(value: number, digits = 1): string {
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return `±0`;
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

type StockSortKey = "sharePrice" | "marketCap" | "profitRatePerHour";

function SortableHeader({
  label,
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <th className="sortable-header" onClick={onClick}>
      {label}
      {active && <span className="sortable-header__arrow">{direction === "asc" ? "▲" : "▼"}</span>}
    </th>
  );
}

function StockDetailPanel({ companyId }: { companyId: string }) {
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

  if (!stock) return <div className="loading">Loading stock...</div>;

  const prices = stock.history.map((h) => h.price);
  const profitClass = stock.profitRatePerHour >= 0 ? "up" : "down";

  return (
    <div>
      <div className="stat-tile-row" style={{ marginBottom: 16 }}>
        <div className="stat-tile">
          <div className="stat-tile__label">
            <span className="resource-pill__dot" style={{ background: STOCK_ACCENT }} />
            {stock.name}
          </div>
          <div className="stat-tile__value">{stock.sharePrice.toFixed(2)}g</div>
          <div className={`stat-tile__delta stat-tile__delta--${profitClass}`}>
            {formatSigned(stock.profitRatePerHour, 2)}g/hr profit rate
          </div>
          <div className="stat-tile__spark">
            <Sparkline values={prices.length > 1 ? prices : [stock.sharePrice, stock.sharePrice]} accentColor={STOCK_ACCENT} />
          </div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile__label">Market cap</div>
          <div className="stat-tile__value">{stock.marketCap.toFixed(0)}g</div>
          <div className="stat-tile__delta">{stock.sharesOutstanding} shares outstanding</div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile__label">Cash on hand</div>
          <div className="stat-tile__value">{stock.cash.toFixed(0)}g</div>
          <div className="stat-tile__delta">{stock.workersAssigned} employees</div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile__label">Controlling shareholder</div>
          <div className="stat-tile__value" style={{ fontSize: 18 }}>
            {stock.controllerLabel}
          </div>
          <div className="stat-tile__delta">Majority (&gt;50%) control changes hands automatically</div>
        </div>
      </div>

      <div className="card">
        <h2 className="card__title">Trade Shares</h2>
        {error && <div className="auth-error">{error}</div>}
        {message && !error && <div className="suggestion">{message}</div>}
        <div className="trade-row">
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
            You have {Math.round(gameState.settlement.gold)} gold available.
          </p>
        )}
      </div>

      <div className="card">
        <h2 className="card__title">Top Shareholders</h2>
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
      </div>
    </div>
  );
}

export default function StockMarket() {
  const { data: stocks, isLoading } = useStocks();
  const { data: portfolio } = usePortfolio();
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [industryFilter, setIndustryFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState<"all" | "player" | "npc">("all");
  const [sort, setSort] = useState<{ key: StockSortKey; direction: "asc" | "desc" }>({
    key: "marketCap",
    direction: "desc",
  });

  const portfolioValue = portfolio?.holdings.reduce((sum, h) => sum + h.value, 0) ?? 0;

  const visibleStocks = useMemo(() => {
    const all = stocks?.stocks ?? [];
    const filtered = all.filter((s) => {
      if (search && !s.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (industryFilter !== "all" && s.industry !== industryFilter) return false;
      if (ownerFilter === "player" && !s.isPlayerOwned) return false;
      if (ownerFilter === "npc" && s.isPlayerOwned) return false;
      return true;
    });
    const dir = sort.direction === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => (a[sort.key] - b[sort.key]) * dir);
  }, [stocks, search, industryFilter, ownerFilter, sort]);

  const toggleSort = (key: StockSortKey) => {
    setSort((prev) =>
      prev.key === key ? { key, direction: prev.direction === "asc" ? "desc" : "asc" } : { key, direction: "desc" },
    );
  };

  return (
    <div className="page page--full">
      <div className="card">
        <h2 className="card__title">Stock Market</h2>
        {isLoading || !stocks ? (
          <div className="loading">Loading stocks...</div>
        ) : stocks.stocks.length === 0 ? (
          <div className="empty-state">No companies have gone public yet.</div>
        ) : (
          <>
            <div className="filter-row">
              <input
                type="text"
                placeholder="Search companies..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select value={industryFilter} onChange={(e) => setIndustryFilter(e.target.value)}>
                <option value="all">All industries</option>
                {Object.values(COMPANY_INDUSTRIES).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
              <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value as typeof ownerFilter)}>
                <option value="all">All owners</option>
                <option value="player">Player-owned</option>
                <option value="npc">NPC-owned</option>
              </select>
            </div>
            {visibleStocks.length === 0 ? (
              <div className="empty-state">No companies match those filters.</div>
            ) : (
              <table className="settlement-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Industry</th>
                    <SortableHeader
                      label="Price"
                      active={sort.key === "sharePrice"}
                      direction={sort.direction}
                      onClick={() => toggleSort("sharePrice")}
                    />
                    <SortableHeader
                      label="Market Cap"
                      active={sort.key === "marketCap"}
                      direction={sort.direction}
                      onClick={() => toggleSort("marketCap")}
                    />
                    <SortableHeader
                      label="Profit/hr"
                      active={sort.key === "profitRatePerHour"}
                      direction={sort.direction}
                      onClick={() => toggleSort("profitRatePerHour")}
                    />
                    <th>Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleStocks.map((s: StockSummary) => (
                    <tr
                      key={s.id}
                      onClick={() => setSelected(s.id)}
                      style={{ cursor: "pointer", background: selected === s.id ? "var(--surface-2)" : undefined }}
                    >
                      <td>{s.name}</td>
                      <td>
                        <span className="archetype-tag">{s.industry}</span>
                      </td>
                      <td>{s.sharePrice.toFixed(2)}g</td>
                      <td>{s.marketCap.toFixed(0)}g</td>
                      <td className={s.profitRatePerHour >= 0 ? "stat-tile__delta--up" : "stat-tile__delta--down"}>
                        {formatSigned(s.profitRatePerHour, 2)}
                      </td>
                      <td>{s.isPlayerOwned ? "Player" : "NPC"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      {selected && <StockDetailPanel companyId={selected} />}

      <div className="card">
        <h2 className="card__title">My Portfolio</h2>
        {!portfolio || portfolio.holdings.length === 0 ? (
          <div className="empty-state">You don't hold any shares yet — pick a company above.</div>
        ) : (
          <>
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
            <p className="suggestion" style={{ marginTop: 8 }}>
              Total portfolio value: {portfolioValue.toFixed(0)}g
            </p>
          </>
        )}
      </div>
    </div>
  );
}
