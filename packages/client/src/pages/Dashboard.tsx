import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BUILDING_TYPES,
  computeHourlyProduction,
  RESOURCE_TYPES,
  TECHS,
  type BuildingTypeId,
  type ResourceType,
  type TechId,
} from "@dominion/shared";
import { api, ApiError, type GameStateResponse, type TechInfo } from "../api/client.js";
import { useGameState, useTechs } from "../api/hooks.js";
import { useState } from "react";

// Purely a client-side grouping for the build menu — no equivalent field on
// BuildingTypeDef itself, so this stays a local lookup rather than a shared
// package change.
const BUILDING_CATEGORIES: Record<BuildingTypeId, string> = {
  house: "Housing",
  farm: "Production",
  lumberCamp: "Production",
  quarry: "Production",
  marketplace: "Infrastructure",
};
const BUILDING_CATEGORY_ORDER = ["Housing", "Production", "Infrastructure"];

function formatCost(cost: Partial<Record<ResourceType, number>>): string {
  return RESOURCE_TYPES.filter((r) => cost[r]).map((r) => `${cost[r]} ${r}`).join(", ") || "free";
}

function canAfford(settlement: GameStateResponse["settlement"], cost: Partial<Record<ResourceType, number>>): boolean {
  return RESOURCE_TYPES.every((r) => settlement[r] >= (cost[r] ?? 0));
}

function buildSuggestions(state: GameStateResponse, techs: TechInfo[] | undefined): string[] {
  const suggestions: string[] = [];
  const { settlement, population, buildings } = state;

  if (settlement.food < 40) {
    suggestions.push("Food is running low — build a Farm or assign more workers to farming.");
  }
  if (population.count >= population.capacity * 0.9) {
    suggestions.push("Housing is nearly full — build a House to keep your population growing.");
  }
  if (!buildings.some((b) => b.type === "marketplace") && settlement.gold > 80 && techs?.some((t) => t.id === "currency" && t.researched)) {
    suggestions.push("Build a Marketplace to lower the fee on every trade.");
  }
  const hasQuarry = buildings.some((b) => b.type === "quarry");
  if (!hasQuarry && techs && !techs.find((t) => t.id === "masonry")?.researched) {
    suggestions.push("Research Masonry to unlock the Quarry and start producing stone.");
  }
  const idleWorkers = population.count - buildings.reduce((sum, b) => sum + b.workersAssigned, 0);
  if (idleWorkers >= 3) {
    suggestions.push(`You have ${Math.floor(idleWorkers)} idle population — assign them to a building.`);
  }

  return suggestions.slice(0, 4);
}

export default function Dashboard() {
  const { data, isLoading } = useGameState();
  const { data: techData } = useTechs();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["gameState"] });

  const setWorkers = useMutation({
    mutationFn: ({ buildingId, workers }: { buildingId: string; workers: number }) =>
      api.setWorkers(buildingId, workers),
    onSuccess: invalidate,
    onError: (err) => setActionError(err instanceof ApiError ? err.message : "Couldn't update workers"),
  });

  const build = useMutation({
    mutationFn: (type: BuildingTypeId) => api.build(type),
    onSuccess: invalidate,
    onError: (err) => setActionError(err instanceof ApiError ? err.message : "Couldn't build"),
  });

  const research = useMutation({
    mutationFn: (techId: TechId) => api.research(techId),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["techs"] });
    },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : "Couldn't research"),
  });

  if (isLoading || !data) {
    return (
      <div className="page">
        <div className="loading">Loading your settlement...</div>
      </div>
    );
  }

  const totalAssigned = data.buildings.reduce((sum, b) => sum + b.workersAssigned, 0);
  const idleWorkers = Math.floor(data.population.count - totalAssigned);
  const suggestions = buildSuggestions(data, techData?.techs);

  return (
    <div className="page">
      <div>
        {actionError && <div className="auth-error" style={{ marginBottom: 12 }}>{actionError}</div>}

        <div className="card">
          <h2 className="card__title">
            {data.settlement.name} · Buildings ({idleWorkers} idle worker{idleWorkers === 1 ? "" : "s"})
          </h2>
          <div className="building-grid">
            {data.buildings.map((b) => {
              const def = BUILDING_TYPES[b.type as BuildingTypeId];
              const canAddWorker = idleWorkers > 0 && b.workersAssigned < def.maxWorkers;
              return (
                <div className="building-card" key={b.id}>
                  <div className="building-card__head">
                    <span className="building-card__name">{def.name}</span>
                    <span className="building-card__count">Lv {b.level}</span>
                  </div>
                  <p className="building-card__desc">{def.description}</p>
                  {def.maxWorkers > 0 ? (
                    <div className="worker-row">
                      <button
                        disabled={b.workersAssigned <= 0 || setWorkers.isPending}
                        onClick={() => setWorkers.mutate({ buildingId: b.id, workers: b.workersAssigned - 1 })}
                      >
                        −
                      </button>
                      <span>
                        {b.workersAssigned} / {def.maxWorkers} workers
                      </span>
                      <button
                        disabled={!canAddWorker || setWorkers.isPending}
                        onClick={() => setWorkers.mutate({ buildingId: b.id, workers: b.workersAssigned + 1 })}
                      >
                        +
                      </button>
                    </div>
                  ) : (
                    <div className="worker-row">Houses +{def.populationCapacity} capacity</div>
                  )}
                  {def.producesResource && (
                    <div className="building-card__rate">
                      {b.workersAssigned > 0
                        ? `Producing ${computeHourlyProduction(
                            [{ type: b.type as BuildingTypeId, workersAssigned: b.workersAssigned, level: b.level }],
                            data.techIds,
                          )[def.producesResource].toFixed(1)} ${def.producesResource}/hr`
                        : "No workers assigned — producing nothing"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <h2 className="card__title">Build</h2>
          {BUILDING_CATEGORY_ORDER.map((category) => {
            const defsInCategory = Object.values(BUILDING_TYPES).filter(
              (def) => BUILDING_CATEGORIES[def.id] === category,
            );
            if (defsInCategory.length === 0) return null;
            return (
              <div key={category}>
                <div className="card-section-label">{category}</div>
                <div className="build-menu">
                  {defsInCategory.map((def) => {
                    const unlocked = !def.requiredTech || data.techIds.includes(def.requiredTech);
                    const affordable = canAfford(data.settlement, def.cost);
                    return (
                      <div className="build-option" key={def.id}>
                        <div className="building-card__head">
                          <span className="building-card__name">{def.name}</span>
                        </div>
                        <p className="building-card__desc">{def.description}</p>
                        <span className="build-option__cost">{formatCost(def.cost)}</span>
                        {unlocked ? (
                          <button
                            className="btn"
                            disabled={!affordable || build.isPending}
                            onClick={() => build.mutate(def.id)}
                          >
                            Build
                          </button>
                        ) : (
                          <span className="build-option__cost">Requires {TECHS[def.requiredTech!].name}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="card">
          <h2 className="card__title">Technology</h2>
          <div className="build-menu">
            {(techData?.techs ?? []).map((tech) => (
              <div className="build-option" key={tech.id}>
                <div className="building-card__head">
                  <span className="building-card__name">{tech.name}</span>
                </div>
                <p className="building-card__desc">{tech.description}</p>
                <span className="build-option__cost">{formatCost(tech.cost)}</span>
                {tech.researched ? (
                  <span className="build-option__cost">Researched</span>
                ) : tech.available ? (
                  <button
                    className="btn"
                    disabled={!canAfford(data.settlement, tech.cost) || research.isPending}
                    onClick={() => research.mutate(tech.id as TechId)}
                  >
                    Research
                  </button>
                ) : (
                  <span className="build-option__cost">Requires {TECHS[tech.requiredTech as TechId]?.name}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="page__side">
        <div className="card">
          <h2 className="card__title">Priorities</h2>
          {suggestions.length === 0 ? (
            <div className="suggestion">Your settlement is running smoothly.</div>
          ) : (
            suggestions.map((s, i) => (
              <div className="suggestion" key={i}>
                {s}
              </div>
            ))
          )}
        </div>

        <div className="card">
          <h2 className="card__title">Settlement</h2>
          <div className="suggestion">Founded {new Date(data.settlement.foundedAt).toLocaleDateString()}</div>
          <div className="suggestion">Storage cap {data.settlement.storageCap} per resource</div>
          <div className="suggestion">
            Resources tick once a minute — watch the +/hr rate next to each resource up top rather than
            the totals; they'll barely move minute to minute.
          </div>
        </div>
      </div>
    </div>
  );
}
