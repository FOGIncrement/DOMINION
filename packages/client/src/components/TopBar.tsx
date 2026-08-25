import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  computeHourlyProduction,
  POPULATION_TUNING,
  RESOURCE_LABELS,
  type BuildingTypeId,
  type ResourceType,
} from "@dominion/shared";
import { api } from "../api/client.js";
import { useGameState } from "../api/hooks.js";
import { THEME_IDS, THEME_LABELS, useTheme } from "../theme.js";

const RESOURCE_COLORS: Record<ResourceType, string> = {
  food: "var(--series-food)",
  wood: "var(--series-wood)",
  stone: "var(--series-stone)",
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

  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.setQueryData(["me"], null);
      queryClient.clear();
    },
  });

  const s = data?.settlement;
  const pop = data?.population;

  // Ticks run once per real minute, so any single resource gain is tiny and
  // easy to miss. Show the actual hourly rate up front instead of making
  // players stare at the raw total waiting for it to visibly move.
  const hourlyProduction = data
    ? computeHourlyProduction(
        data.buildings.map((b) => ({
          type: b.type as BuildingTypeId,
          workersAssigned: b.workersAssigned,
          level: b.level,
        })),
        data.techIds,
      )
    : null;
  const foodConsumptionPerHour = pop ? pop.count * POPULATION_TUNING.foodConsumptionPerCapitaPerHour : 0;

  const netRates: Record<ResourceType, number> | null = hourlyProduction
    ? {
        food: hourlyProduction.food - foodConsumptionPerHour,
        wood: hourlyProduction.wood,
        stone: hourlyProduction.stone,
        gold: hourlyProduction.gold,
      }
    : null;

  return (
    <div className="top-bar">
      <span className="top-bar__brand">DOMINION</span>

      {(["food", "wood", "stone", "gold"] as ResourceType[]).map((type) => {
        const rate = netRates?.[type] ?? 0;
        const rateClass = rate > 0.05 ? "up" : rate < -0.05 ? "down" : "";
        const tooltip =
          type === "food"
            ? `Producing ${hourlyProduction?.food.toFixed(1) ?? 0} food/hr, population eats ${foodConsumptionPerHour.toFixed(1)}/hr`
            : `Producing ${(hourlyProduction?.[type] ?? 0).toFixed(1)} ${type}/hr. The tick runs once a minute, so watch the rate, not the number.`;

        return (
          <span className="resource-pill" key={type} title={tooltip}>
            <span className="resource-pill__dot" style={{ background: RESOURCE_COLORS[type] }} />
            <span className="resource-pill__value">{s ? formatNumber(s[type]) : "—"}</span>
            <span className="resource-pill__label">{RESOURCE_LABELS[type]}</span>
            {netRates && (
              <span className={`resource-pill__rate${rateClass ? ` resource-pill__rate--${rateClass}` : ""}`}>
                {formatRate(rate)}
              </span>
            )}
          </span>
        );
      })}

      <span className="resource-pill">
        <span className="resource-pill__value">{pop ? Math.round(pop.count) : "—"}</span>
        <span className="resource-pill__label">/ {pop?.capacity ?? "—"} Pop</span>
      </span>

      <span className="resource-pill">
        <span className="resource-pill__value">{pop ? Math.round(pop.happiness * 100) : "—"}%</span>
        <span className="resource-pill__label">Happiness</span>
      </span>

      <div className="top-bar__spacer" />

      <div className="top-bar__meta">
        <span>Era {s?.era ?? 1}</span>
        <span>{now.toLocaleTimeString()}</span>
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
