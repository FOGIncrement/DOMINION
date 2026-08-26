import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { PLOT_ZONING_SIZE } from "@dominion/shared";
import { api, ApiError, type ZoneRect } from "../api/client.js";
import { useAllCompanies, useGovernment, useMyCompanies, useMyZoneProjects, useTutorial, useWorldMap, useZones } from "../api/hooks.js";

// A modest default footprint for players commissioning straight from this
// form instead of dragging on the Map page — 25 cells, roughly what the
// old flat "+2 slots per commission" used to grant at today's
// CELLS_PER_ZONE_SLOT. The Map page's drag interaction is the primary way
// to size a zone deliberately; this is just a reasonable non-zero fallback
// so the form still works without ever visiting the map.
const DEFAULT_ZONE_SIZE = 5;

function rectsOverlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
}

function findFirstOpenRect(existing: ZoneRect[], width: number, height: number): { x: number; y: number } | null {
  for (let y = 0; y <= PLOT_ZONING_SIZE - height; y++) {
    for (let x = 0; x <= PLOT_ZONING_SIZE - width; x++) {
      const candidate = { x, y, width, height };
      if (!existing.some((z) => rectsOverlap(z, candidate))) {
        return { x, y };
      }
    }
  }
  return null;
}

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
  const { data: worldMap } = useWorldMap();
  const [zoneType, setZoneType] = useState("");
  const [constructionCompanyId, setConstructionCompanyId] = useState("");
  const [treasuryCost, setTreasuryCost] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const zoneList = zones?.zones ?? [];
  const selectedZone = zoneList.find((z) => z.id === zoneType);

  // Terms are a proposal the government makes, not a catalog lookup — the
  // suggested number just pre-fills the field so most commissions don't
  // require typing anything, but it can still be edited before sending.
  useEffect(() => {
    if (selectedZone) {
      setTreasuryCost(selectedZone.suggestedTreasuryCost);
    }
  }, [selectedZone]);

  const commission = useMutation({
    mutationFn: () => {
      const spot = findFirstOpenRect(worldMap?.myZones ?? [], DEFAULT_ZONE_SIZE, DEFAULT_ZONE_SIZE);
      if (!spot) throw new Error("No open space left on your plot — free up room on the Map page first.");
      return api.commissionZone(constructionCompanyId, zoneType, treasuryCost, {
        zoneX: spot.x,
        zoneY: spot.y,
        zoneWidth: DEFAULT_ZONE_SIZE,
        zoneHeight: DEFAULT_ZONE_SIZE,
      });
    },
    onSuccess: (res) => {
      setError(null);
      setMessage(res.pending ? "Commission sent — awaiting the construction company's acceptance." : "Commissioned — zone under construction.");
      invalidateGovernment(queryClient);
      queryClient.invalidateQueries({ queryKey: ["worldMap"] });
      if (tutorial?.step === "government_unlock") {
        api
          .tutorialAdvance("government_unlock")
          .then(() => api.tutorialAdvance("commission_zone"))
          .then(() => queryClient.invalidateQueries({ queryKey: ["tutorial"] }));
      }
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Commission failed"),
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
          <button
            className="btn btn--accent"
            disabled={!zoneType || !constructionCompanyId || treasuryCost <= 0 || commission.isPending}
            onClick={() => commission.mutate()}
          >
            Commission
          </button>
        </div>
      )}
      {selectedZone && (
        <p className="suggestion" style={{ marginTop: 8 }}>
          {selectedZone.description} Suggested treasury payment is {selectedZone.suggestedTreasuryCost}g — edit above
          to propose a different amount. Funded entirely from your treasury; the construction company doesn't need
          to stockpile any materials first. Takes {selectedZone.buildTimeHours}h to build once accepted. Commissioning
          here places a default {DEFAULT_ZONE_SIZE}×{DEFAULT_ZONE_SIZE} zone in the first open space on your plot,
          granting founding capacity for {selectedZone.industries.join(", ")} companies based on its size once
          complete — visit the Map page to size and place it yourself instead. If the company isn't yours, they'll
          need to accept the offer first.
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
              <td>{p.treasuryCost}g</td>
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
