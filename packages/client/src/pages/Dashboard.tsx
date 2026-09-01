import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
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
import { useGameState, useMyTerritories, useTechs } from "../api/hooks.js";
import { useState, type SVGProps } from "react";
import {
  BookIcon,
  HammerIcon,
  HouseIcon,
  MountainIcon,
  StorefrontIcon,
  TreeIcon,
  WheatIcon,
  CheckCircleIcon,
} from "../icons.js";

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

const BUILDING_ICONS: Record<BuildingTypeId, (props: SVGProps<SVGSVGElement>) => JSX.Element> = {
  house: HouseIcon,
  farm: WheatIcon,
  lumberCamp: TreeIcon,
  quarry: MountainIcon,
  marketplace: StorefrontIcon,
};

function BuildingIcon({ type }: { type: BuildingTypeId }) {
  const Icon = BUILDING_ICONS[type] ?? HouseIcon;
  return <Icon className="icon" style={{ width: 18, height: 18 }} />;
}

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
    const hasIdleFarmWorker = buildings.some(
      (b) => b.type === "farm" && b.workersAssigned < BUILDING_TYPES.farm.maxWorkers,
    );
    suggestions.push(
      hasIdleFarmWorker
        ? "Food is running low — assign more workers to your Farm."
        : "Food is running low — found a Farm company for more food production.",
    );
  }
  if (population.count >= population.capacity * 0.9) {
    suggestions.push("Housing is nearly full — build a House to keep your population growing.");
  }
  if (!buildings.some((b) => b.type === "marketplace") && settlement.gold > 80 && techs?.some((t) => t.id === "currency" && t.researched)) {
    suggestions.push("Build a Marketplace to lower the fee on every trade.");
  }
  const hasQuarry = buildings.some((b) => b.type === "quarry");
  if (!hasQuarry && settlement.stone < 20) {
    suggestions.push("No stone production yet — found a Quarry company to start producing it.");
  }
  if (population.available >= 3) {
    suggestions.push(`You have ${Math.floor(population.available)} idle population — assign them to a building.`);
  }

  return suggestions.slice(0, 4);
}

// Techs only ever have zero or one prerequisite, so the dependency graph is
// a simple chain, not a general DAG — this just walks requiredTech links to
// find each tech's depth instead of hardcoding tier numbers.
function techTier(techId: string, seen = new Set<string>()): number {
  if (seen.has(techId)) return 0; // guards a malformed cycle rather than looping forever
  const def = TECHS[techId as TechId];
  if (!def?.requiredTech) return 0;
  return 1 + techTier(def.requiredTech, new Set(seen).add(techId));
}

type DashboardTab = "overview" | "build" | "research";

export default function Dashboard() {
  const { data, isLoading } = useGameState();
  const { data: techData } = useTechs();
  const { data: territoryData } = useMyTerritories();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");
  const [buildCategory, setBuildCategory] = useState<string>("All");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["gameState"] });

  const setWorkers = useMutation({
    mutationFn: ({ buildingId, workers }: { buildingId: string; workers: number }) =>
      api.setWorkers(buildingId, workers),
    onSuccess: invalidate,
    onError: (err) => setActionError(err instanceof ApiError ? err.message : "Couldn't update workers"),
  });

  const upgradeBuilding = useMutation({
    mutationFn: (buildingId: string) => api.upgradeBuilding(buildingId),
    onSuccess: invalidate,
    onError: (err) => setActionError(err instanceof ApiError ? err.message : "Couldn't upgrade"),
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
  // Population minus buildings AND company workers — not just buildings —
  // so this matches what the server actually enforces when hiring more.
  const idleWorkers = Math.floor(data.population.available);
  const idleBuildings = data.buildings.filter((b) => {
    const def = BUILDING_TYPES[b.type as BuildingTypeId];
    return def.maxWorkers > 0 && b.workersAssigned === 0;
  }).length;
  const suggestions = buildSuggestions(data, techData?.techs);

  const buildableNow = Object.values(BUILDING_TYPES).filter((def) => {
    if (def.retiredForConstruction) return false;
    const unlocked = !def.requiredTech || data.techIds.includes(def.requiredTech);
    return unlocked && canAfford(data.settlement, def.cost);
  }).length;

  const availableTechs = (techData?.techs ?? []).filter((t) => !t.researched && t.available).length;

  const buildCategories = ["All", ...BUILDING_CATEGORY_ORDER];
  const visibleBuildOptions = Object.values(BUILDING_TYPES).filter(
    (def) => buildCategory === "All" || BUILDING_CATEGORIES[def.id] === buildCategory,
  );

  const techsByTier = new Map<number, TechInfo[]>();
  for (const tech of techData?.techs ?? []) {
    const tier = techTier(tech.id);
    techsByTier.set(tier, [...(techsByTier.get(tier) ?? []), tech]);
  }
  const tierNumbers = [...techsByTier.keys()].sort((a, b) => a - b);

  return (
    <div className="page">
      <div>
        {actionError && <div className="auth-error" style={{ marginBottom: 12 }}>{actionError}</div>}

        <div className="page-tabs">
          <button
            className={`page-tab${activeTab === "overview" ? " page-tab--active" : ""}`}
            onClick={() => setActiveTab("overview")}
          >
            <HouseIcon className="icon" />
            Overview
          </button>
          <button
            className={`page-tab${activeTab === "build" ? " page-tab--active" : ""}`}
            onClick={() => setActiveTab("build")}
          >
            <HammerIcon className="icon" />
            Build
            {buildableNow > 0 && <span className="page-tab__badge">{buildableNow}</span>}
          </button>
          <button
            className={`page-tab${activeTab === "research" ? " page-tab--active" : ""}`}
            onClick={() => setActiveTab("research")}
          >
            <BookIcon className="icon" />
            Research
            {availableTechs > 0 && <span className="page-tab__badge">{availableTechs}</span>}
          </button>
        </div>

        <div className="page-panel">
          {activeTab === "overview" && (
            <>
              <div className="summary-bar">
                <div className="summary-stat">
                  <div className="summary-stat__label">Buildings</div>
                  <div className="summary-stat__value">{data.buildings.length}</div>
                </div>
                <div className="summary-stat">
                  <div className="summary-stat__label">Workers assigned</div>
                  <div className="summary-stat__value">{totalAssigned}</div>
                </div>
                <div className="summary-stat">
                  <div className="summary-stat__label">Idle population</div>
                  <div className={`summary-stat__value${idleWorkers >= 3 ? " attention" : ""}`}>{idleWorkers}</div>
                </div>
                <div className="summary-stat">
                  <div className="summary-stat__label">Unstaffed buildings</div>
                  <div className={`summary-stat__value${idleBuildings > 0 ? " attention" : ""}`}>{idleBuildings}</div>
                </div>
              </div>

              <div className="card-section-label" style={{ marginTop: 0 }}>
                {data.settlement.name} · Buildings
              </div>
              {data.buildings.map((b) => {
                const def = BUILDING_TYPES[b.type as BuildingTypeId];
                const canAddWorker = idleWorkers > 0 && b.workersAssigned < def.maxWorkers;
                const isIdle = def.maxWorkers > 0 && b.workersAssigned === 0;
                const staffedFraction = def.maxWorkers > 0 ? b.workersAssigned / def.maxWorkers : 0;
                return (
                  <div className="icon-row" key={b.id}>
                    <div className="icon-row__icon">
                      <BuildingIcon type={b.type as BuildingTypeId} />
                    </div>
                    <div className="icon-row__body">
                      <div className="icon-row__name">
                        {def.name} <span className="lv">Lv {b.level}</span>
                      </div>
                      {def.maxWorkers > 0 ? (
                        <>
                          <div className="icon-row__meta">
                            Workforce{isIdle && " — idle"} · {b.workersAssigned} / {def.maxWorkers}
                            {def.producesResource && b.workersAssigned > 0 &&
                              ` · ${computeHourlyProduction(
                                [{ type: b.type as BuildingTypeId, workersAssigned: b.workersAssigned, level: b.level }],
                                data.techIds,
                              )[def.producesResource].toFixed(1)} ${def.producesResource}/hr`}
                          </div>
                          <div className="workforce-bar" style={{ marginTop: 4 }}>
                            <button
                              disabled={b.workersAssigned <= 0 || setWorkers.isPending}
                              onClick={() => setWorkers.mutate({ buildingId: b.id, workers: b.workersAssigned - 1 })}
                            >
                              −
                            </button>
                            <div className="workforce-bar__track">
                              <div
                                className={`workforce-bar__fill${isIdle ? " workforce-bar__fill--idle" : ""}`}
                                style={{ width: `${staffedFraction * 100}%` }}
                              />
                            </div>
                            <button
                              disabled={!canAddWorker || setWorkers.isPending}
                              onClick={() => setWorkers.mutate({ buildingId: b.id, workers: b.workersAssigned + 1 })}
                            >
                              +
                            </button>
                            <button
                              className="workforce-bar__max"
                              disabled={!canAddWorker}
                              onClick={() =>
                                setWorkers.mutate({
                                  buildingId: b.id,
                                  workers: Math.min(def.maxWorkers, b.workersAssigned + idleWorkers),
                                })
                              }
                            >
                              Max
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="icon-row__meta">Houses +{def.populationCapacity} capacity</div>
                      )}
                    </div>
                    <div className="icon-row__right">
                      {b.upgradeCost ? (
                        <button
                          className="btn"
                          disabled={!canAfford(data.settlement, b.upgradeCost) || upgradeBuilding.isPending}
                          onClick={() => upgradeBuilding.mutate(b.id)}
                        >
                          Upgrade · {formatCost(b.upgradeCost)}
                        </button>
                      ) : (
                        <span className="icon-row__meta">Max level</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {activeTab === "build" && (
            <>
              <div className="cc-chips" style={{ marginBottom: 16 }}>
                {buildCategories.map((cat) => (
                  <button
                    key={cat}
                    className={`cc-chip${buildCategory === cat ? " cc-chip--active" : ""}`}
                    onClick={() => setBuildCategory(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>
              <div className="build-menu">
                {visibleBuildOptions.map((def) => {
                  const unlocked = !def.requiredTech || data.techIds.includes(def.requiredTech);
                  const affordable = canAfford(data.settlement, def.cost);
                  return (
                    <div className="build-option" key={def.id}>
                      <div className="icon-row__icon">
                        <BuildingIcon type={def.id} />
                      </div>
                      <div className="building-card__head">
                        <span className="building-card__name">{def.name}</span>
                      </div>
                      <p className="building-card__desc">{def.description}</p>
                      {def.retiredForConstruction ? (
                        <span className="build-option__cost">
                          Retired — found a {def.name} company instead (see Companies)
                        </span>
                      ) : (
                        <>
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
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {activeTab === "research" && (
            <>
              {tierNumbers.map((tier) => (
                <div className="tree-tier" key={tier}>
                  {(techsByTier.get(tier) ?? []).map((tech) => (
                    <div
                      className={`tree-node${tech.researched ? " tree-node--done" : !tech.available ? " tree-node--locked" : ""}`}
                      key={tech.id}
                    >
                      <div className="tree-node__name">
                        {tech.researched && <CheckCircleIcon className="icon" style={{ width: 14, height: 14 }} />}
                        {tech.name}
                      </div>
                      <div className="tree-node__desc">{tech.description}</div>
                      {tech.researched ? (
                        <div className="tree-node__cost">Researched</div>
                      ) : tech.available ? (
                        <>
                          <div className="tree-node__cost">{formatCost(tech.cost)}</div>
                          <button
                            className="btn"
                            style={{ marginTop: 8 }}
                            disabled={!canAfford(data.settlement, tech.cost) || research.isPending}
                            onClick={() => research.mutate(tech.id as TechId)}
                          >
                            Research
                          </button>
                        </>
                      ) : (
                        <div className="tree-node__cost">
                          Requires {TECHS[tech.requiredTech as TechId]?.name}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
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

        <div className="card">
          <h2 className="card__title">Home Territory</h2>
          {territoryData?.territories.length ? (
            <>
              <div className="suggestion" style={{ marginTop: 0 }}>
                {territoryData.territories[0].dominantBiome} ·{" "}
                {Math.round(territoryData.territories[0].areaKm2).toLocaleString()} km²
              </div>
              {territoryData.territories.length > 1 && (
                <div className="suggestion">
                  Plus {territoryData.territories.length - 1} more territor
                  {territoryData.territories.length - 1 === 1 ? "y" : "ies"} claimed.
                </div>
              )}
              <Link to="/continent" className="btn" style={{ marginTop: 8 }}>
                View on the Continent
              </Link>
            </>
          ) : (
            <div className="suggestion" style={{ marginTop: 0 }}>
              Assigning your land...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
