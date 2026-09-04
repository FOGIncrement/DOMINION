import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { COMPANY_INDUSTRIES, RESOURCE_LABELS, STOCK_TUNING, type CompanyIndustryDef, type CompanyIndustryId, type MarketResourceType } from "@dominion/shared";
import { api, ApiError, type MyCompany, type MyContract } from "../api/client.js";
import { useGameState, useMyContracts, useWorldContracts } from "../api/hooks.js";

// Shared between Companies.tsx's Command Center (the full sidebar+detail
// browser) and Map.tsx's Founding Grid split panel (management view for a
// company selected on the map) — extracted so neither reimplements the
// other's copy. Everything here operates on the existing MyCompany/
// MyContract client types; nothing map- or command-center-specific leaked
// in during the extraction.

// RESOURCE_LABELS covers settlement-holdable resources only — everything
// else is a market-only resource (recipe economy Slice 1) with no
// settlement equivalent, so those need their own entries here (mirrors the
// same extension SupplyChain.tsx and Market.tsx already do).
export const OUTPUT_LABELS: Record<MarketResourceType, string> = {
  ...RESOURCE_LABELS,
  goods: "Goods",
  electricity: "Electricity",
  fertilizer: "Fertilizer",
  wheat: "Wheat",
  flour: "Flour",
  packaging: "Packaging",
  bread: "Bread",
};

export type Status = "healthy" | "attention" | "critical" | "neutral";

export const STATUS_DOT: Record<Status, string> = {
  healthy: "var(--success)",
  attention: "var(--warning)",
  critical: "var(--critical)",
  neutral: "var(--text-muted)",
};

export const STATUS_LABEL: Record<Status, string> = {
  healthy: "Operating normally",
  attention: "Needs attention",
  critical: "Critical issue",
  neutral: "Not controlled by you",
};

export interface Alert {
  text: string;
  severity: "attention" | "critical";
}

// Every alert here is derived from a real signal already in MyCompany/
// MyContract — nothing here is invented. Mirrors the four kinds of trouble
// the rest of this session's attention-flagging already watches for
// (negative cash, idle workforce) plus two new ones specific to having a
// detail view roomy enough to explain *why*: input stock about to run out,
// and a contract closing in on its expiry.
export function deriveAlerts(company: MyCompany, industry: CompanyIndustryDef, contracts: MyContract[]): Alert[] {
  const alerts: Alert[] = [];
  if (company.cash < 0) {
    alerts.push({ text: `Cash is negative — ${Math.abs(company.cash).toFixed(0)}g owed`, severity: "critical" });
  }
  if (company.maxWorkers > 0 && company.workersAssigned === 0) {
    alerts.push({ text: "No workers assigned — producing nothing", severity: "attention" });
  }
  for (const input of industry.inputs) {
    const rate = company.rates.inputs[input.resource] ?? 0;
    const stock = company.stocks[input.resource] ?? 0;
    if (rate > 0 && stock < rate) {
      alerts.push({
        text: `${OUTPUT_LABELS[input.resource]} stock critically low — production will stall soon`,
        severity: "critical",
      });
    }
  }
  if (company.maxWorkers > 0 && company.workersAssigned >= company.maxWorkers && company.upgradeCost !== null) {
    alerts.push({ text: "Workforce at capacity — upgrade to grow further", severity: "attention" });
  }
  for (const c of contracts) {
    if (c.status !== "active" || !c.expiresAt) continue;
    if (c.sellerCompanyId !== company.id && c.buyerCompanyId !== company.id) continue;
    const hoursLeft = (new Date(c.expiresAt).getTime() - Date.now()) / (60 * 60 * 1000);
    if (hoursLeft > 0 && hoursLeft < 48) {
      const counterparty = c.sellerCompanyId === company.id ? c.buyerCompanyName : c.sellerCompanyName;
      alerts.push({ text: `Contract with ${counterparty} expires in ${Math.round(hoursLeft)}h`, severity: "attention" });
    }
  }
  return alerts;
}

export function deriveStatus(controlled: boolean, alerts: Alert[]): Status {
  if (!controlled) return "neutral";
  if (alerts.some((a) => a.severity === "critical")) return "critical";
  if (alerts.length > 0) return "attention";
  return "healthy";
}

export const TERM_LABELS: Record<number, string> = { 24: "1 day", 72: "3 days", 168: "7 days" };
export const STATUS_LABELS: Record<MyContract["status"], string> = {
  pending: "Pending",
  active: "Active",
  expired: "Expired",
  cancelled: "Cancelled",
};

export function CompanyActions({ company }: { company: MyCompany }) {
  const industry = COMPANY_INDUSTRIES[company.industry as CompanyIndustryId];
  const queryClient = useQueryClient();
  const { data: gameState } = useGameState();
  const [buyResource, setBuyResource] = useState<MarketResourceType | "">(industry.inputs[0]?.resource ?? "");
  const [sellResource, setSellResource] = useState<MarketResourceType | "">(industry.outputs[0]?.resource ?? "");
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

  const buy = useMutation({
    mutationFn: () => api.tradeCompany(company.id, "buy", buyResource as MarketResourceType, buyQty),
    onSuccess: (res) => {
      setError(null);
      setMessage(`Bought ${buyQty} ${buyResource ? OUTPUT_LABELS[buyResource].toLowerCase() : ""} for ${res.cost?.toFixed(0)} gold.`);
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Buy failed"),
  });

  const sell = useMutation({
    mutationFn: () => api.tradeCompany(company.id, "sell", sellResource as MarketResourceType, sellQty),
    onSuccess: (res) => {
      setError(null);
      const taxNote = res.tax && res.tax > 0 ? ` (${res.tax.toFixed(0)}g corporate tax)` : "";
      setMessage(`Sold ${sellQty} ${sellResource ? OUTPUT_LABELS[sellResource].toLowerCase() : ""} for ${res.proceeds?.toFixed(0)} gold${taxNote}.`);
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

  const expand = useMutation({
    mutationFn: () => api.expandCompany(company.id),
    onSuccess: (res) => {
      setError(null);
      setMessage(`Added a facility (now ${res.facilityCount}) for ${res.cost.toFixed(0)} gold.`);
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Expansion failed"),
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {error && <div className="auth-error">{error}</div>}
      {message && !error && <div className="suggestion">{message}</div>}

      <div className="company-card__actions">
        {industry.inputs.length > 0 ? (
          <div className="trade-row">
            {industry.inputs.length > 1 ? (
              <select value={buyResource} onChange={(e) => setBuyResource(e.target.value as MarketResourceType)}>
                {industry.inputs.map((i) => (
                  <option key={i.resource} value={i.resource}>
                    {OUTPUT_LABELS[i.resource]}
                  </option>
                ))}
              </select>
            ) : (
              <span className="suggestion" style={{ padding: 0, border: "none" }}>
                Buy {OUTPUT_LABELS[industry.inputs[0].resource].toLowerCase()}
              </span>
            )}
            <input type="number" min={1} value={buyQty} onChange={(e) => setBuyQty(Math.max(1, Number(e.target.value)))} />
            <button className="btn" disabled={buy.isPending || !buyResource} onClick={() => buy.mutate()}>
              Buy
            </button>
          </div>
        ) : (
          <div />
        )}
        {industry.outputs.length > 0 ? (
          <div className="trade-row">
            {industry.outputs.length > 1 ? (
              <select value={sellResource} onChange={(e) => setSellResource(e.target.value as MarketResourceType)}>
                {industry.outputs.map((o) => (
                  <option key={o.resource} value={o.resource}>
                    {OUTPUT_LABELS[o.resource]}
                  </option>
                ))}
              </select>
            ) : (
              <span className="suggestion" style={{ padding: 0, border: "none" }}>
                Sell {OUTPUT_LABELS[industry.outputs[0].resource].toLowerCase()}
              </span>
            )}
            <input type="number" min={1} value={sellQty} onChange={(e) => setSellQty(Math.max(1, Number(e.target.value)))} />
            <button className="btn" disabled={sell.isPending || !sellResource} onClick={() => sell.mutate()}>
              Sell
            </button>
          </div>
        ) : (
          <div />
        )}
      </div>

      <div className="trade-row" style={{ flexWrap: "wrap" }}>
        <input type="number" min={1} value={withdrawAmt} onChange={(e) => setWithdrawAmt(Math.max(1, Number(e.target.value)))} style={{ width: 90 }} />
        <button className="btn btn--accent" disabled={withdraw.isPending} onClick={() => withdraw.mutate()}>
          Withdraw to settlement
        </button>
        <button className="btn" disabled={company.upgradeCost === null || upgrade.isPending} onClick={() => upgrade.mutate()}>
          {company.upgradeCost === null ? "Max level" : `Upgrade (${company.upgradeCost.toFixed(0)}g)`}
        </button>
        <button className="btn" disabled={company.expandCost === null || expand.isPending} onClick={() => expand.mutate()}>
          {company.expandCost === null ? "Max facilities" : `Add facility (${company.expandCost.toFixed(0)}g)`}
        </button>
        {!company.isPublic && !canIpo && <span className="suggestion" style={{ padding: 0, border: "none" }}>Needs {STOCK_TUNING.minProfitToIPO}g lifetime profit to IPO</span>}
        {!company.isPublic && canIpo && (
          <button className="btn" disabled={ipo.isPending} onClick={() => ipo.mutate()}>
            Take Public (IPO)
          </button>
        )}
        <div style={{ flexGrow: 1 }} />
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

      {company.cash < 0 && (
        <div className="trade-row" style={{ flexWrap: "wrap" }}>
          <input type="number" min={1} value={bailoutAmt} onChange={(e) => setBailoutAmt(Math.max(1, Number(e.target.value)))} style={{ width: 90 }} />
          <button className="btn btn--accent" disabled={bailout.isPending} onClick={() => bailout.mutate()}>
            Bail out ({(-company.cash).toFixed(0)}g owed)
          </button>
          {gameState && (
            <span className="suggestion" style={{ padding: 0, border: "none" }}>
              You have {Math.floor(gameState.settlement.gold)} gold available.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function OverviewTab({ company, contracts, onGoToWorkforce }: { company: MyCompany; contracts: MyContract[]; onGoToWorkforce: () => void }) {
  const industry = COMPANY_INDUSTRIES[company.industry as CompanyIndustryId];
  const alerts = deriveAlerts(company, industry, contracts);
  const staffedFraction = company.maxWorkers > 0 ? company.workersAssigned / company.maxWorkers : 0;
  const netProfit = company.totalRevenue - company.totalExpenses;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {alerts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {alerts.map((a, i) => (
            <div className={`cc-alert-banner cc-alert-banner--${a.severity}`} key={i}>
              {a.text}
            </div>
          ))}
        </div>
      )}

      <div className="cc-stat-grid">
        <div className="cc-stat-tile">
          <div className="cc-stat-tile__label">Cash</div>
          <div className="cc-stat-tile__value" style={company.cash < 0 ? { color: "var(--critical)" } : undefined}>
            {Math.floor(company.cash)}g
          </div>
        </div>
        {(Object.entries(company.stocks) as [MarketResourceType, number][]).map(([resource, amount]) => (
          <div className="cc-stat-tile" key={resource}>
            <div className="cc-stat-tile__label">{OUTPUT_LABELS[resource]} stock</div>
            <div className="cc-stat-tile__value">{Math.floor(amount)}</div>
          </div>
        ))}
        <div className="cc-stat-tile">
          <div className="cc-stat-tile__label">Lifetime profit</div>
          <div className="cc-stat-tile__value" style={{ color: netProfit >= 0 ? "var(--success)" : "var(--critical)" }}>
            {netProfit.toFixed(0)}g
          </div>
        </div>
        {industry.outputs.length > 0 && (
          <div className="cc-stat-tile">
            <div className="cc-stat-tile__label">Production</div>
            <div className="cc-stat-tile__value">
              {industry.outputs.map((o) => `${(company.rates.outputs[o.resource] ?? 0).toFixed(1)}/hr`).join(", ")}
            </div>
          </div>
        )}
        <div className="cc-stat-tile">
          <div className="cc-stat-tile__label">Facilities</div>
          <div className="cc-stat-tile__value">{company.facilityCount}</div>
        </div>
      </div>

      <div className="cc-stat-tile">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div className="cc-stat-tile__label">Workforce</div>
          <a onClick={onGoToWorkforce} style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)", cursor: "pointer" }}>
            Manage →
          </a>
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, fontVariantNumeric: "tabular-nums" }}>
          {company.workersAssigned} / {company.maxWorkers} · {company.rates.wagePerHour.toFixed(1)}g/hr wages
        </div>
        <div className="workforce-bar__track">
          <div className="workforce-bar__fill" style={{ width: `${staffedFraction * 100}%` }} />
        </div>
      </div>

      <CompanyActions company={company} />
    </div>
  );
}

export function LostControlOverview({ company }: { company: MyCompany }) {
  const netProfit = company.totalRevenue - company.totalExpenses;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="locked-banner">
        Controlled by {company.controllerLabel} — you no longer manage this company.
        {company.isPublic && " Buy back a majority stake on the Stock Market to reclaim it."}
      </div>
      <div className="cc-stat-grid">
        <div className="cc-stat-tile">
          <div className="cc-stat-tile__label">Cash</div>
          <div className="cc-stat-tile__value">{Math.floor(company.cash)}g</div>
        </div>
        {(Object.entries(company.stocks) as [MarketResourceType, number][]).map(([resource, amount]) => (
          <div className="cc-stat-tile" key={resource}>
            <div className="cc-stat-tile__label">{OUTPUT_LABELS[resource]} stock</div>
            <div className="cc-stat-tile__value">{Math.floor(amount)}</div>
          </div>
        ))}
        <div className="cc-stat-tile">
          <div className="cc-stat-tile__label">Lifetime profit</div>
          <div className="cc-stat-tile__value" style={{ color: netProfit >= 0 ? "var(--success)" : "var(--critical)" }}>
            {netProfit.toFixed(0)}g
          </div>
        </div>
        <div className="cc-stat-tile">
          <div className="cc-stat-tile__label">Workforce</div>
          <div className="cc-stat-tile__value">
            {company.workersAssigned} / {company.maxWorkers}
          </div>
        </div>
        <div className="cc-stat-tile">
          <div className="cc-stat-tile__label">Facilities</div>
          <div className="cc-stat-tile__value">{company.facilityCount}</div>
        </div>
      </div>
    </div>
  );
}

export function WorkforceTab({ company }: { company: MyCompany }) {
  const queryClient = useQueryClient();
  const { data: gameState } = useGameState();
  const [error, setError] = useState<string | null>(null);
  const industry = COMPANY_INDUSTRIES[company.industry as CompanyIndustryId];
  const staffedFraction = company.maxWorkers > 0 ? company.workersAssigned / company.maxWorkers : 0;
  const isIdle = company.maxWorkers > 0 && company.workersAssigned === 0;

  // Hiring is capped by both this company's own worker slots AND the
  // settlement's available population, shared across buildings and every
  // company this player founded — the server enforces the same thing, this
  // just keeps the buttons from offering a hire that would get rejected.
  const available = gameState?.population.available ?? 0;
  const canAddWorker = company.workersAssigned < company.maxWorkers && available > 0;
  const hireCap = Math.min(company.maxWorkers, company.workersAssigned + available);

  const setWorkers = useMutation({
    mutationFn: (workers: number) => api.setCompanyWorkers(company.id, workers),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["myCompanies"] });
      queryClient.invalidateQueries({ queryKey: ["gameState"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Couldn't update workers"),
  });

  const setAutoStaff = useMutation({
    mutationFn: (enabled: boolean) => api.setAutoStaff(company.id, enabled),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["myCompanies"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Couldn't update auto-staff"),
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {error && <div className="auth-error">{error}</div>}
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--text-secondary)", cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={company.autoStaff}
          disabled={setAutoStaff.isPending}
          onChange={(e) => setAutoStaff.mutate(e.target.checked)}
        />
        Auto-staff — automatically hires from available population
      </label>
      <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
        {company.workersAssigned} of {company.maxWorkers} positions filled · {company.rates.wagePerHour.toFixed(1)}g/hr in wages
        {isIdle && " — idle"}
      </div>
      <div className="workforce-bar">
        <button disabled={company.workersAssigned <= 0} onClick={() => setWorkers.mutate(company.workersAssigned - 1)}>
          −
        </button>
        <div className="workforce-bar__track">
          <div className={`workforce-bar__fill${isIdle ? " workforce-bar__fill--idle" : ""}`} style={{ width: `${staffedFraction * 100}%` }} />
        </div>
        <button disabled={!canAddWorker} onClick={() => setWorkers.mutate(company.workersAssigned + 1)}>
          +
        </button>
        <button className="workforce-bar__max" disabled={!canAddWorker} onClick={() => setWorkers.mutate(hireCap)}>
          Max
        </button>
      </div>
      {company.workersAssigned < company.maxWorkers && available <= 0 && (
        <p className="suggestion">No available population to hire — everyone's already assigned to a building or company.</p>
      )}
      <p className="suggestion">
        {industry.outputs.length > 0
          ? `Each worker produces ${industry.outputs
              .map((o) => `${((company.rates.outputs[o.resource] ?? 0) / Math.max(1, company.workersAssigned)).toFixed(2)} ${OUTPUT_LABELS[o.resource].toLowerCase()}`)
              .join(", ")}/hr on average.`
          : "Workers keep this company staffed."}
      </p>
    </div>
  );
}

export function ContractsTab({
  companyId,
  isMine,
  onSelectCompany,
  onProposeTo,
}: {
  companyId: string;
  isMine: boolean;
  onSelectCompany: (id: string) => void;
  onProposeTo: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const { data: myContracts } = useMyContracts();
  const { data: worldContracts } = useWorldContracts();
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

  if (isMine) {
    const rows = (myContracts?.contracts ?? []).filter((c) => c.sellerCompanyId === companyId || c.buyerCompanyId === companyId);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {error && <div className="auth-error">{error}</div>}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{rows.length} contract(s)</span>
          <button className="btn btn--accent" onClick={() => onProposeTo(companyId)}>
            + Propose contract
          </button>
        </div>
        {rows.length === 0 ? (
          <div className="empty-state">No contracts for this company yet.</div>
        ) : (
          rows.map((c) => {
            const counterpartyName = c.sellerCompanyId === companyId ? c.buyerCompanyName : c.sellerCompanyName;
            const counterpartyId = c.sellerCompanyId === companyId ? c.buyerCompanyId : c.sellerCompanyId;
            const direction = c.sellerCompanyId === companyId ? "sells to" : "buys from";
            return (
              <div key={c.id} className="cc-stat-tile" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: c.status === "active" ? "var(--success)" : c.status === "pending" ? "var(--warning)" : "var(--text-muted)", flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13 }}>
                    {c.quantityPerHour} {OUTPUT_LABELS[c.resourceType]}/hr {direction}{" "}
                    <a onClick={() => onSelectCompany(counterpartyId)} style={{ fontWeight: 600, color: "var(--accent)", cursor: "pointer" }}>
                      {counterpartyName}
                    </a>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>
                    {c.pricePerUnit.toFixed(2)}g/unit · {STATUS_LABELS[c.status]}
                    {c.termHours && ` · ${TERM_LABELS[c.termHours] ?? `${c.termHours}h`} term`}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {c.status === "pending" && (
                    <button className="btn btn--accent" disabled={accept.isPending} onClick={() => accept.mutate(c.id)}>
                      Accept
                    </button>
                  )}
                  {(c.status === "pending" || c.status === "active") && (
                    <button className="btn" disabled={cancel.isPending} onClick={() => cancel.mutate(c.id)}>
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    );
  }

  const rows = (worldContracts?.contracts ?? []).filter((c) => c.sellerCompanyId === companyId || c.buyerCompanyId === companyId);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{rows.length} public contract(s)</span>
        <button className="btn btn--accent" onClick={() => onProposeTo(companyId)}>
          Propose Contract
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="empty-state">No public contracts for this company right now.</div>
      ) : (
        rows.map((c) => {
          const counterpartyName = c.sellerCompanyId === companyId ? c.buyerCompanyName : c.sellerCompanyName;
          const counterpartyId = c.sellerCompanyId === companyId ? c.buyerCompanyId : c.sellerCompanyId;
          const direction = c.sellerCompanyId === companyId ? "sells to" : "buys from";
          return (
            <div key={c.id} className="cc-stat-tile" style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--success)", flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13 }}>
                  {c.quantityPerHour} {OUTPUT_LABELS[c.resourceType]}/hr {direction}{" "}
                  <a onClick={() => onSelectCompany(counterpartyId)} style={{ fontWeight: 600, color: "var(--accent)", cursor: "pointer" }}>
                    {counterpartyName}
                  </a>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{c.pricePerUnit.toFixed(2)}g/unit</div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
