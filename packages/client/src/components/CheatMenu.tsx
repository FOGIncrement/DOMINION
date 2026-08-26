import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api/client.js";
import { useCheatsEnabled, useMe, useMyCompanies } from "../api/hooks.js";

function invalidateEverything(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries();
}

export default function CheatMenu() {
  const { data: status } = useCheatsEnabled();
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { data: myCompanies } = useMyCompanies();

  const [resourceAmount, setResourceAmount] = useState(500);
  const [populationAmount, setPopulationAmount] = useState(10);
  const [companyId, setCompanyId] = useState("");
  const [companyCashAmount, setCompanyCashAmount] = useState(500);
  const [offlineHours, setOfflineHours] = useState(8);

  const report = (label: string) => (err: unknown) => {
    if (err) {
      setMessage(null);
      setError(err instanceof ApiError ? err.message : `${label} failed`);
    } else {
      setError(null);
      setMessage(`${label} done.`);
      invalidateEverything(queryClient);
    }
  };

  const addResources = useMutation({
    mutationFn: (resource: "food" | "wood" | "stone" | "gold") => api.cheatAddResources({ [resource]: resourceAmount }),
    onSuccess: () => report("Add resources")(null),
    onError: report("Add resources"),
  });

  const addPopulation = useMutation({
    mutationFn: () => api.cheatAddPopulation(populationAmount),
    onSuccess: () => report("Add population")(null),
    onError: report("Add population"),
  });

  const forceTick = useMutation({
    mutationFn: () => api.cheatForceTick(),
    onSuccess: (res) => {
      setError(null);
      setMessage(`Tick forced: ${res.settlementsProcessed} settlements, ${res.companiesProcessed} companies.`);
      invalidateEverything(queryClient);
    },
    onError: report("Force tick"),
  });

  const addCompanyCash = useMutation({
    mutationFn: () => api.cheatAddCompanyCash(companyId, companyCashAmount),
    onSuccess: () => report("Add company cash")(null),
    onError: report("Add company cash"),
  });

  const simulateOffline = useMutation({
    mutationFn: () => api.cheatSimulateOffline(offlineHours),
    onSuccess: () => report("Simulate offline")(null),
    onError: report("Simulate offline"),
  });

  if (!status?.enabled) return null;

  return (
    <div className="cheat-menu">
      <button className="cheat-menu__toggle" onClick={() => setOpen((o) => !o)}>
        🛠 Cheats
      </button>
      {open && (
        <div className="cheat-menu__panel">
          <div className="cheat-menu__title">Dev Cheat Menu</div>
          {me?.isAdmin && (
            <div className="cheat-menu__section">
              <Link className="btn btn--accent" to="/admin/config">
                Balance Config →
              </Link>
            </div>
          )}
          {error && <div className="auth-error">{error}</div>}
          {message && !error && <div className="suggestion">{message}</div>}

          <div className="cheat-menu__section">
            <div className="cheat-menu__label">Add resources</div>
            <div className="trade-row">
              <input
                type="number"
                value={resourceAmount}
                onChange={(e) => setResourceAmount(Number(e.target.value))}
                style={{ width: 80 }}
              />
              {(["food", "wood", "stone", "gold"] as const).map((r) => (
                <button key={r} className="btn" disabled={addResources.isPending} onClick={() => addResources.mutate(r)}>
                  +{r}
                </button>
              ))}
            </div>
          </div>

          <div className="cheat-menu__section">
            <div className="cheat-menu__label">Add population</div>
            <div className="trade-row">
              <input
                type="number"
                value={populationAmount}
                onChange={(e) => setPopulationAmount(Number(e.target.value))}
                style={{ width: 80 }}
              />
              <button className="btn" disabled={addPopulation.isPending} onClick={() => addPopulation.mutate()}>
                Add
              </button>
            </div>
          </div>

          <div className="cheat-menu__section">
            <div className="cheat-menu__label">Simulation</div>
            <div className="trade-row">
              <button className="btn btn--accent" disabled={forceTick.isPending} onClick={() => forceTick.mutate()}>
                Force tick now
              </button>
            </div>
            <div className="trade-row" style={{ marginTop: 6 }}>
              <input
                type="number"
                value={offlineHours}
                onChange={(e) => setOfflineHours(Number(e.target.value))}
                style={{ width: 60 }}
              />
              <button className="btn" disabled={simulateOffline.isPending} onClick={() => simulateOffline.mutate()}>
                Simulate hours away
              </button>
            </div>
          </div>

          {myCompanies && myCompanies.companies.length > 0 && (
            <div className="cheat-menu__section">
              <div className="cheat-menu__label">Add company cash</div>
              <div className="trade-row" style={{ flexWrap: "wrap" }}>
                <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                  <option value="">Company...</option>
                  {myCompanies.companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  value={companyCashAmount}
                  onChange={(e) => setCompanyCashAmount(Number(e.target.value))}
                  style={{ width: 80 }}
                />
                <button
                  className="btn"
                  disabled={!companyId || addCompanyCash.isPending}
                  onClick={() => addCompanyCash.mutate()}
                >
                  Add
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
