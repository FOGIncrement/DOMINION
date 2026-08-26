import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client.js";
import { useAllCompanies, useGovernment, useMyCompanies, useMyZoneProjects, useTutorial, useZones } from "../api/hooks.js";

function invalidateGovernment(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["government"] });
  queryClient.invalidateQueries({ queryKey: ["myCompanies"] });
  queryClient.invalidateQueries({ queryKey: ["gameState"] });
  queryClient.invalidateQueries({ queryKey: ["zones"] });
  queryClient.invalidateQueries({ queryKey: ["myZoneProjects"] });
}

const ZONE_STATUS_LABELS: Record<string, string> = {
  pending: "Awaiting acceptance",
  building: "Building",
  completed: "Completed",
  cancelled: "Cancelled",
};

function ZoneCommissionForm() {
  const queryClient = useQueryClient();
  const { data: zones } = useZones();
  const { data: allCompanies } = useAllCompanies();
  const { data: tutorial } = useTutorial();
  const [zoneType, setZoneType] = useState("");
  const [constructionCompanyId, setConstructionCompanyId] = useState("");
  const [treasuryCost, setTreasuryCost] = useState(0);
  const [goodsCost, setGoodsCost] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const zoneList = zones?.zones ?? [];
  const selectedZone = zoneList.find((z) => z.id === zoneType);

  // Terms are a proposal the government makes, not a catalog lookup — the
  // suggested numbers just pre-fill the fields so most commissions don't
  // require typing anything, but either can be edited before sending.
  useEffect(() => {
    if (selectedZone) {
      setTreasuryCost(selectedZone.suggestedTreasuryCost);
      setGoodsCost(selectedZone.suggestedGoodsCost);
    }
  }, [selectedZone]);

  const commission = useMutation({
    mutationFn: () => api.commissionZone(constructionCompanyId, zoneType, treasuryCost, goodsCost),
    onSuccess: (res) => {
      setError(null);
      setMessage(res.pending ? "Commission sent — awaiting the construction company's acceptance." : "Commissioned — zone under construction.");
      invalidateGovernment(queryClient);
      if (tutorial?.step === "government_unlock") {
        api
          .tutorialAdvance("government_unlock")
          .then(() => api.tutorialAdvance("commission_zone"))
          .then(() => queryClient.invalidateQueries({ queryKey: ["tutorial"] }));
      }
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Commission failed"),
  });

  const constructionCompanies = (allCompanies?.companies ?? []).filter((c) => c.industry === "construction");

  if (zoneList.length === 0) {
    return (
      <div className="card">
        <h2 className="card__title">Commission a Zone</h2>
        <div className="loading">Loading zone catalog...</div>
      </div>
    );
  }

  return (
    <div className="card" data-tutorial="tutorial-zone-form">
      <h2 className="card__title">Commission a Zone</h2>
      {error && <div className="auth-error">{error}</div>}
      {message && !error && <div className="suggestion">{message}</div>}
      <div className="trade-row" style={{ flexWrap: "wrap" }}>
        <select value={zoneType} onChange={(e) => setZoneType(e.target.value)}>
          <option value="">Zone type...</option>
          {zoneList.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name} ({z.used}/{z.available} capacity used)
            </option>
          ))}
        </select>
        <select value={constructionCompanyId} onChange={(e) => setConstructionCompanyId(e.target.value)}>
          <option value="">Construction company...</option>
          {constructionCompanies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} {c.isPlayerOwned ? "" : "(NPC/other player)"}
            </option>
          ))}
        </select>
      </div>
      {selectedZone && (
        <div className="trade-row" style={{ flexWrap: "wrap", marginTop: 8 }}>
          <label className="suggestion" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            Treasury offer
            <input
              type="number"
              min={0}
              step={5}
              value={treasuryCost}
              onChange={(e) => setTreasuryCost(Math.max(0, Number(e.target.value) || 0))}
              style={{ width: 90 }}
            />
            g
          </label>
          <label className="suggestion" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            Goods required
            <input
              type="number"
              min={0}
              step={5}
              value={goodsCost}
              onChange={(e) => setGoodsCost(Math.max(0, Number(e.target.value) || 0))}
              style={{ width: 90 }}
            />
          </label>
          <button
            className="btn btn--accent"
            disabled={!zoneType || !constructionCompanyId || treasuryCost <= 0 || goodsCost <= 0 || commission.isPending}
            onClick={() => commission.mutate()}
          >
            Commission
          </button>
        </div>
      )}
      {selectedZone && (
        <p className="suggestion" style={{ marginTop: 8 }}>
          {selectedZone.description} Suggested terms are {selectedZone.suggestedGoodsCost}g worth of goods stock from
          the construction company plus {selectedZone.suggestedTreasuryCost}g from your treasury — edit either
          above to propose different terms. Takes {selectedZone.buildTimeHours}h to build once accepted, and grants
          +{selectedZone.slotsGranted} founding capacity for {selectedZone.industries.join(", ")} companies once
          complete. If the company isn't yours, they'll need to accept the offer first.
        </p>
      )}
      {constructionCompanies.length === 0 && (
        <p className="suggestion" style={{ marginTop: 8 }}>
          No construction companies exist yet — found one on the Companies page, or wait for an NPC to found one.
        </p>
      )}
    </div>
  );
}

function MyZoneProjectsList() {
  const queryClient = useQueryClient();
  const { data } = useMyZoneProjects();
  const [error, setError] = useState<string | null>(null);

  const accept = useMutation({
    mutationFn: (id: string) => api.acceptZoneProject(id),
    onSuccess: () => {
      setError(null);
      invalidateGovernment(queryClient);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Couldn't accept"),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelZoneProject(id),
    onSuccess: () => {
      setError(null);
      invalidateGovernment(queryClient);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Couldn't cancel"),
  });

  if (!data || data.projects.length === 0) {
    return (
      <div className="card">
        <h2 className="card__title">Zone Projects</h2>
        <div className="empty-state">No zone commissions yet.</div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="card__title">Zone Projects</h2>
      {error && <div className="auth-error">{error}</div>}
      <table className="settlement-table">
        <thead>
          <tr>
            <th>Zone</th>
            <th>Construction Co.</th>
            <th>Cost</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {data.projects.map((p) => (
            <tr key={p.id}>
              <td>{p.zoneType}</td>
              <td>{p.constructionCompanyName}</td>
              <td>{p.goodsCost}g goods, {p.treasuryCost}g treasury</td>
              <td>{ZONE_STATUS_LABELS[p.status] ?? p.status}</td>
              <td>
                {p.status === "pending" && p.constructionCompanyIsMine && (
                  <button className="btn" disabled={accept.isPending} onClick={() => accept.mutate(p.id)}>
                    Accept
                  </button>
                )}
                {p.status === "pending" && (p.governmentIsMine || p.constructionCompanyIsMine) && (
                  <button className="btn btn--danger" disabled={cancel.isPending} onClick={() => cancel.mutate(p.id)}>
                    Cancel
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TaxRatesForm() {
  const { data: government } = useGovernment();
  const queryClient = useQueryClient();
  const [incomeRate, setIncomeRate] = useState(0);
  const [corporateRate, setCorporateRate] = useState(0);
  const [welfareRate, setWelfareRate] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (government) {
      setIncomeRate(Math.round(government.incomeTaxRate * 100));
      setCorporateRate(Math.round(government.corporateTaxRate * 100));
      setWelfareRate(government.welfareRatePerUnemployedPerHour);
    }
  }, [government?.incomeTaxRate, government?.corporateTaxRate, government?.welfareRatePerUnemployedPerHour]);

  const save = useMutation({
    mutationFn: () =>
      api.setTaxRates({
        incomeTaxRate: incomeRate / 100,
        corporateTaxRate: corporateRate / 100,
        welfareRatePerUnemployedPerHour: welfareRate,
      }),
    onSuccess: () => {
      setError(null);
      setMessage("Rates updated.");
      invalidateGovernment(queryClient);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Couldn't update rates"),
  });

  if (!government) return <div className="loading">Loading government...</div>;

  const maxPct = Math.round(government.maxRate * 100);
  const maxWelfare = government.maxWelfareRate;

  return (
    <div className="card">
      <h2 className="card__title">Tax &amp; Welfare Policy</h2>
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

      <div className="field">
        <label htmlFor="welfareRate">Welfare — gold paid per unemployed citizen, every hour</label>
        <div className="trade-row">
          <input
            id="welfareRate"
            type="number"
            min={0}
            max={maxWelfare}
            step={0.1}
            value={welfareRate}
            onChange={(e) => setWelfareRate(Math.min(maxWelfare, Math.max(0, Number(e.target.value))))}
            style={{ width: 80 }}
          />
          <span className="suggestion">g / unemployed / hr</span>
        </div>
      </div>

      <p className="suggestion" style={{ marginBottom: 12 }}>
        {incomeRate}% of every settlement sale and {corporateRate}% of every company goods sale routes straight to
        your treasury. Every citizen without a job costs the treasury {welfareRate.toFixed(1)}g/hr — set it to 0
        for no safety net, or raise it to keep unemployment from costing your people anything. Tax rates cap at
        {" "}{maxPct}%, welfare at {maxWelfare}g/hr.
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
        <div className="stat-tile">
          <div className="stat-tile__label">Employment</div>
          <div className="stat-tile__value">
            {government ? `${government.employedCount} / ${Math.round(government.populationCount)}` : "—"}
          </div>
          <div className="stat-tile__delta">
            {government ? `${Math.round(government.unemployedCount)} unemployed` : ""}
          </div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile__label">Welfare Spending</div>
          <div className="stat-tile__value">{government ? government.welfareCostPerHour.toFixed(1) : "—"}g/hr</div>
        </div>
      </div>

      <TaxRatesForm />
      <SubsidyForm />
      <ZoneCommissionForm />
      <MyZoneProjectsList />
    </div>
  );
}
