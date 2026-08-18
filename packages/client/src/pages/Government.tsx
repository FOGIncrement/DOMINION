import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client.js";
import { useGovernment, useMyCompanies } from "../api/hooks.js";

function invalidateGovernment(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["government"] });
  queryClient.invalidateQueries({ queryKey: ["myCompanies"] });
  queryClient.invalidateQueries({ queryKey: ["gameState"] });
}

function TaxRatesForm() {
  const { data: government } = useGovernment();
  const queryClient = useQueryClient();
  const [incomeRate, setIncomeRate] = useState(0);
  const [corporateRate, setCorporateRate] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (government) {
      setIncomeRate(Math.round(government.incomeTaxRate * 100));
      setCorporateRate(Math.round(government.corporateTaxRate * 100));
    }
  }, [government?.incomeTaxRate, government?.corporateTaxRate]);

  const save = useMutation({
    mutationFn: () =>
      api.setTaxRates({ incomeTaxRate: incomeRate / 100, corporateTaxRate: corporateRate / 100 }),
    onSuccess: () => {
      setError(null);
      setMessage("Tax rates updated.");
      invalidateGovernment(queryClient);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Couldn't update rates"),
  });

  if (!government) return <div className="loading">Loading government...</div>;

  const maxPct = Math.round(government.maxRate * 100);

  return (
    <div className="card">
      <h2 className="card__title">Tax Policy</h2>
      {error && <div className="auth-error">{error}</div>}
      {message && !error && <div className="suggestion">{message}</div>}

      <div className="field">
        <label htmlFor="incomeRate">Income tax — cut of every settlement market sale</label>
        <div className="trade-row">
          <input
            id="incomeRate"
            type="number"
            min={0}
            max={maxPct}
            value={incomeRate}
            onChange={(e) => setIncomeRate(Math.min(maxPct, Math.max(0, Number(e.target.value))))}
            style={{ width: 80 }}
          />
          <span className="suggestion">%</span>
        </div>
      </div>

      <div className="field">
        <label htmlFor="corporateRate">Corporate tax — cut of every company's goods sale</label>
        <div className="trade-row">
          <input
            id="corporateRate"
            type="number"
            min={0}
            max={maxPct}
            value={corporateRate}
            onChange={(e) => setCorporateRate(Math.min(maxPct, Math.max(0, Number(e.target.value))))}
            style={{ width: 80 }}
          />
          <span className="suggestion">%</span>
        </div>
      </div>

      <p className="suggestion" style={{ marginBottom: 12 }}>
        {incomeRate}% of every settlement sale and {corporateRate}% of every company goods sale routes straight to
        your treasury instead of your own pocket. Rates cap at {maxPct}%.
      </p>

      <button className="btn btn--accent" disabled={save.isPending} onClick={() => save.mutate()}>
        Save Rates
      </button>
    </div>
  );
}

function SubsidyForm() {
  const { data: government } = useGovernment();
  const { data: myCompanies } = useMyCompanies();
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [amount, setAmount] = useState(50);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const grant = useMutation({
    mutationFn: () => api.subsidize(companyId, amount),
    onSuccess: () => {
      setError(null);
      setMessage(`Granted ${amount}g subsidy.`);
      invalidateGovernment(queryClient);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Subsidy failed"),
  });

  const companies = myCompanies?.companies ?? [];

  return (
    <div className="card">
      <h2 className="card__title">Grant a Subsidy</h2>
      {companies.length === 0 ? (
        <div className="empty-state">Found a company first — subsidies are treasury-to-company grants.</div>
      ) : (
        <>
          {error && <div className="auth-error">{error}</div>}
          {message && !error && <div className="suggestion">{message}</div>}
          <div className="trade-row" style={{ flexWrap: "wrap" }}>
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">Company...</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input type="number" min={1} value={amount} onChange={(e) => setAmount(Math.max(1, Number(e.target.value)))} />
            <button
              className="btn btn--accent"
              disabled={!companyId || grant.isPending || !government || government.treasury < amount}
              onClick={() => grant.mutate()}
            >
              Grant
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function Government() {
  const { data: government } = useGovernment();

  return (
    <div className="page page--full">
      <div className="stat-tile-row">
        <div className="stat-tile">
          <div className="stat-tile__label">Treasury</div>
          <div className="stat-tile__value">{government ? government.treasury.toFixed(0) : "—"}g</div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile__label">Income Tax</div>
          <div className="stat-tile__value">{government ? Math.round(government.incomeTaxRate * 100) : "—"}%</div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile__label">Corporate Tax</div>
          <div className="stat-tile__value">{government ? Math.round(government.corporateTaxRate * 100) : "—"}%</div>
        </div>
      </div>

      <TaxRatesForm />
      <SubsidyForm />
    </div>
  );
}
