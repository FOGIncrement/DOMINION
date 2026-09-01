// Offline, one-time computation of territory adjacency for Phase 4
// (military/conquest) — run via `npm run worldgen:adjacency` (tsx), after
// `npm run worldgen:territories` has produced territoryOwner.u16.
//
// Deliberately a SEPARATE, READ-ONLY script from generateTerritories.ts:
// it only reads the already-baked territoryOwner.u16 and never re-runs
// seed placement or the Dijkstra partition. Re-running that (even though
// it's deterministic) is not a risk worth taking here — real players
// already own territories by seedIndex, and this script has no reason to
// touch that at all.
//
// Adjacency = two seeds share a border if any pair of orthogonally
// neighboring cells (right/down — checking both directions from every
// cell covers all 4 orthogonal neighbors exactly once each) belong to
// them. Output is a small JSON adjacency list, same tier as seeds.json —
// not the multi-megabyte raster tier.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GRID_COLS, GRID_ROWS } from "@dominion/shared";

const OUTPUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../worldgen-output");

// Same explicit byteOffset/length view as the rest of worldgen — see
// generateTerritories.ts's readU16 for why this is correct regardless of
// Node's Buffer-pooling implementation detail.
function readU16(filePath: string): Uint16Array {
  const buf = fs.readFileSync(filePath);
  return new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
}

const NO_SEED = 0xffff;

function main(): void {
  const owner = readU16(path.join(OUTPUT_DIR, "territoryOwner.u16"));
  const n = GRID_COLS * GRID_ROWS;
  console.log(`[adjacency] grid=${GRID_COLS}x${GRID_ROWS} (${n.toLocaleString()} cells)`);
  const t0 = Date.now();

  const adjacency = new Map<number, Set<number>>();
  const addEdge = (a: number, b: number) => {
    if (a === b) return;
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  };

  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const idx = row * GRID_COLS + col;
      const s = owner[idx];
      if (s === NO_SEED) continue;

      if (col + 1 < GRID_COLS) {
        const right = owner[idx + 1];
        if (right !== NO_SEED && right !== s) addEdge(s, right);
      }
      if (row + 1 < GRID_ROWS) {
        const down = owner[idx + GRID_COLS];
        if (down !== NO_SEED && down !== s) addEdge(s, down);
      }
    }
  }

  const adjacencyObj: Record<string, number[]> = {};
  for (const [seedIndex, neighbors] of adjacency) {
    adjacencyObj[seedIndex] = Array.from(neighbors).sort((a, b) => a - b);
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, "territoryAdjacency.json"), JSON.stringify({ adjacency: adjacencyObj }, null, 2));

  const neighborCounts = Object.values(adjacencyObj).map((n) => n.length);
  const avg = neighborCounts.reduce((sum, c) => sum + c, 0) / Math.max(1, neighborCounts.length);
  console.log(
    `[adjacency] done in ${Date.now() - t0}ms — ${adjacency.size} seeds have neighbors, avg ${avg.toFixed(1)} neighbors each`,
  );
}

main();
