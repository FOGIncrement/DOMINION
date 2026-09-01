// Lazy-singleton reader for Phase 2's baked territory seed metadata
// (worldgen-output/seeds.json — a few hundred KB, ~2000 entries). Loaded at
// most once per server process. Deliberately does NOT load the multi-
// megabyte per-cell rasters (territoryOwner.u16, the geography files) —
// nothing in this phase's API surface needs per-cell data, only per-seed
// summaries; those matter once a live map UI needs to actually *render*
// territory boundaries, which this phase explicitly defers.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUTPUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../worldgen-output");

export interface SeedSummary {
  seedIndex: number;
  centerWorldX: number;
  centerWorldY: number;
  areaKm2: number;
  dominantBiome: string;
  resources: Record<string, number>;
}

interface SeedsFile {
  seeds: SeedSummary[];
  noOwnerSentinel: number;
}

let cachedSeeds: SeedSummary[] | null = null;

export function getTerritorySeeds(): SeedSummary[] {
  if (!cachedSeeds) {
    const raw = fs.readFileSync(path.join(OUTPUT_DIR, "seeds.json"), "utf-8");
    cachedSeeds = (JSON.parse(raw) as SeedsFile).seeds;
  }
  return cachedSeeds;
}

// The generation script builds seeds in seedIndex order (0..N-1), so this
// is a direct array index, not a search.
export function getSeedByIndex(seedIndex: number): SeedSummary | undefined {
  const seeds = getTerritorySeeds();
  return seedIndex >= 0 && seedIndex < seeds.length ? seeds[seedIndex] : undefined;
}
