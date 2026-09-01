// Lazy-singleton reader for Phase 4's baked territory adjacency
// (worldgen-output/territoryAdjacency.json — small, one entry per seed that
// has neighbors). Same lifetime assumption as loadedTerritoryData.ts: loaded
// at most once per server process, never changes without a worldgen rerun +
// restart.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUTPUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../worldgen-output");

interface AdjacencyFile {
  adjacency: Record<string, number[]>;
}

let cached: Record<string, number[]> | null = null;

function load(): Record<string, number[]> {
  if (!cached) {
    const raw = fs.readFileSync(path.join(OUTPUT_DIR, "territoryAdjacency.json"), "utf-8");
    cached = (JSON.parse(raw) as AdjacencyFile).adjacency;
  }
  return cached;
}

export function getAdjacentSeeds(seedIndex: number): number[] {
  return load()[seedIndex] ?? [];
}
