import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { COMPANY_INDUSTRIES, RESOURCE_LABELS, STOCK_TUNING, type CompanyIndustryId, type ResourceType } from "@dominion/shared";
import { api, ApiError, type MyCompany } from "../api/client.js";
import { useAllCompanies, useGameState, useMyCompanies } from "../api/hooks.js";

function CompanyCard({ company }: { company: MyCompany }) {
  const industry = COMPANY_INDUSTRIES[company.industry as CompanyIndustryId];
  const queryClient = useQueryClient();
  const [buyQty, setBuyQty] = useState(20);
  const [sellQty, setSellQty] = useState(10);
  const [withdrawAmt, setWithdrawAmt] = useState(10);
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
      setMessage(`Bought ${buyQty} ${industry.inputResource} for ${res.cost?.toFixed(0)} gold.`);
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Buy failed"),
  });

  const sell = useMutation({
    mutationFn: () => api.tradeCompany(company.id, "sell", sellQty),
    onSuccess: (res) => {
      setError(null);
      const taxNote = res.tax && res.tax > 0 ? ` (${res.tax.toFixed(0)}g corporate tax)` : "";
      setMessage(`Sold ${sellQty} goods for ${res.proceeds?.toFixed(0)} gold${taxNote}.`);
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

  const netProfit = company.totalRevenue - company.totalExpenses;
  const canIpo = netProfit >= STOCK_TUNING.minProfitToIPO;
  const { controlledByMe } = company;

  return (
    <div className="company-card">
      <div className="building-card__head">
        <span className="building-card__name">{company.name}</span>
        <span className="archetype-tag">{industry.name}</span>
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
          <div className="delta-cell__value">{company.cash.toFixed(0)}g</div>
        </div>
        <div>
          <div className="delta-cell__label">{RESOURCE_LABELS[industry.inputResource as ResourceType]} stock</div>
          <div className="delta-cell__value">{company.inputStock.toFixed(1)}</div>
        </div>
        <div>
          <div className="delta-cell__label">Goods stock</div>
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
        Producing {company.rates.goodsPerHour.toFixed(1)} goods/hr from{" "}
        {company.rates.inputPerHour.toFixed(1)} {industry.inputResource}/hr, wages {company.rates.wagePerHour.toFixed(1)}
        g/hr
      </div>

      {controlledByMe ? (
        <>
          <div className="worker-row">
            <button
              disabled={company.workersAssigned <= 0}
              onClick={() => setWorkers.mutate(company.workersAssigned - 1)}
            >
              −
            </button>
            <span>
              {company.workersAssigned} / {company.maxWorkers} workers
            </span>
            <button
              disabled={company.workersAssigned >= company.maxWorkers}
              onClick={() => setWorkers.mutate(company.workersAssigned + 1)}
            >
              +
            </button>
          </div>

          {error && <div className="auth-error">{error}</div>}
          {message && !error && (
            <div className="suggestion" style={{ padding: "6px 0" }}>
              {message}
            </div>
          )}

          <div className="trade-row">
            <input type="number" min={1} value={buyQty} onChange={(e) => setBuyQty(Math.max(1, Number(e.target.value)))} />
            <button className="btn" disabled={buy.isPending} onClick={() => buy.mutate()}>
              Buy {industry.inputResource}
            </button>
          </div>
          <div className="trade-row">
            <input type="number" min={1} value={sellQty} onChange={(e) => setSellQty(Math.max(1, Number(e.target.value)))} />
            <button className="btn" disabled={sell.isPending} onClick={() => sell.mutate()}>
              Sell goods
            </button>
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
          </div>
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
  const [error, setError] = useState<string | null>(null);

  const found = useMutation({
    mutationFn: () => api.foundCompany(name || `${COMPANY_INDUSTRIES[industry].name} Co.`, industry),
    onSuccess: () => {
      setError(null);
      setName("");
      queryClient.invalidateQueries({ queryKey: ["myCompanies"] });
      queryClient.invalidateQueries({ queryKey: ["gameState"] });
      queryClient.invalidateQueries({ queryKey: ["allCompanies"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Couldn't found company"),
  });

  const def = COMPANY_INDUSTRIES[industry];
  const canAfford = (gameState?.settlement.gold ?? 0) >= def.foundingCost;

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
        <button className="btn btn--accent" disabled={!canAfford || found.isPending} onClick={() => found.mutate()}>
          Found ({def.foundingCost}g)
        </button>
      </div>
      <p className="suggestion" style={{ marginTop: 8 }}>
        {def.description} {!canAfford && "Not enough gold yet."}
      </p>
    </div>
  );
}

export default function Companies() {
  const { data: mine, isLoading } = useMyCompanies();
  const { data: all } = useAllCompanies();

  return (
    <div className="page page--full">
      <div className="card">
        <h2 className="card__title">My Companies</h2>
        {isLoading || !mine ? (
          <div className="loading">Loading your companies...</div>
        ) : mine.companies.length === 0 ? (
          <div className="empty-state">You don't own any companies yet — found one below.</div>
        ) : (
          <div className="company-grid">
            {mine.companies.map((c) => (
              <CompanyCard company={c} key={c.id} />
            ))}
          </div>
        )}
      </div>

      <FoundCompanyForm />

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
