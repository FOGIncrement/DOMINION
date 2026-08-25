import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { COMPANY_INDUSTRIES, CONTRACT_TERM_HOURS_OPTIONS, RESOURCE_LABELS, STOCK_TUNING, type CompanyIndustryId, type MarketResourceType, type ResourceType } from "@dominion/shared";
import { api, ApiError, type MyCompany, type MyContract } from "../api/client.js";
import { useAllCompanies, useGameState, useMarket, useMyCompanies, useMyContracts } from "../api/hooks.js";

// RESOURCE_LABELS covers settlement-holdable resources only — "goods" is a
// market resource with no settlement equivalent, so it needs its own entry
// here (mirrors the same extension Market.tsx already does).
const OUTPUT_LABELS: Record<MarketResourceType, string> = { ...RESOURCE_LABELS, goods: "Goods" };

function CompanyCard({ company }: { company: MyCompany }) {
  const industry = COMPANY_INDUSTRIES[company.industry as CompanyIndustryId];
  const queryClient = useQueryClient();
  const { data: gameState } = useGameState();
  const [buyQty, setBuyQty] = useState(20);
  const [sellQty, setSellQty] = useState(10);
  const [withdrawAmt, setWithdrawAmt] = useState(10);
  const [bailoutAmt, setBailoutAmt] = useState(Math.max(1, Math.ceil(-company.cash)));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["myCompanies"] });
    queryClient.invalidateQueries({ queryKey: ["gameState"] });
    queryClient.invalidateQueries({ queryKey: ["allCompanies"] });
    queryClient.invalidateQueries({ queryKey: ["government"] });
  };

  const setWorkers = useMutation({
    mutationFn: (workers: number) => api.setCompanyWorkers(company.id, workers),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiError ? err.message : "Couldn't update workers"),
  });

  const buy = useMutation({
    mutationFn: () => api.tradeCompany(company.id, "buy", buyQty),
    onSuccess: (res) => {
      setError(null);
      setMessage(`Bought ${buyQty} ${industry.inputResource ? OUTPUT_LABELS[industry.inputResource] : ""} for ${res.cost?.toFixed(0)} gold.`);
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Buy failed"),
  });

  const sell = useMutation({
    mutationFn: () => api.tradeCompany(company.id, "sell", sellQty),
    onSuccess: (res) => {
      setError(null);
      const taxNote = res.tax && res.tax > 0 ? ` (${res.tax.toFixed(0)}g corporate tax)` : "";
      setMessage(`Sold ${sellQty} ${OUTPUT_LABELS[industry.outputResource]} for ${res.proceeds?.toFixed(0)} gold${taxNote}.`);
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Sell failed"),
  });

  const withdraw = useMutation({
    mutationFn: () => api.withdrawCompanyCash(company.id, withdrawAmt),
    onSuccess: () => {
      setError(null);
      setMessage(`Withdrew ${withdrawAmt} gold to your settlement.`);
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Withdraw failed"),
  });

  const ipo = useMutation({
    mutationFn: () => api.ipoCompany(company.id),
    onSuccess: (res) => {
      setError(null);
      setMessage(`Went public at ${res.sharePrice.toFixed(2)}g/share (${res.sharesOutstanding} shares).`);
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "IPO failed"),
  });

  const upgrade = useMutation({
    mutationFn: () => api.upgradeCompany(company.id),
    onSuccess: (res) => {
      setError(null);
      setMessage(`Upgraded to level ${res.level} for ${res.cost.toFixed(0)} gold.`);
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Upgrade failed"),
  });

  const bailout = useMutation({
    mutationFn: () => api.bailoutCompany(company.id, bailoutAmt),
    onSuccess: (res) => {
      setError(null);
      setMessage(
        res.remainingDeficit > 0
          ? `Paid down ${res.amount.toFixed(0)} gold of debt — ${res.remainingDeficit.toFixed(0)}g still owed.`
          : `Paid off ${res.amount.toFixed(0)} gold of debt — the company is back in the black.`,
      );
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Bailout failed"),
  });

  const close = useMutation({
    mutationFn: () => api.closeCompany(company.id),
    onSuccess: (res) => {
      setError(null);
      setMessage(
        res.recoveredCash > 0
          ? `Closed ${company.name}, recovering ${res.recoveredCash.toFixed(0)} gold to your settlement.`
          : `Closed ${company.name}.`,
      );
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Close failed"),
  });

  const netProfit = company.totalRevenue - company.totalExpenses;
  const canIpo = netProfit >= STOCK_TUNING.minProfitToIPO;
  const { controlledByMe } = company;
  const isIdle = company.maxWorkers > 0 && company.workersAssigned === 0;
  const needsAttention = company.cash < 0 || isIdle;
  const staffedFraction = company.maxWorkers > 0 ? company.workersAssigned / company.maxWorkers : 0;

  return (
    <div className={`company-card${needsAttention ? " company-card--attention" : ""}`}>
      <div className="building-card__head">
        <span className="building-card__name">{company.name}</span>
        <span className="archetype-tag">{industry.name}</span>
        <span className="archetype-tag">Lv. {company.level}</span>
        <span className={`controller-tag ${controlledByMe ? "controller-tag--me" : "controller-tag--other"}`}>
          {controlledByMe ? "Controlled by you" : `Controlled by ${company.controllerLabel}`}
        </span>
      </div>

      {company.isPublic ? (
        <div className="suggestion" style={{ padding: "4px 0" }}>
          Public · {company.sharePrice.toFixed(2)}g/share · {company.sharesOutstanding} shares
        </div>
      ) : controlledByMe ? (
        <div className="trade-row" style={{ margin: "4px 0" }}>
          <button className="btn" disabled={!canIpo || ipo.isPending} onClick={() => ipo.mutate()}>
            {canIpo ? "Take Public (IPO)" : `Needs ${STOCK_TUNING.minProfitToIPO}g lifetime profit to IPO`}
          </button>
        </div>
      ) : null}

      <div className="company-card__stats">
        <div>
          <div className="delta-cell__label">Cash</div>
          <div className={`delta-cell__value ${company.cash < 0 ? "stat-tile__delta--down" : ""}`}>
            {company.cash.toFixed(0)}g
          </div>
        </div>
        {industry.inputResource && (
          <div>
            <div className="delta-cell__label">{RESOURCE_LABELS[industry.inputResource as ResourceType]} stock</div>
            <div className="delta-cell__value">{company.inputStock.toFixed(1)}</div>
          </div>
        )}
        <div>
          <div className="delta-cell__label">{OUTPUT_LABELS[industry.outputResource]} stock</div>
          <div className="delta-cell__value">{company.goodsStock.toFixed(1)}</div>
        </div>
        <div>
          <div className="delta-cell__label">Lifetime profit</div>
          <div className={`delta-cell__value ${netProfit >= 0 ? "stat-tile__delta--up" : "stat-tile__delta--down"}`}>
            {netProfit.toFixed(0)}g
          </div>
        </div>
      </div>

      <div className="building-card__rate">
        Producing {company.rates.goodsPerHour.toFixed(1)} {OUTPUT_LABELS[industry.outputResource].toLowerCase()}/hr
        {industry.inputResource &&
          ` from ${company.rates.inputPerHour.toFixed(1)} ${industry.inputResource}/hr`}, wages{" "}
        {company.rates.wagePerHour.toFixed(1)}g/hr
      </div>

      {controlledByMe ? (
        <>
          <div className="workforce">
            <div className="workforce__head">
              <span>Workforce{isIdle && " — idle"}</span>
              <span className="workforce__count">
                {company.workersAssigned} / {company.maxWorkers}
              </span>
            </div>
            <div className="workforce-bar">
              <button
                disabled={company.workersAssigned <= 0}
                onClick={() => setWorkers.mutate(company.workersAssigned - 1)}
              >
                −
              </button>
              <div className="workforce-bar__track">
                <div
                  className={`workforce-bar__fill${isIdle ? " workforce-bar__fill--idle" : ""}`}
                  style={{ width: `${staffedFraction * 100}%` }}
                />
              </div>
              <button
                disabled={company.workersAssigned >= company.maxWorkers}
                onClick={() => setWorkers.mutate(company.workersAssigned + 1)}
              >
                +
              </button>
              <button
                className="workforce-bar__max"
                disabled={company.workersAssigned >= company.maxWorkers}
                onClick={() => setWorkers.mutate(company.maxWorkers)}
              >
                Max
              </button>
            </div>
          </div>

          {error && <div className="auth-error">{error}</div>}
          {message && !error && (
            <div className="suggestion" style={{ padding: "6px 0" }}>
              {message}
            </div>
          )}

          <div className="company-card__actions">
            {industry.inputResource ? (
              <div className="trade-row">
                <input type="number" min={1} value={buyQty} onChange={(e) => setBuyQty(Math.max(1, Number(e.target.value)))} />
                <button className="btn" disabled={buy.isPending} onClick={() => buy.mutate()}>
                  Buy {industry.inputResource}
                </button>
              </div>
            ) : (
              <div />
            )}
            <div className="trade-row">
              <input type="number" min={1} value={sellQty} onChange={(e) => setSellQty(Math.max(1, Number(e.target.value)))} />
              <button className="btn" disabled={sell.isPending} onClick={() => sell.mutate()}>
                Sell {OUTPUT_LABELS[industry.outputResource].toLowerCase()}
              </button>
            </div>
          </div>

          <div className="trade-row">
            <input
              type="number"
              min={1}
              value={withdrawAmt}
              onChange={(e) => setWithdrawAmt(Math.max(1, Number(e.target.value)))}
            />
            <button className="btn btn--accent" disabled={withdraw.isPending} onClick={() => withdraw.mutate()}>
              Withdraw to settlement
            </button>
            <button
              className="btn"
              disabled={company.upgradeCost === null || upgrade.isPending}
              onClick={() => upgrade.mutate()}
            >
              {company.upgradeCost === null ? "Max level" : `Upgrade (${company.upgradeCost.toFixed(0)}g)`}
            </button>
          </div>

          {company.cash < 0 && (
            <div className="trade-row">
              <input
                type="number"
                min={1}
                value={bailoutAmt}
                onChange={(e) => setBailoutAmt(Math.max(1, Number(e.target.value)))}
              />
              <button className="btn btn--accent" disabled={bailout.isPending} onClick={() => bailout.mutate()}>
                Bail out ({(-company.cash).toFixed(0)}g owed)
              </button>
            </div>
          )}
          {gameState && company.cash < 0 && (
            <p className="suggestion" style={{ padding: "4px 0" }}>
              You have {Math.round(gameState.settlement.gold)} gold available.
            </p>
          )}

          {!company.isPublic && (
            <div className="company-card__footer">
              <button
                className="btn btn--danger"
                disabled={close.isPending}
                onClick={() => {
                  if (window.confirm(`Close ${company.name} for good? This can't be undone.`)) close.mutate();
                }}
              >
                Close business
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="locked-banner">
          Controlled by {company.controllerLabel} — you no longer manage this company.
          {company.isPublic && " Buy back a majority stake on the Stock Market to reclaim it."}
        </div>
      )}
    </div>
  );
}

function FoundCompanyForm() {
  const queryClient = useQueryClient();
  const { data: gameState } = useGameState();
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState<CompanyIndustryId>("bakery");
  const [seedMoney, setSeedMoney] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const found = useMutation({
    mutationFn: () =>
      api.foundCompany(name || `${COMPANY_INDUSTRIES[industry].name} Co.`, industry, seedMoney),
    onSuccess: () => {
      setError(null);
      setName("");
      setSeedMoney(0);
      queryClient.invalidateQueries({ queryKey: ["myCompanies"] });
      queryClient.invalidateQueries({ queryKey: ["gameState"] });
      queryClient.invalidateQueries({ queryKey: ["allCompanies"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Couldn't found company"),
  });

  const def = COMPANY_INDUSTRIES[industry];
  const totalCost = def.foundingCost + seedMoney;
  const canAfford = (gameState?.settlement.gold ?? 0) >= totalCost;

  return (
    <div className="card">
      <h2 className="card__title">Found a Company</h2>
      {error && <div className="auth-error">{error}</div>}
      <div className="trade-row" style={{ flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Company name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ width: 200 }}
        />
        <select value={industry} onChange={(e) => setIndustry(e.target.value as CompanyIndustryId)}>
          {Object.values(COMPANY_INDUSTRIES).map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
        <label className="suggestion" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          Seed money
          <input
            type="number"
            min={0}
            step={10}
            value={seedMoney}
            onChange={(e) => setSeedMoney(Math.max(0, Number(e.target.value) || 0))}
            style={{ width: 90 }}
          />
        </label>
        <button className="btn btn--accent" disabled={!canAfford || found.isPending} onClick={() => found.mutate()}>
          Found ({totalCost}g)
        </button>
      </div>
      <p className="suggestion" style={{ marginTop: 8 }}>
        {def.description} Seed money is extra starting cash beyond the {def.foundingCost}g founding
        cost — a cushion against payroll going negative. {!canAfford && "Not enough gold yet."}
      </p>
    </div>
  );
}

const TERM_LABELS: Record<number, string> = { 24: "1 day", 72: "3 days", 168: "7 days" };

function SupplyContractForm() {
  const queryClient = useQueryClient();
  const { data: myCompanies } = useMyCompanies();
  const { data: allCompanies } = useAllCompanies();
  const { data: market } = useMarket();
  const [myCompanyId, setMyCompanyId] = useState("");
  const [counterpartyId, setCounterpartyId] = useState("");
  const [quantityPerHour, setQuantityPerHour] = useState(5);
  const [pricePerUnit, setPricePerUnit] = useState(1);
  const [termHours, setTermHours] = useState(CONTRACT_TERM_HOURS_OPTIONS[0]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const companies = myCompanies?.companies ?? [];
  const world = allCompanies?.companies ?? [];
  const myCompanyIds = new Set(companies.map((c) => c.id));

  const mine = companies.find((c) => c.id === myCompanyId);
  const mineIndustry = mine ? COMPANY_INDUSTRIES[mine.industry as CompanyIndustryId] : null;
  // An extraction industry (no inputResource) can only ever be a seller; a
  // processing industry (has inputResource) can only ever be a buyer of that
  // input — every current industry falls cleanly into exactly one role.
  const mineIsSeller = mineIndustry ? !mineIndustry.inputResource : false;
  const contractResource = mineIndustry ? (mineIsSeller ? mineIndustry.outputResource : mineIndustry.inputResource) : null;
  const marketRate = contractResource
    ? (market?.resources.find((r) => r.resourceType === contractResource)?.price ?? null)
    : null;

  const eligibleCounterparties = world.filter((c) => {
    if (c.id === myCompanyId) return false;
    const industry = COMPANY_INDUSTRIES[c.industry as CompanyIndustryId];
    if (!mineIndustry) return false;
    return mineIsSeller ? industry.inputResource === mineIndustry.outputResource : industry.outputResource === mineIndustry.inputResource;
  });

  const create = useMutation({
    mutationFn: () => {
      const sellerCompanyId = mineIsSeller ? myCompanyId : counterpartyId;
      const buyerCompanyId = mineIsSeller ? counterpartyId : myCompanyId;
      return api.createContract(sellerCompanyId, buyerCompanyId, quantityPerHour, pricePerUnit, termHours);
    },
    onSuccess: (res) => {
      setError(null);
      setMessage(res.pending ? "Offer sent — awaiting the other company's acceptance." : "Contract created and active.");
      queryClient.invalidateQueries({ queryKey: ["myContracts"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Couldn't create contract"),
  });

  if (companies.length === 0) {
    return (
      <div className="card">
        <h2 className="card__title">Supply Contracts</h2>
        <div className="empty-state">Found a company first to propose a supply contract.</div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="card__title">Supply Contracts</h2>
      {error && <div className="auth-error">{error}</div>}
      {message && !error && <div className="suggestion">{message}</div>}
      <div className="trade-row" style={{ flexWrap: "wrap" }}>
        <select value={myCompanyId} onChange={(e) => { setMyCompanyId(e.target.value); setCounterpartyId(""); }}>
          <option value="">My company...</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({COMPANY_INDUSTRIES[c.industry as CompanyIndustryId].name})
            </option>
          ))}
        </select>
        <span className="suggestion">{mine ? (mineIsSeller ? "sells to" : "buys from") : ""}</span>
        <select value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)} disabled={!myCompanyId}>
          <option value="">Counterparty company...</option>
          {eligibleCounterparties.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({myCompanyIds.has(c.id) ? "yours" : c.isPlayerOwned ? "player" : "NPC"})
            </option>
          ))}
        </select>
        <input
          type="number"
          min={1}
          value={quantityPerHour}
          onChange={(e) => setQuantityPerHour(Math.max(1, Number(e.target.value)))}
          style={{ width: 80 }}
        />
        <span className="suggestion">/hr @</span>
        <input
          type="number"
          min={0}
          step={0.1}
          value={pricePerUnit}
          onChange={(e) => setPricePerUnit(Math.max(0, Number(e.target.value)))}
          style={{ width: 70 }}
        />
        <span className="suggestion">g each{marketRate !== null ? ` (market: ${marketRate.toFixed(2)}g)` : ""}</span>
        <select value={termHours} onChange={(e) => setTermHours(Number(e.target.value))}>
          {CONTRACT_TERM_HOURS_OPTIONS.map((h) => (
            <option key={h} value={h}>
              {TERM_LABELS[h] ?? `${h}h`}
            </option>
          ))}
        </select>
        <button
          className="btn btn--accent"
          disabled={!myCompanyId || !counterpartyId || create.isPending}
          onClick={() => create.mutate()}
        >
          Propose Contract
        </button>
      </div>
      {myCompanyId && eligibleCounterparties.length === 0 && (
        <p className="suggestion" style={{ marginTop: 8 }}>
          No company in the world can {mineIsSeller ? "use" : "supply"}{" "}
          {mineIndustry ? OUTPUT_LABELS[mineIsSeller ? mineIndustry.outputResource : mineIndustry.inputResource!] : "this"}{" "}
          right now.
        </p>
      )}
      <p className="suggestion" style={{ marginTop: 8 }}>
        A locked price and hourly quantity settled automatically every tick, instead of trading blind on the spot
        market. Proposing to your own other company activates immediately; proposing to another player's company
        sends a pending offer they need to accept first. Proposing to an NPC activates immediately too, but only if
        that NPC can actually afford it — priced too far above market and they'll reject it outright rather than
        accept a deal they can't pay for. Settlement is still capped by the seller's stock and the buyer's cash after
        that, so an under-supplied contract just delivers less that tick.
      </p>
    </div>
  );
}

const STATUS_LABELS: Record<MyContract["status"], string> = {
  pending: "Pending",
  active: "Active",
  expired: "Expired",
  cancelled: "Cancelled",
};

// The at-a-glance view the detailed table below can't give you: who feeds
// whom, and how healthy that relationship is, without reading rows of
// numbers. Cancelled contracts are excluded — they're not part of the
// live chain anymore, and the table below is the record of those.
function SupplyChainView() {
  const { data: contracts } = useMyContracts();
  const visible = (contracts?.contracts ?? []).filter((c) => c.status !== "cancelled");

  if (visible.length === 0) return null;

  return (
    <div className="card">
      <h2 className="card__title">Supply Chain</h2>
      <div className="chain-card">
        {visible.map((c) => (
          <div className="chain-row" key={c.id}>
            <span className={`chain-node${c.sellerIsMine ? " chain-node--mine" : ""}`}>{c.sellerCompanyName}</span>
            <span className="chain-arrow">
              <span className="chain-arrow__label">
                {OUTPUT_LABELS[c.resourceType]} · {c.quantityPerHour}/hr @ {c.pricePerUnit.toFixed(2)}g
              </span>
              <span className="chain-arrow__line" />
            </span>
            <span className={`chain-node${c.buyerIsMine ? " chain-node--mine" : ""}`}>{c.buyerCompanyName}</span>
            <span className={`chain-status chain-status--${c.status}`}>{STATUS_LABELS[c.status]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MyContractsList() {
  const queryClient = useQueryClient();
  const { data: contracts } = useMyContracts();
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["myContracts"] });

  const accept = useMutation({
    mutationFn: (id: string) => api.acceptContract(id),
    onSuccess: () => { setError(null); invalidate(); },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Couldn't accept offer"),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelContract(id),
    onSuccess: () => { setError(null); invalidate(); },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Couldn't cancel contract"),
  });

  if (!contracts || contracts.contracts.length === 0) return null;

  return (
    <div className="card">
      <h2 className="card__title">My Contracts</h2>
      {error && <div className="auth-error">{error}</div>}
      <table className="settlement-table">
        <thead>
          <tr>
            <th>Seller</th>
            <th>Buyer</th>
            <th>Resource</th>
            <th>Qty/hr</th>
            <th>Price/unit</th>
            <th>Term</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {contracts.contracts.map((c) => {
            const status = c.status;
            return (
              <tr key={c.id}>
                <td>{c.sellerCompanyName}{c.sellerIsMine && " (yours)"}</td>
                <td>{c.buyerCompanyName}{c.buyerIsMine && " (yours)"}</td>
                <td>{OUTPUT_LABELS[c.resourceType]}</td>
                <td>{c.quantityPerHour}</td>
                <td>{c.pricePerUnit.toFixed(2)}g</td>
                <td>{TERM_LABELS[c.termHours] ?? `${c.termHours}h`}</td>
                <td>{STATUS_LABELS[status]}</td>
                <td>
                  <div style={{ display: "flex", gap: 4 }}>
                    {status === "pending" && (
                      <button className="btn btn--accent" disabled={accept.isPending} onClick={() => accept.mutate(c.id)}>
                        Accept
                      </button>
                    )}
                    {(status === "pending" || status === "active") && (
                      <button className="btn" disabled={cancel.isPending} onClick={() => cancel.mutate(c.id)}>
                        Cancel
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type CompanySortKey = "name" | "cash" | "profit" | "workers";

export default function Companies() {
  const { data: mine, isLoading } = useMyCompanies();
  const { data: all } = useAllCompanies();
  const [search, setSearch] = useState("");
  const [industryFilter, setIndustryFilter] = useState<string>("all");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [sort, setSort] = useState<{ key: CompanySortKey; direction: "asc" | "desc" }>({
    key: "name",
    direction: "asc",
  });

  const companies = mine?.companies ?? [];

  const summary = {
    count: companies.length,
    totalCash: companies.reduce((sum, c) => sum + c.cash, 0),
    idle: companies.filter((c) => c.maxWorkers > 0 && c.workersAssigned === 0).length,
    inTheRed: companies.filter((c) => c.cash < 0).length,
  };

  const visible = companies
    .filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
    .filter((c) => industryFilter === "all" || c.industry === industryFilter)
    .filter((c) => !attentionOnly || c.cash < 0 || (c.maxWorkers > 0 && c.workersAssigned === 0))
    .sort((a, b) => {
      const dir = sort.direction === "asc" ? 1 : -1;
      switch (sort.key) {
        case "cash":
          return (a.cash - b.cash) * dir;
        case "profit":
          return (a.totalRevenue - a.totalExpenses - (b.totalRevenue - b.totalExpenses)) * dir;
        case "workers":
          return (a.workersAssigned - b.workersAssigned) * dir;
        default:
          return a.name.localeCompare(b.name) * dir;
      }
    });

  const industriesInUse = [...new Set(companies.map((c) => c.industry))];

  const toggleSort = (key: CompanySortKey) => {
    setSort((prev) =>
      prev.key === key ? { key, direction: prev.direction === "asc" ? "desc" : "asc" } : { key, direction: "desc" },
    );
  };

  return (
    <div className="page page--full">
      <div className="card">
        <h2 className="card__title">My Companies</h2>
        {isLoading || !mine ? (
          <div className="loading">Loading your companies...</div>
        ) : mine.companies.length === 0 ? (
          <div className="empty-state">You don't own any companies yet — found one below.</div>
        ) : (
          <>
            <div className="company-summary-bar">
              <div className="company-summary-stat">
                <div className="company-summary-stat__label">Companies</div>
                <div className="company-summary-stat__value">{summary.count}</div>
              </div>
              <div className="company-summary-stat">
                <div className="company-summary-stat__label">Combined cash</div>
                <div className={`company-summary-stat__value${summary.totalCash < 0 ? " attention" : ""}`}>
                  {summary.totalCash.toFixed(0)}g
                </div>
              </div>
              <div className="company-summary-stat">
                <div className="company-summary-stat__label">Idle workforce</div>
                <div className={`company-summary-stat__value${summary.idle > 0 ? " attention" : ""}`}>
                  {summary.idle}
                </div>
              </div>
              <div className="company-summary-stat">
                <div className="company-summary-stat__label">In the red</div>
                <div className={`company-summary-stat__value${summary.inTheRed > 0 ? " attention" : ""}`}>
                  {summary.inTheRed}
                </div>
              </div>
            </div>

            <div className="filter-row">
              <input
                type="text"
                placeholder="Search companies..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select value={industryFilter} onChange={(e) => setIndustryFilter(e.target.value)}>
                <option value="all">All industries</option>
                {industriesInUse.map((id) => (
                  <option key={id} value={id}>
                    {COMPANY_INDUSTRIES[id as CompanyIndustryId]?.name ?? id}
                  </option>
                ))}
              </select>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-secondary)" }}>
                <input type="checkbox" checked={attentionOnly} onChange={(e) => setAttentionOnly(e.target.checked)} />
                Needs attention only
              </label>
              <span className="suggestion" style={{ padding: 0, border: "none", marginLeft: "auto" }}>
                Sort:
              </span>
              {(["name", "cash", "profit", "workers"] as CompanySortKey[]).map((key) => (
                <button
                  key={key}
                  className="btn"
                  style={{ textTransform: "capitalize" }}
                  onClick={() => toggleSort(key)}
                >
                  {key}
                  {sort.key === key && (sort.direction === "asc" ? " ▲" : " ▼")}
                </button>
              ))}
            </div>

            {visible.length === 0 ? (
              <div className="empty-state">No companies match that filter.</div>
            ) : (
              <div className="company-grid">
                {visible.map((c) => (
                  <CompanyCard company={c} key={c.id} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <FoundCompanyForm />
      <SupplyChainView />
      <SupplyContractForm />
      <MyContractsList />

      <div className="card">
        <h2 className="card__title">Companies of the World</h2>
        {!all ? (
          <div className="loading">Loading...</div>
        ) : (
          <table className="settlement-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Industry</th>
                <th>Level</th>
                <th>Owner</th>
                <th>Employees</th>
                <th>Cash</th>
                <th>Stock</th>
                <th>Founded</th>
              </tr>
            </thead>
            <tbody>
              {all.companies.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>
                    <span className="archetype-tag">{c.industryName}</span>
                  </td>
                  <td>{c.level}</td>
                  <td>{c.isPlayerOwned ? "Player" : "NPC"}</td>
                  <td>{c.workersAssigned}</td>
                  <td>{c.cash.toLocaleString()}</td>
                  <td>{c.isPublic ? `${c.sharePrice.toFixed(2)}g` : "Private"}</td>
                  <td>{new Date(c.foundedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
