import { Link } from "react-router-dom";
import type { GameStateResponse } from "../api/client.js";
import { useGameState, useMyTerritories } from "../api/hooks.js";
import { WarningIcon } from "../icons.js";

// The legacy building/tech economy (Overview/Build/Research tabs, the
// Civilization nav tab) was removed 2026-09-03 — production now happens
// entirely through companies (see the Companies and Continent pages).
// This page keeps just the still-relevant summary content: priorities,
// settlement info, and the player's home territory.
function buildSuggestions(state: GameStateResponse): string[] {
  const suggestions: string[] = [];
  const { population } = state;

  if (population.count >= population.capacity * 0.9) {
    suggestions.push("Housing capacity is nearly full — claim or buy more territory to grow further.");
  }
  if (population.available >= 3) {
    suggestions.push(`You have ${Math.floor(population.available)} idle population — assign them to a company.`);
  }

  return suggestions.slice(0, 4);
}

export default function Dashboard() {
  const { data, isLoading } = useGameState();
  const { data: territoryData } = useMyTerritories();

  if (isLoading || !data) {
    return (
      <div className="page">
        <div className="loading">Loading your settlement...</div>
      </div>
    );
  }

  const suggestions = buildSuggestions(data);

  return (
    <div className="page">
      <div>
        <div className="card">
          <h2 className="card__title">{data.settlement.name}</h2>
          <div className="summary-bar">
            <div className="summary-stat">
              <div className="summary-stat__label">Population</div>
              <div className="summary-stat__value">{Math.round(data.population.count)}</div>
            </div>
            <div className="summary-stat">
              <div className="summary-stat__label">Housing capacity</div>
              <div className="summary-stat__value">{data.population.capacity}</div>
            </div>
            <div className="summary-stat">
              <div className="summary-stat__label">Idle population</div>
              <div className={`summary-stat__value${data.population.available >= 3 ? " attention" : ""}`}>
                {Math.floor(data.population.available)}
              </div>
            </div>
            <div className="summary-stat">
              <div className="summary-stat__label">Happiness</div>
              <div className={`summary-stat__value${data.population.happiness < 0.5 ? " attention" : ""}`}>
                {Math.round(data.population.happiness * 100)}%
              </div>
            </div>
          </div>
          <p className="suggestion" style={{ marginTop: 12 }}>
            Found companies on the Companies and Continent tabs to grow your economy — production, workforce, and
            trade all happen there now.
          </p>
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
                <WarningIcon className="icon" style={{ width: 14, height: 14, marginRight: 6 }} />
                {s}
              </div>
            ))
          )}
        </div>

        <div className="card">
          <h2 className="card__title">Settlement</h2>
          <div className="suggestion">Founded {new Date(data.settlement.foundedAt).toLocaleDateString()}</div>
          <div className="suggestion">Food storage cap {data.settlement.storageCap}</div>
          <div className="suggestion">
            Housing capacity grows with the amount of territory you hold — buy or conquer more land to support a
            bigger population.
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
                  {territoryData.territories.length - 1 === 1 ? "y" : "ies"} held.
                </div>
              )}
              <Link to="/continent" className="btn" style={{ marginTop: 8 }}>
                View on the Continent
              </Link>
            </>
          ) : (
            <>
              <div className="suggestion" style={{ marginTop: 0 }}>
                You haven't chosen your starting territory yet.
              </div>
              <Link to="/continent" className="btn" style={{ marginTop: 8 }}>
                Choose Your Territory
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
