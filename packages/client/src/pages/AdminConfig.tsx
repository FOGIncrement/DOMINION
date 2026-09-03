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

// Purely a display grouping so ~24 flat groups don't read as one wall of
// cards — has no bearing on what's actually editable (that's meta, from the
// server). Any group the server registry adds later that isn't listed here
// still renders, just under "Other," so this can drift without breaking.
const CATEGORY_ORDER = ["Population & Events", "Market & Trade", "Companies", "Territory & Military", "Stock Market", "Banking & Bonds", "NPC Economy", "Other"] as const;
const CATEGORY_FOR_GROUP: Record<string, (typeof CATEGORY_ORDER)[number]> = {
  POPULATION_TUNING: "Population & Events",
  HOUSING_TUNING: "Population & Events",
  EVENT_TUNING: "Population & Events",
  MARKET_TUNING: "Market & Trade",
  WORLD_DEMAND_TUNING: "Market & Trade",
  BASE_PRICES: "Market & Trade",
  TRADE_FEE: "Market & Trade",
  RETAIL_TUNING: "Market & Trade",
  LUXURY_GOODS_TUNING: "Market & Trade",
  COMPANY_UPGRADE_TUNING: "Companies",
  COMPANY_FACILITY_TUNING: "Companies",
  COMPANY_FAILURE_TUNING: "Companies",
  TERRITORY_TUNING: "Territory & Military",
  MILITARY_TUNING: "Territory & Military",
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

function TuningGroupCard({
  group,
  description,
  fields,
  values,
}: {
  group: string;
  description: string;
  fields: string[];
  values: Record<string, unknown>;
}) {
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
      {description && <p className="suggestion" style={{ margin: "0 0 10px" }}>{description}</p>}
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

// entry (a merged config.COMPANY_INDUSTRIES[id] record) only has the base
// fields (wagePerWorkerPerHour, etc.) as flat properties — the recipe rates
// live nested in entry.inputs[]/entry.outputs[], each {resource,
// perWorkerPerHour}. The synthetic field names in `fields` (e.g.
// "inputFlour", "outputElectricity") only exist server-side as a naming
// convention (see gameConfigStore.ts's recipeFieldKey) for validating
// patches — reading entry["inputFlour"] directly is always undefined. This
// rebuilds the same flat lookup client-side so the draft/dirty logic below
// can treat every field uniformly, base and recipe alike.
function flattenIndustryEntry(entry: Record<string, unknown>): Record<string, number> {
  const flat: Record<string, number> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (typeof value === "number") flat[key] = value;
  }
  const inputs = Array.isArray(entry.inputs) ? (entry.inputs as { resource: string; perWorkerPerHour: number }[]) : [];
  const outputs = Array.isArray(entry.outputs) ? (entry.outputs as { resource: string; perWorkerPerHour: number }[]) : [];
  for (const c of inputs) flat[`input${c.resource.charAt(0).toUpperCase()}${c.resource.slice(1)}`] = c.perWorkerPerHour;
  for (const c of outputs) flat[`output${c.resource.charAt(0).toUpperCase()}${c.resource.slice(1)}`] = c.perWorkerPerHour;
  return flat;
}

// One card per industry, not a shared table — each industry's recipe
// fields differ (Power Plant has no inputs, Bakery has three), so a single
// uniform column set doesn't fit the data. Mirrors TuningGroupCard's
// save/reset/dirty-tracking pattern, just keyed by industry id instead of
// by tuning group.
function CompanyIndustryCard({
  id,
  entry,
  fields,
}: {
  id: string;
  entry: Record<string, unknown>;
  fields: string[];
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const flatEntry = flattenIndustryEntry(entry);

  useEffect(() => {
    const next: Record<string, number> = {};
    for (const field of fields) next[field] = Number(flatEntry[field] ?? 0);
    setDraft(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(entry), fields.join(",")]);

  const dirty = fields.some((f) => draft[f] !== Number(flatEntry[f] ?? 0));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await api.adminSetRecord("COMPANY_INDUSTRIES", id, draft);
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
      const res = await api.adminResetRecord("COMPANY_INDUSTRIES", id);
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
        <span>{String(entry.name ?? id)}</span>
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
              step={field.startsWith("input") || field.startsWith("output") ? 0.1 : 1}
              value={Number.isFinite(draft[field]) ? draft[field] : 0}
              onChange={(e) => setDraft((d) => ({ ...d, [field]: Number(e.target.value) }))}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function CompanyIndustriesSection({
  description,
  fields,
  entries,
}: {
  description: string;
  fields: Record<string, string[]>;
  entries: Record<string, Record<string, unknown>>;
}) {
  const ids = Object.keys(entries);
  return (
    <div className="card">
      <h2 className="card__title">Company Industries</h2>
      {description && <p className="suggestion" style={{ marginTop: 0 }}>{description}</p>}
      <div className="admin-config-grid">
        {ids.map((id) => (
          <CompanyIndustryCard key={id} id={id} entry={entries[id] ?? {}} fields={fields[id] ?? []} />
        ))}
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

      <CompanyIndustriesSection
        description={meta.companyIndustriesDescription}
        fields={meta.companyIndustryFields}
        entries={(config.COMPANY_INDUSTRIES ?? {}) as Record<string, Record<string, unknown>>}
      />

      {CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((category) => (
        <div key={category} className="card">
          <h2 className="card__title">{category}</h2>
          <div className="admin-config-grid">
            {byCategory.get(category)!.map((group) => (
              <TuningGroupCard
                key={group}
                group={group}
                description={meta.flatGroupDescriptions[group]}
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
