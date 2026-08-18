import { useEffect, useState } from "react";
import { RESOURCE_LABELS, type ResourceType } from "@dominion/shared";
import type { OfflineSummary } from "../api/client.js";
import { useGameState } from "../api/hooks.js";

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function formatDelta(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return "±0";
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

export default function OfflineSummaryModal() {
  const { data } = useGameState();
  const [summary, setSummary] = useState<OfflineSummary | null>(null);

  useEffect(() => {
    if (data?.offlineSummary) {
      setSummary(data.offlineSummary);
    }
  }, [data?.offlineSummary]);

  if (!summary) return null;

  return (
    <div className="modal-backdrop" onClick={() => setSummary(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Welcome back</h2>
        <p className="sub">You were away for {formatDuration(summary.awaySeconds)}. Here's what changed:</p>

        <div className="delta-grid">
          {(["food", "wood", "stone", "gold"] as ResourceType[]).map((type) => (
            <div className="delta-cell" key={type}>
              <div className="delta-cell__label">{RESOURCE_LABELS[type]}</div>
              <div className="delta-cell__value">{formatDelta(summary.resourceDeltas[type])}</div>
            </div>
          ))}
          <div className="delta-cell">
            <div className="delta-cell__label">Population</div>
            <div className="delta-cell__value">{formatDelta(summary.populationDelta)}</div>
          </div>
        </div>

        {summary.events.length > 0 && (
          <div>
            {summary.events.map((event) => (
              <div className="modal-event" key={event.id}>
                <strong>{event.title}</strong> — {event.description}
              </div>
            ))}
          </div>
        )}

        <button className="btn btn--accent" style={{ width: "100%", marginTop: 16 }} onClick={() => setSummary(null)}>
          Continue
        </button>
      </div>
    </div>
  );
}
