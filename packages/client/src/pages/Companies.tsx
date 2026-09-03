import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  COMPANY_INDUSTRIES,
  COMPANY_INDUSTRY_IDS,
  CONTRACT_TERM_HOURS_OPTIONS,
  RESOURCE_LABELS,
  STOCK_TUNING,
  zoneCategoryForIndustry,
  type CompanyIndustryDef,
  type CompanyIndustryId,
  type MarketResourceType,
  type ResourceType,
} from "@dominion/shared";
import { api, ApiError, type MyCompany, type MyContract, type PublicCompany } from "../api/client.js";
import {
  useAllCompanies,
  useGameState,
  useMarket,
  useMyCompanies,
  useMyContracts,
  useMyTerritories,
  useTutorial,
  useWorldContracts,
  useZones,
} from "../api/hooks.js";
import { CompanyAvatar, INDUSTRY_META } from "../industryMeta.js";

// RESOURCE_LABELS covers settlement-holdable resources only — everything
// else is a market-only resource (recipe economy Slice 1) with no
// settlement equivalent, so those need their own entries here (mirrors the
// same extension SupplyChain.tsx and Market.tsx already do).
const OUTPUT_LABELS: Record<MarketResourceType, string> = {
  ...RESOURCE_LABELS,
  goods: "Goods",
  electricity: "Electricity",
  fertilizer: "Fertilizer",
  wheat: "Wheat",
  flour: "Flour",
  packaging: "Packaging",
  bread: "Bread",
};

// Formats a recipe's inputs[]/outputs[] as a per-worker-per-hour summary —
// used on the founding form, before any company (and thus any worker count
// or rates.*) exists yet.
function formatRecipe(components: { resource: MarketResourceType; perWorkerPerHour: number }[]): string {
  if (components.length === 0) return "nothing";
  return components.map((c) => `${c.perWorkerPerHour} ${OUTPUT_LABELS[c.resource].toLowerCase()}`).join(" + ");
}

// A company can now buy several distinct inputs and sell several distinct
// outputs, so a supply contract needs to know which single resource +
// direction it's about — one option per resource this industry either
// sells (an output) or buys (an input).
interface ResourceOption {
  key: string; // `${role}:${resource}`, unique across an industry's whole recipe
  role: "sell" | "buy";
  resource: MarketResourceType;
}

function resourceOptionsFor(industry: CompanyIndustryDef): ResourceOption[] {
  return [
    ...industry.outputs.map((o) => ({ key: `sell:${o.resource}`, role: "sell" as const, resource: o.resource })),
    ...industry.inputs.map((i) => ({ key: `buy:${i.resource}`, role: "buy" as const, resource: i.resource })),
  ];
}

type Status = "healthy" | "attention" | "critical" | "neutral";

const STATUS_DOT: Record<Status, string> = {
  healthy: "var(--success)",
  attention: "var(--warning)",
  critical: "var(--critical)",
  neutral: "var(--text-muted)",
};

const STATUS_LABEL: Record<Status, string> = {
  healthy: "Operating normally",
  attention: "Needs attention",
  critical: "Critical issue",
  neutral: "Not controlled by you",
};

interface Alert {
  text: string;
  severity: "attention" | "critical";
}

// Every alert here is derived from a real signal already in MyCompany/
// MyContract — nothing here is invented. Mirrors the four kinds of trouble
// the rest of this session's attention-flagging already watches for
// (negative cash, idle workforce) plus two new ones specific to having a
// detail view roomy enough to explain *why*: input stock about to run out,
// and a contract closing in on its expiry.
function deriveAlerts(company: MyCompany, industry: CompanyIndustryDef, contracts: MyContract[]): Alert[] {
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

function deriveStatus(controlled: boolean, alerts: Alert[]): Status {
  if (!controlled) return "neutral";
  if (alerts.some((a) => a.severity === "critical")) return "critical";
  if (alerts.length > 0) return "attention";
  return "healthy";
}

const TERM_LABELS: Record<number, string> = { 24: "1 day", 72: "3 days", 168: "7 days" };
const STATUS_LABELS: Record<MyContract["status"], string> = {
  pending: "Pending",
  active: "Active",
  expired: "Expired",
  cancelled: "Cancelled",
};

function CompanyActions({ company }: { company: MyCompany }) {
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

function OverviewTab({ company, contracts, onGoToWorkforce }: { company: MyCompany; contracts: MyContract[]; onGoToWorkforce: () => void }) {
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

function LostControlOverview({ company }: { company: MyCompany }) {
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

function RivalOverview({ company, onPropose }: { company: PublicCompany; onPropose: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="cc-info-box">
        This company isn't controlled by you, so its finances and workforce aren't visible. You can still see its
        public contracts and propose a deal.
      </div>
      <div className="cc-stat-grid">
        <div className="cc-stat-tile">
          <div className="cc-stat-tile__label">Level</div>
          <div className="cc-stat-tile__value">{company.level}</div>
        </div>
        <div className="cc-stat-tile">
          <div className="cc-stat-tile__label">Facilities</div>
          <div className="cc-stat-tile__value">{company.facilityCount}</div>
        </div>
        <div className="cc-stat-tile">
          <div className="cc-stat-tile__label">Workforce</div>
          <div className="cc-stat-tile__value">{company.workersAssigned}</div>
        </div>
        <div className="cc-stat-tile">
          <div className="cc-stat-tile__label">Founded</div>
          <div className="cc-stat-tile__value" style={{ fontSize: 13 }}>
            {new Date(company.foundedAt).toLocaleDateString()}
          </div>
        </div>
      </div>
      <div>
        <button className="btn btn--accent" onClick={onPropose}>
          Propose Contract
        </button>
      </div>
    </div>
  );
}

function WorkforceTab({ company }: { company: MyCompany }) {
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

function ContractsTab({
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

interface CommandCenterProps {
  onProposeTo: (counterpartyId: string) => void;
  jumpToId: string | null;
  onJumpHandled: () => void;
}

function CommandCenter({ onProposeTo, jumpToId, onJumpHandled }: CommandCenterProps) {
  const { data: mine, isLoading } = useMyCompanies();
  const { data: all } = useAllCompanies();
  const { data: myContracts } = useMyContracts();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "workforce" | "contracts">("overview");
  const [search, setSearch] = useState("");
  const [industryFilter, setIndustryFilter] = useState<"all" | CompanyIndustryId>("all");
  const [alertsOnly, setAlertsOnly] = useState(false);

  const companies = mine?.companies ?? [];
  const contracts = myContracts?.contracts ?? [];

  useEffect(() => {
    if (!selectedId && companies.length > 0) setSelectedId(companies[0].id);
  }, [companies.length, selectedId]);

  useEffect(() => {
    if (jumpToId) {
      setSelectedId(jumpToId);
      setActiveTab("overview");
      onJumpHandled();
    }
  }, [jumpToId, onJumpHandled]);

  const selectCompany = (id: string) => {
    setSelectedId(id);
    setActiveTab("overview");
  };

  if (isLoading || !mine) {
    return (
      <div className="cc-shell">
        <div style={{ padding: 20 }}>
          <div className="loading">Loading your companies...</div>
        </div>
      </div>
    );
  }

  if (companies.length === 0) {
    return (
      <div className="cc-shell">
        <div style={{ padding: 20 }}>
          <div className="empty-state">You don't own any companies yet — found one below.</div>
        </div>
      </div>
    );
  }

  const withAlerts = companies.map((c) => ({
    company: c,
    alerts: deriveAlerts(c, COMPANY_INDUSTRIES[c.industry as CompanyIndustryId], contracts),
  }));

  const totalAlerts = withAlerts.reduce((n, c) => n + c.alerts.length, 0);
  const netWorth = companies.filter((c) => c.controlledByMe).reduce((n, c) => n + c.cash, 0);
  const industriesInUse = [...new Set(companies.map((c) => c.industry as CompanyIndustryId))];

  const sidebarRows = withAlerts.filter(({ company, alerts }) => {
    if (industryFilter !== "all" && company.industry !== industryFilter) return false;
    if (alertsOnly && alerts.length === 0) return false;
    if (search && !company.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const selectedMine = companies.find((c) => c.id === selectedId) ?? null;
  const selectedRival = !selectedMine ? (all?.companies ?? []).find((c) => c.id === selectedId) ?? null : null;
  const selectedIndustry = selectedMine ? COMPANY_INDUSTRIES[selectedMine.industry as CompanyIndustryId] : selectedRival ? COMPANY_INDUSTRIES[selectedRival.industry as CompanyIndustryId] : null;
  const selectedAlerts = selectedMine ? deriveAlerts(selectedMine, selectedIndustry!, contracts) : [];
  const selectedStatus: Status = selectedMine ? deriveStatus(selectedMine.controlledByMe, selectedAlerts) : "neutral";

  const tabs: { key: "overview" | "workforce" | "contracts"; label: string }[] = [
    { key: "overview", label: "Overview" },
    ...(selectedMine?.controlledByMe ? [{ key: "workforce" as const, label: "Workforce" }] : []),
    { key: "contracts", label: "Contracts" },
  ];

  return (
    <div className="cc-shell">
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
        <button className={`cc-alerts-toggle${alertsOnly ? " cc-alerts-toggle--active" : ""}`} onClick={() => setAlertsOnly((v) => !v)}>
          {totalAlerts} alert{totalAlerts === 1 ? "" : "s"}
        </button>
        <div className="cc-net-worth">
          <div className="cc-net-worth__label">Combined cash</div>
          <div className="cc-net-worth__value">{netWorth.toLocaleString()}g</div>
        </div>
      </div>

      <div className="cc-body">
        <div className="cc-sidebar">
          <div className="cc-sidebar__head">
            <span className="cc-sidebar__head-label">My Companies</span>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{sidebarRows.length}</span>
          </div>
          <div className="cc-sidebar__list">
            {sidebarRows.length === 0 ? (
              <div className="empty-state">No companies match that filter.</div>
            ) : (
              sidebarRows.map(({ company, alerts }) => {
                const status = deriveStatus(company.controlledByMe, alerts);
                return (
                  <button
                    key={company.id}
                    className={`cc-row${company.id === selectedId ? " cc-row--selected" : ""}`}
                    onClick={() => selectCompany(company.id)}
                  >
                    <CompanyAvatar industry={company.industry as CompanyIndustryId} />
                    <div className="cc-row__body">
                      <div className="cc-row__name-line">
                        <span className="cc-row__name">{company.name}</span>
                        {alerts.length > 0 && <span className="cc-dot cc-dot--alert" />}
                      </div>
                      <div className="cc-row__meta">
                        Lv {company.level} · {COMPANY_INDUSTRIES[company.industry as CompanyIndustryId].name}
                      </div>
                    </div>
                    <div className="cc-row__right">
                      <div className="cc-row__cash">{company.controlledByMe ? `${Math.floor(company.cash)}g` : "—"}</div>
                      <div className="cc-dot cc-row__status-dot" style={{ background: STATUS_DOT[status] }} />
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="cc-detail">
          {!selectedMine && !selectedRival ? (
            <div className="empty-state">Select a company from the list.</div>
          ) : (
            <>
              <div className="cc-detail__header">
                <div className="cc-detail__title-row">
                  <CompanyAvatar industry={selectedIndustry!.id} size="lg" />
                  <div>
                    <div className="cc-detail__title-row">
                      <span className="cc-detail__name">{(selectedMine ?? selectedRival)!.name}</span>
                      <span className="archetype-tag">Lv {(selectedMine ?? selectedRival)!.level}</span>
                    </div>
                    <div className="cc-detail__meta">
                      {selectedIndustry!.name} · {STATUS_LABEL[selectedStatus]}
                    </div>
                  </div>
                </div>
                <div>
                  {selectedMine?.controlledByMe ? (
                    <span className="cc-badge cc-badge--mine">Controlled by you</span>
                  ) : selectedMine ? (
                    <span className="cc-badge cc-badge--other">Controlled by {selectedMine.controllerLabel}</span>
                  ) : (
                    <span className="cc-badge cc-badge--other">External company</span>
                  )}
                </div>
              </div>

              <div className="cc-tabs">
                {tabs.map((t) => (
                  <button
                    key={t.key}
                    className={`cc-tab${activeTab === t.key ? " cc-tab--active" : ""}`}
                    onClick={() => setActiveTab(t.key)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {activeTab === "overview" &&
                (selectedMine?.controlledByMe ? (
                  // Keyed on company id so CompanyActions' buy/sell resource
                  // picker (initialized once from this company's industry)
                  // resets cleanly instead of carrying over a resource that
                  // may not exist on whichever company is selected next.
                  <OverviewTab key={selectedMine.id} company={selectedMine} contracts={contracts} onGoToWorkforce={() => setActiveTab("workforce")} />
                ) : selectedMine ? (
                  <LostControlOverview company={selectedMine} />
                ) : (
                  <RivalOverview company={selectedRival!} onPropose={() => onProposeTo(selectedRival!.id)} />
                ))}
              {activeTab === "workforce" && selectedMine?.controlledByMe && <WorkforceTab key={selectedMine.id} company={selectedMine} />}
              {activeTab === "contracts" && (
                <ContractsTab
                  companyId={(selectedMine ?? selectedRival)!.id}
                  isMine={!!selectedMine}
                  onSelectCompany={selectCompany}
                  onProposeTo={onProposeTo}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Land-gated industries (powerPlant, farm, fertilizerPlant, wheatFarm,
// packagingPlant) can also be founded from the Continent page by clicking an
// owned territory tile (see LandCompanyFounder there) — this card surfaces
// the exact same founding action here too, since a new player has no reason
// to know that clicking a map tile is where electricity/food/wheat
// production lives. One row per land-gated industry per owned territory.
function LandCompanyRow({
  seedIndex,
  industryId,
  onFounded,
}: {
  seedIndex: number;
  industryId: CompanyIndustryId;
  onFounded: () => void;
}) {
  const industry = COMPANY_INDUSTRIES[industryId];
  const [name, setName] = useState(`${industry.name} #${seedIndex}`);
  const [error, setError] = useState<string | null>(null);

  const found = useMutation({
    mutationFn: () => api.foundOnTerritory(seedIndex, industryId, name),
    onSuccess: () => {
      setError(null);
      onFounded();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Founding failed"),
  });

  return (
    <div className="trade-row" style={{ flexWrap: "wrap", marginTop: 4, alignItems: "center" }}>
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
      <button className="btn" disabled={found.isPending} onClick={() => found.mutate()}>
        Found {industry.name} ({industry.foundingCost}g)
      </button>
      {error && <div className="auth-error">{error}</div>}
    </div>
  );
}

function LandCompaniesCard() {
  const queryClient = useQueryClient();
  const { data: territories } = useMyTerritories();
  const { data: myCompanies } = useMyCompanies();
  const mine = territories?.territories ?? [];
  const landGatedIndustries = COMPANY_INDUSTRY_IDS.filter((id) => COMPANY_INDUSTRIES[id].requiresTerritory);

  if (mine.length === 0) return null;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["myCompanies"] });
    queryClient.invalidateQueries({ queryKey: ["gameState"] });
  };

  return (
    <div className="card">
      <h2 className="card__title">Land-Gated Companies</h2>
      <p className="suggestion" style={{ marginTop: 0 }}>
        Power Plant, Farm, Wheat Farm, Fertilizer Plant, and Packaging Plant run on your own territory instead of a
        zone — one of each per territory you own.
      </p>
      {mine.map((t) => {
        const territoryCompanies = (myCompanies?.companies ?? []).filter((c) => c.territorySeedIndex === t.seedIndex);
        return (
          <div key={t.seedIndex} style={{ marginTop: 10 }}>
            <div className="card-section-label">
              Territory #{t.seedIndex} — {t.dominantBiome} · {Math.round(t.areaKm2).toLocaleString()} km²
            </div>
            {landGatedIndustries.map((industryId) => {
              const founded = territoryCompanies.find((c) => c.industry === industryId);
              return founded ? (
                <p className="suggestion" key={industryId} style={{ marginTop: 4 }}>
                  {founded.name} ({COMPANY_INDUSTRIES[industryId].name}) is running here.
                </p>
              ) : (
                <LandCompanyRow key={industryId} seedIndex={t.seedIndex} industryId={industryId} onFounded={invalidate} />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function FoundCompanyForm() {
  const queryClient = useQueryClient();
  const { data: gameState } = useGameState();
  const { data: zones } = useZones();
  const { data: tutorial } = useTutorial();
  // Land-gated industries (powerPlant, fertilizerPlant, wheatFarm,
  // packagingPlant) are founded on owned territory via the Continent page's
  // LandCompanyFounder, not here — this form only offers the zoning-gated
  // ones, matching what routes/companies.ts's POST / actually accepts.
  const zoningGatedIndustries = COMPANY_INDUSTRY_IDS.filter((id) => !COMPANY_INDUSTRIES[id].requiresTerritory);
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState<CompanyIndustryId>("retail");
  const [seedMoney, setSeedMoney] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Nudges a first-time player toward the company the tutorial actually
  // needs, without hard-restricting the dropdown — applied once, so it never
  // fights a selection the player already made.
  const appliedTutorialDefault = useRef(false);
  useEffect(() => {
    if (!appliedTutorialDefault.current && tutorial?.step === "found_company") {
      appliedTutorialDefault.current = true;
      setIndustry("retail");
    }
  }, [tutorial?.step]);

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
      queryClient.invalidateQueries({ queryKey: ["zones"] });
      if (tutorial?.step === "found_company" && industry === "retail") {
        api.tutorialAdvance("found_company").then(() => queryClient.invalidateQueries({ queryKey: ["tutorial"] }));
      }
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Couldn't found company"),
  });

  const def = COMPANY_INDUSTRIES[industry];
  const totalCost = def.foundingCost + seedMoney;
  const canAfford = (gameState?.settlement.gold ?? 0) >= totalCost;
  const zoneType = zoneCategoryForIndustry(industry);
  const zoneCapacity = zones?.zones.find((z) => z.id === zoneType);
  const atCapacity = zoneCapacity ? zoneCapacity.used >= zoneCapacity.available : false;

  return (
    <div className="card">
      <h2 className="card__title">Found a Company (Zoned)</h2>
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
          {zoningGatedIndustries.map((id) => (
            <option key={id} value={id}>
              {COMPANY_INDUSTRIES[id].name}
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
        <button
          className="btn btn--accent"
          data-tutorial="tutorial-found-company-submit"
          disabled={!canAfford || atCapacity || found.isPending}
          onClick={() => found.mutate()}
        >
          Found ({totalCost}g)
        </button>
      </div>
      <p className="suggestion" style={{ marginTop: 8 }}>
        {def.description} Recipe: {formatRecipe(def.inputs)} → {formatRecipe(def.outputs)} per worker/hr. Seed money
        is extra starting cash beyond the {def.foundingCost}g founding cost — a cushion against payroll going
        negative. {!canAfford && "Not enough gold yet."}
      </p>
      {zoneCapacity && (
        <p className="suggestion" style={{ marginTop: 4, color: atCapacity ? "var(--critical)" : undefined }}>
          {zoneCapacity.name} capacity: {zoneCapacity.used}/{zoneCapacity.available} used
          {atCapacity && " — commission another zone from Government to found more"}.
        </p>
      )}
    </div>
  );
}

function SupplyContractForm({ presetCounterpartyId }: { presetCounterpartyId: string | null }) {
  const queryClient = useQueryClient();
  const { data: myCompanies } = useMyCompanies();
  const { data: allCompanies } = useAllCompanies();
  const { data: market } = useMarket();
  const [myCompanyId, setMyCompanyId] = useState("");
  const [resourceKey, setResourceKey] = useState("");
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

  const presetCounterparty = presetCounterpartyId ? world.find((c) => c.id === presetCounterpartyId) : undefined;
  const presetCounterpartyIndustry = presetCounterparty ? COMPANY_INDUSTRIES[presetCounterparty.industry as CompanyIndustryId] : null;
  // Jumping in from "Propose Contract" on a specific company's detail page
  // already tells us the counterparty — every (my company, resource,
  // buy/sell direction) combination that could actually deal with them,
  // computed once so both the company dropdown and the resource dropdown
  // can narrow to only real matches.
  const presetMatches: { companyId: string; option: ResourceOption }[] = presetCounterpartyIndustry
    ? companies.flatMap((c) => {
        const industry = COMPANY_INDUSTRIES[c.industry as CompanyIndustryId];
        return resourceOptionsFor(industry)
          .filter((opt) =>
            opt.role === "sell"
              ? presetCounterpartyIndustry.inputs.some((i) => i.resource === opt.resource)
              : presetCounterpartyIndustry.outputs.some((o) => o.resource === opt.resource),
          )
          .map((option) => ({ companyId: c.id, option }));
      })
    : [];

  useEffect(() => {
    if (!presetCounterpartyId || presetMatches.length === 0) return;
    setCounterpartyId(presetCounterpartyId);
    if (presetMatches.length === 1) {
      setMyCompanyId(presetMatches[0].companyId);
      setResourceKey(presetMatches[0].option.key);
    }
    document.getElementById("supply-contract-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
    // Deliberately re-run only when the preset target changes, not on every
    // companies/world refetch — otherwise a manual myCompanyId choice the
    // player makes afterward gets stomped back to the single-eligible pick
    // on the next 15s poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetCounterpartyId]);

  const myCompanyOptions = presetCounterparty ? companies.filter((c) => presetMatches.some((m) => m.companyId === c.id)) : companies;

  const resourceOptions = presetCounterparty
    ? presetMatches.filter((m) => m.companyId === myCompanyId).map((m) => m.option)
    : mineIndustry
      ? resourceOptionsFor(mineIndustry)
      : [];

  const selectedOption = resourceOptions.find((o) => o.key === resourceKey) ?? null;
  const mineIsSeller = selectedOption?.role === "sell";
  const contractResource = selectedOption?.resource ?? null;

  const marketRate = contractResource
    ? (market?.resources.find((r) => r.resourceType === contractResource)?.price ?? null)
    : null;

  const eligibleCounterparties = world.filter((c) => {
    if (c.id === myCompanyId || !contractResource) return false;
    const industry = COMPANY_INDUSTRIES[c.industry as CompanyIndustryId];
    return mineIsSeller
      ? industry.inputs.some((i) => i.resource === contractResource)
      : industry.outputs.some((o) => o.resource === contractResource);
  });

  const create = useMutation({
    mutationFn: () => {
      if (!contractResource) throw new Error("Pick a resource first");
      const sellerCompanyId = mineIsSeller ? myCompanyId : counterpartyId;
      const buyerCompanyId = mineIsSeller ? counterpartyId : myCompanyId;
      return api.createContract(sellerCompanyId, buyerCompanyId, contractResource, quantityPerHour, pricePerUnit, termHours);
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
    <div className="card" id="supply-contract-form">
      <h2 className="card__title">Supply Contracts</h2>
      {error && <div className="auth-error">{error}</div>}
      {message && !error && <div className="suggestion">{message}</div>}
      {presetCounterparty && (
        <div className="suggestion">
          {presetMatches.length > 0
            ? `Proposing to ${presetCounterparty.name} — pick which of your companies (and which resource) deals with them.`
            : `None of your companies can deal with ${presetCounterparty.name} right now.`}
        </div>
      )}
      <div className="trade-row" style={{ flexWrap: "wrap" }}>
        <select
          value={myCompanyId}
          onChange={(e) => {
            setMyCompanyId(e.target.value);
            setResourceKey("");
            if (!presetCounterparty) setCounterpartyId("");
          }}
        >
          <option value="">My company...</option>
          {myCompanyOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({COMPANY_INDUSTRIES[c.industry as CompanyIndustryId].name})
            </option>
          ))}
        </select>
        <select
          value={resourceKey}
          onChange={(e) => {
            setResourceKey(e.target.value);
            if (!presetCounterparty) setCounterpartyId("");
          }}
          disabled={!myCompanyId}
        >
          <option value="">Resource...</option>
          {resourceOptions.map((o) => (
            <option key={o.key} value={o.key}>
              {o.role === "sell" ? "Sell" : "Buy"} {OUTPUT_LABELS[o.resource]}
            </option>
          ))}
        </select>
        <span className="suggestion">{selectedOption ? (mineIsSeller ? "sells to" : "buys from") : ""}</span>
        <select value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)} disabled={!contractResource}>
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
          disabled={!myCompanyId || !contractResource || !counterpartyId || create.isPending}
          onClick={() => create.mutate()}
        >
          Propose Contract
        </button>
      </div>
      {contractResource && eligibleCounterparties.length === 0 && (
        <p className="suggestion" style={{ marginTop: 8 }}>
          No company in the world can {mineIsSeller ? "use" : "supply"} {OUTPUT_LABELS[contractResource]} right now.
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

export default function Companies() {
  const { data: all } = useAllCompanies();
  const [proposeToId, setProposeToId] = useState<string | null>(null);
  // Deep-link from the World Map's island detail view (clicking a company
  // marker there navigates here with this router state) — read once, since
  // CommandCenter clears it back to null via onJumpHandled after consuming it.
  const location = useLocation();
  const [jumpToId, setJumpToId] = useState<string | null>(
    (location.state as { jumpToCompanyId?: string } | null)?.jumpToCompanyId ?? null,
  );

  return (
    <div className="page page--full">
      <CommandCenter onProposeTo={setProposeToId} jumpToId={jumpToId} onJumpHandled={() => setJumpToId(null)} />

      <LandCompaniesCard />
      <FoundCompanyForm />
      <SupplyContractForm presetCounterpartyId={proposeToId} />
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
                <tr key={c.id} className="clickable-row" style={{ cursor: "pointer" }} onClick={() => setJumpToId(c.id)}>
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
