import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { CURRENCIES, CURRENCY_CODES, POPULATION_TUNING, RESOURCE_LABELS, type CurrencyCode, type ResourceType } from "@dominion/shared";
import { api } from "../api/client.js";
import { useGameState, useMe } from "../api/hooks.js";
import { THEME_IDS, THEME_LABELS, useTheme } from "../theme.js";

const RESOURCE_COLORS: Record<ResourceType, string> = {
  food: "var(--series-food)",
  gold: "var(--series-gold)",
};

function formatNumber(value: number): string {
  return Math.floor(value).toLocaleString();
}

function formatRate(perHour: number): string {
  if (Math.abs(perHour) < 0.05) return "±0.0/hr";
  return `${perHour > 0 ? "+" : ""}${perHour.toFixed(1)}/hr`;
}

export default function TopBar() {
  const { data } = useGameState();
  const [now, setNow] = useState(new Date());
  const [theme, setTheme] = useTheme();
  const queryClient = useQueryClient();

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const { data: me } = useMe();

  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.setQueryData(["me"], null);
      queryClient.clear();
    },
  });

  const setCurrency = useMutation({
    mutationFn: (currencyCode: CurrencyCode) => api.setCurrency(currencyCode),
    onSuccess: (res) => {
      queryClient.setQueryData(["me"], (prev: typeof me) => (prev ? { ...prev, currencyCode: res.currencyCode } : prev));
    },
  });

  const s = data?.settlement;
  const pop = data?.population;
  const idleAvailable = pop ? Math.floor(pop.available) : 0;
  // The population's own starting default is 70% — below half is a real
  // "trending badly" signal worth flagging, not a hair-trigger on normal
  // day-to-day fluctuation.
  const lowHappiness = pop ? pop.happiness < 0.5 : false;

  // Ticks run once per real minute, so any single resource gain is tiny and
  // easy to miss. Food production now comes entirely from companies (the
  // legacy Farm building is gone), which isn't cheaply knowable client-side
  // — only the population's own consumption rate is, so that's all this
  // shows now (as a pure drain, not a net rate).
  const foodConsumptionPerHour = pop ? pop.count * POPULATION_TUNING.foodConsumptionPerCapitaPerHour : 0;
  const currencyCode = me?.currencyCode ?? "EUR";

  return (
    <div className="top-bar">
      <span className="top-bar__brand">DOMINION</span>

      <span className="resource-pill" title={`Population eats ${foodConsumptionPerHour.toFixed(1)}/hr`}>
        <span className="resource-pill__dot" style={{ background: RESOURCE_COLORS.food }} />
        <span className="resource-pill__value">{s ? formatNumber(s.food) : "—"}</span>
        <span className="resource-pill__label">{RESOURCE_LABELS.food}</span>
        {pop && (
          <span className="resource-pill__rate resource-pill__rate--down">{formatRate(-foodConsumptionPerHour)}</span>
        )}
      </span>

      <span className="resource-pill" title="Company cash, government treasury, and market activity move gold too fast for a single client-side rate">
        <span className="resource-pill__dot" style={{ background: RESOURCE_COLORS.gold }} />
        <span className="resource-pill__value">{s ? formatNumber(s.gold) : "—"}</span>
        <span className="resource-pill__label">{CURRENCIES[currencyCode].symbol}</span>
      </span>

      <span className="resource-pill">
        <span className="resource-pill__value">{pop ? Math.round(pop.count) : "—"}</span>
        <span className="resource-pill__label">/ {pop?.capacity ?? "—"} Pop</span>
      </span>

      <span
        className="resource-pill"
        title="Population not assigned to any company — found or auto-staff a company to put them to work."
      >
        <span className={`resource-pill__value${idleAvailable > 0 ? " resource-pill__value--attention" : ""}`}>
          {data ? idleAvailable : "—"}
        </span>
        <span className="resource-pill__label">Idle</span>
      </span>

      <span className="resource-pill">
        <span className={`resource-pill__value${lowHappiness ? " resource-pill__value--attention" : ""}`}>
          {pop ? Math.round(pop.happiness * 100) : "—"}%
        </span>
        <span className="resource-pill__label">Happiness</span>
      </span>

      <div className="top-bar__spacer" />

      <div className="top-bar__meta">
        <span>Era {s?.era ?? 1}</span>
        <span>{now.toLocaleTimeString()}</span>
        <select
          className="theme-select"
          value={currencyCode}
          onChange={(e) => setCurrency.mutate(e.target.value as CurrencyCode)}
          title="Preferred currency — display only, every currency is 1:1"
        >
          {CURRENCY_CODES.map((code) => (
            <option key={code} value={code}>
              {CURRENCIES[code].symbol} {code}
            </option>
          ))}
        </select>
        <select
          className="theme-select"
          value={theme}
          onChange={(e) => setTheme(e.target.value as (typeof THEME_IDS)[number])}
          title="Visual theme"
        >
          {THEME_IDS.map((id) => (
            <option key={id} value={id}>
              {THEME_LABELS[id]}
            </option>
          ))}
        </select>
        <button className="btn" onClick={() => logout.mutate()}>
          Log out
        </button>
      </div>
    </div>
  );
}
