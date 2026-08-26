import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, ApiError, type AdminConfigResponse } from "../api/client.js";
import { useAdminConfig } from "../api/hooks.js";

function formatGroupLabel(name: string): string {
  return name
    .toLowerCase()
    .split("_")
    .map((w) => (w === "npc" ? "NPC" : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

function formatFieldLabel(field: string): string {
  return field
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

// Purely a display grouping so ~21 flat groups don't read as one wall of
// cards — has no bearing on what's actually editable (that's meta, from the
// server). Any group the server registry adds later that isn't listed here
// still renders, just under "Other," so this can drift without breaking.
const CATEGORY_ORDER = ["Population & Events", "Market & Trade", "Companies & Buildings", "Stock Market", "Banking & Bonds", "NPC Economy", "Other"] as const;
const CATEGORY_FOR_GROUP: Record<string, (typeof CATEGORY_ORDER)[number]> = {
  POPULATION_TUNING: "Population & Events",
  EVENT_TUNING: "Population & Events",
  MARKET_TUNING: "Market & Trade",
  WORLD_DEMAND_TUNING: "Market & Trade",
  BASE_PRICES: "Market & Trade",
  TRADE_FEE: "Market & Trade",
  RETAIL_TUNING: "Market & Trade",
  LUXURY_GOODS_TUNING: "Market & Trade",
  COMPANY_UPGRADE_TUNING: "Companies & Buildings",
  COMPANY_FAILURE_TUNING: "Companies & Buildings",
  BUILDING_UPGRADE_TUNING: "Companies & Buildings",
  STOCK_TUNING: "Stock Market",
  DIVIDEND_TUNING: "Stock Market",
  NPC_INVESTOR_TUNING: "Stock Market",
  BANK_TUNING: "Banking & Bonds",
  NPC_BANKING_TUNING: "Banking & Bonds",
  DEPOSIT_TUNING: "Banking & Bonds",
  BOND_TUNING: "Banking & Bonds",
  CORPORATE_BOND_TUNING: "Banking & Bonds",
  NPC_GROWTH_TUNING: "NPC Economy",
  NPC_COMPANY_TUNING: "NPC Economy",
};

function setConfigCache(queryClient: ReturnType<typeof useQueryClient>, config: AdminConfigResponse["config"]) {
  queryClient.setQueryData<AdminConfigResponse | undefined>(["adminConfig"], (old) => (old ? { ...old, config } : old));
}

function TuningGroupCard({ group, fields, values }: { group: string; fields: string[]; values: Record<string, unknown> }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const next: Record<string, number> = {};
    for (const field of fields) next[field] = Number(values[field] ?? 0);
    setDraft(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(values)]);

  const dirty = fields.some((f) => draft[f] !== Number(values[f] ?? 0));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await api.adminSetFlat(group, draft);
      setConfigCache(queryClient, res.config);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await api.adminResetFlat(group);
      setConfigCache(queryClient, res.config);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Reset failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-config-card">
      <div className="admin-config-card__header">
        <span>{formatGroupLabel(group)}</span>
        <div className="trade-row">
          <button className="btn btn--accent" disabled={!dirty || saving} onClick={save}>
            Save
          </button>
          <button className="btn" disabled={saving} onClick={reset}>
            Reset
          </button>
        </div>
      </div>
      {error && <div className="auth-error">{error}</div>}
      <div className="admin-config-card__fields">
        {fields.map((field) => (
          <label key={field} className="admin-config-field">
            <span>{formatFieldLabel(field)}</span>
            <input
              type="number"
              value={Number.isFinite(draft[field]) ? draft[field] : 0}
              onChange={(e) => setDraft((d) => ({ ...d, [field]: Number(e.target.value) }))}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function RecordGroupTable({
  title,
  group,
  fields,
  entries,
}: {
  title: string;
  group: "COMPANY_INDUSTRIES" | "BUILDING_TYPES";
  fields: string[];
  entries: Record<string, Record<string, unknown>>;
}) {
  const queryClient = useQueryClient();
  const ids = Object.keys(entries);
  const [drafts, setDrafts] = useState<Record<string, Record<string, number>>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [savingRow, setSavingRow] = useState<string | null>(null);

  useEffect(() => {
    const next: Record<string, Record<string, number>> = {};
    for (const [id, entry] of Object.entries(entries)) {
      const row: Record<string, number> = {};
      for (const field of fields) row[field] = Number(entry[field] ?? 0);
      next[id] = row;
    }
    setDrafts(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(entries)]);

  const isDirty = (id: string) => fields.some((f) => drafts[id]?.[f] !== Number(entries[id]?.[f] ?? 0));

  const saveRow = async (id: string) => {
    setSavingRow(id);
    setRowError((e) => ({ ...e, [id]: "" }));
    try {
      const res = await api.adminSetRecord(group, id, drafts[id] ?? {});
      setConfigCache(queryClient, res.config);
    } catch (err) {
      setRowError((e) => ({ ...e, [id]: err instanceof ApiError ? err.message : "Save failed" }));
    } finally {
      setSavingRow(null);
    }
  };

  const resetRow = async (id: string) => {
    setSavingRow(id);
    setRowError((e) => ({ ...e, [id]: "" }));
    try {
      const res = await api.adminResetRecord(group, id);
      setConfigCache(queryClient, res.config);
    } catch (err) {
      setRowError((e) => ({ ...e, [id]: err instanceof ApiError ? err.message : "Reset failed" }));
    } finally {
      setSavingRow(null);
    }
  };

  return (
    <div className="card">
      <h2 className="card__title">{title}</h2>
      <div className="table-scroll">
        <table className="settlement-table">
          <thead>
            <tr>
              <th>Name</th>
              {fields.map((f) => (
                <th key={f}>{formatFieldLabel(f)}</th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ids.map((id) => (
              <tr key={id}>
                <td>{String(entries[id]?.name ?? id)}</td>
                {fields.map((field) => (
                  <td key={field}>
                    <input
                      type="number"
                      style={{ width: 90 }}
                      value={drafts[id]?.[field] ?? 0}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [id]: { ...d[id], [field]: Number(e.target.value) } }))
                      }
                    />
                  </td>
                ))}
                <td>
                  <div className="trade-row">
                    <button
                      className="btn btn--accent"
                      disabled={!isDirty(id) || savingRow === id}
                      onClick={() => saveRow(id)}
                    >
                      Save
                    </button>
                    <button className="btn" disabled={savingRow === id} onClick={() => resetRow(id)}>
                      Reset
                    </button>
                  </div>
                  {rowError[id] && <div className="auth-error">{rowError[id]}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AdminConfig() {
  const { data, isLoading, isError } = useAdminConfig();
  const queryClient = useQueryClient();
  const [resetting, setResetting] = useState(false);

  if (isLoading) return <div className="page page--full"><div className="loading">Loading balance config...</div></div>;
  if (isError || !data) {
    return (
      <div className="page page--full">
        <div className="empty-state">Couldn't load the balance config — admin access required.</div>
      </div>
    );
  }

  const { config, meta } = data;
  const groupNames = Object.keys(meta.flatGroups);
  const byCategory = new Map<string, string[]>();
  for (const group of groupNames) {
    const category = CATEGORY_FOR_GROUP[group] ?? "Other";
    byCategory.set(category, [...(byCategory.get(category) ?? []), group]);
  }

  const resetAll = async () => {
    if (!window.confirm("Reset every balance setting to its default? This clears all admin edits.")) return;
    setResetting(true);
    try {
      const res = await api.adminResetAll();
      setConfigCache(queryClient, res.config);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="page page--full">
      <div className="card">
        <h2 className="card__title">Balance Config</h2>
        <p className="suggestion" style={{ marginBottom: 0 }}>
          Live-editable tuning for the whole game — changes apply to the very next tick, no restart needed. Only
          visible to your admin account, and separate from the disposable cheats below (this stays on even if those
          are ever switched off).
        </p>
      </div>

      <RecordGroupTable
        title="Company Industries"
        group="COMPANY_INDUSTRIES"
        fields={meta.companyIndustryFields}
        entries={(config.COMPANY_INDUSTRIES ?? {}) as Record<string, Record<string, unknown>>}
      />
      <RecordGroupTable
        title="Building Types"
        group="BUILDING_TYPES"
        fields={meta.buildingTypeFields}
        entries={(config.BUILDING_TYPES ?? {}) as Record<string, Record<string, unknown>>}
      />

      {CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((category) => (
        <div key={category} className="card">
          <h2 className="card__title">{category}</h2>
          <div className="admin-config-grid">
            {byCategory.get(category)!.map((group) => (
              <TuningGroupCard
                key={group}
                group={group}
                fields={meta.flatGroups[group]}
                values={(config[group] ?? {}) as Record<string, unknown>}
              />
            ))}
          </div>
        </div>
      ))}

      <div className="card">
        <button className="btn btn--danger" disabled={resetting} onClick={resetAll}>
          Reset everything to defaults
        </button>
      </div>
    </div>
  );
}
