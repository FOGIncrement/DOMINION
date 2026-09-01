// Offline, one-time bake for Margin's Phase 2 territory partition. Not a
// live server module — run via `npm run worldgen:territories` (tsx), after
// `npm run worldgen` (Phase 1 geography) has produced its output. Separate
// script from generateContinent.ts on purpose: regenerating geography and
// regenerating the territory partition are independent operations, and this
// one consumes the other's output rather than duplicating any terrain math.
//
// Core idea (see the Margin land-system pivot design): NOT a classic
// Voronoi diagram (nearest seed by Euclidean distance) — a cost-distance
// partition. Every seed starts a wavefront at cost 0; wavefronts expand
// through a terrain cost raster (mountains expensive, plains cheap, rivers
// a toll scaled by how big that river actually is); whichever wavefront
// reaches a cell first (lowest cumulative cost, via multi-source Dijkstra)
// owns it. Run once; the resulting cell->seed grid never changes again —
// that's what lets a new player claim a seed with zero geometry
// recomputation, no matter how many seeds already exist.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CELL_SIZE_KM, CONTINENT_SEED, GRID_COLS, GRID_ROWS, TERRITORY_BIOME_COST, TERRITORY_TUNING, type BiomeId } from "@dominion/shared";
import { MinHeap } from "./minHeap.js";

const OUTPUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../worldgen-output");

// Explicit byteOffset/length views, not just `new Uint8Array(buf.buffer)` —
// Node's Buffer pooling only guarantees an exact-sized backing ArrayBuffer
// above a size threshold; being explicit is correct regardless of that
// implementation detail, for any file size.
function readU8(filePath: string): Uint8Array {
  const buf = fs.readFileSync(filePath);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function readF32(filePath: string): Float32Array {
  const buf = fs.readFileSync(filePath);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

const NEIGHBOR_OFFSETS: [dc: number, dr: number][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

// Deterministic PRNG, same algorithm the rest of this project's world-gen
// already uses (worldTerrain.ts / continentTerrain.ts) — a different seed
// so seed placement doesn't correlate with anything in the terrain itself.
function mulberry32(a: number): () => number {
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SeedPoint {
  col: number;
  row: number;
}

// Poisson-disk-style dart-throwing (grid-bucketed for O(1) average rejection
// testing, not a naive O(n^2) scan) rather than true Lloyd's relaxation —
// simpler, and the real shape-forming work happens in the cost-weighted
// Dijkstra expansion below, not the initial spacing.
function placeSeeds(landIndices: number[], targetCount: number, minSpacingCells: number): SeedPoint[] {
  const rng = mulberry32((CONTINENT_SEED ^ 0x7f4a7c15) >>> 0);
  const bucketSize = minSpacingCells;
  const buckets = new Map<string, SeedPoint[]>();

  const bucketKey = (col: number, row: number) => `${Math.floor(col / bucketSize)}:${Math.floor(row / bucketSize)}`;

  function tooClose(col: number, row: number): boolean {
    const bx = Math.floor(col / bucketSize);
    const by = Math.floor(row / bucketSize);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = buckets.get(`${bx + dx}:${by + dy}`);
        if (!bucket) continue;
        for (const p of bucket) {
          if (Math.hypot(p.col - col, p.row - row) < minSpacingCells) return true;
        }
      }
    }
    return false;
  }

  const placed: SeedPoint[] = [];
  const maxAttempts = targetCount * 60;
  let attempts = 0;
  while (placed.length < targetCount && attempts < maxAttempts) {
    attempts++;
    const idx = landIndices[Math.floor(rng() * landIndices.length)];
    const row = Math.floor(idx / GRID_COLS);
    const col = idx % GRID_COLS;
    if (tooClose(col, row)) continue;
    const point = { col, row };
    placed.push(point);
    const key = bucketKey(col, row);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(point);
  }
  return placed;
}

function main(): void {
  const manifest = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, "manifest.json"), "utf-8"));
  if (manifest.gridCols !== GRID_COLS || manifest.gridRows !== GRID_ROWS) {
    throw new Error("worldgen-output was generated with different grid dimensions — run `npm run worldgen` again first");
  }
  const biomeIds: BiomeId[] = manifest.biomeIds;
  const biome = readU8(path.join(OUTPUT_DIR, "biome.u8"));
  const riverFlow = readF32(path.join(OUTPUT_DIR, "riverFlow.f32"));

  const n = GRID_COLS * GRID_ROWS;
  console.log(`[territories] grid=${GRID_COLS}x${GRID_ROWS} (${n.toLocaleString()} cells)`);
  const t0 = Date.now();
  const elapsed = () => `${Date.now() - t0}ms`;

  // 1. Cost raster — "every point belongs to the cheapest seed to reach,"
  // not the geometrically closest. Ocean/lake are impassable (Infinity),
  // permanently excluding those cells from ever belonging to a territory.
  const oceanIdx = biomeIds.indexOf("ocean");
  const lakeIdx = biomeIds.indexOf("lake");
  const riverIdx = biomeIds.indexOf("river");
  let maxRiverFlow = 0;
  for (let i = 0; i < n; i++) if (biome[i] === riverIdx) maxRiverFlow = Math.max(maxRiverFlow, riverFlow[i]);

  const cost = new Float32Array(n);
  const landIndices: number[] = [];
  for (let i = 0; i < n; i++) {
    const biomeId = biomeIds[biome[i]];
    let c = TERRITORY_BIOME_COST[biomeId];
    if (biome[i] === riverIdx && maxRiverFlow > 0) {
      const t = Math.min(1, riverFlow[i] / maxRiverFlow);
      c *= 1 + t * (TERRITORY_TUNING.riverFlowTollMax - 1) - (1 - t) * 0.5; // small streams read as barely-there tolls, not a flat "river" penalty
      c = Math.max(1, c);
    }
    cost[i] = c;
    if (biome[i] !== oceanIdx && biome[i] !== lakeIdx) landIndices.push(i);
  }
  const landAreaKm2 = landIndices.length * CELL_SIZE_KM * CELL_SIZE_KM;
  console.log(`[territories] cost raster built, ${landAreaKm2.toLocaleString()} km2 land (${elapsed()})`);

  // 2. Seed placement — target count derived from measured land area, not a
  // fixed constant (see the Phase 2 plan: the original "10,000" assumption
  // predates knowing how much land Phase 1 actually produced).
  const targetCount = Math.round(landAreaKm2 / TERRITORY_TUNING.targetAreaPerSeedKm2);
  const avgSpacingKm = Math.sqrt(landAreaKm2 / targetCount);
  const minSpacingCells = Math.max(2, Math.round((avgSpacingKm * 0.8) / CELL_SIZE_KM));
  const seedPoints = placeSeeds(landIndices, targetCount, minSpacingCells);
  console.log(`[territories] placed ${seedPoints.length}/${targetCount} seeds (${elapsed()})`);

  // 3. Multi-source Dijkstra over the cost raster.
  const NO_OWNER = 0xffff;
  const owner = new Uint16Array(n).fill(NO_OWNER);
  const bestCost = new Float32Array(n).fill(Infinity);
  const heap = new MinHeap();
  seedPoints.forEach((seed, seedIndex) => {
    const idx = seed.row * GRID_COLS + seed.col;
    bestCost[idx] = 0;
    owner[idx] = seedIndex;
    heap.push(idx, 0);
  });
  let processed = 0;
  while (heap.size > 0) {
    const top = heap.popMin()!;
    if (top.priority > bestCost[top.idx]) continue; // stale entry, a cheaper path already claimed this cell
    processed++;
    const row = Math.floor(top.idx / GRID_COLS);
    const col = top.idx % GRID_COLS;
    const seedIndex = owner[top.idx];
    for (const [dc, dr] of NEIGHBOR_OFFSETS) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr < 0 || nr >= GRID_ROWS || nc < 0 || nc >= GRID_COLS) continue;
      const nIdx = nr * GRID_COLS + nc;
      if (!Number.isFinite(cost[nIdx])) continue; // ocean/lake — impassable, never joins any territory
      const newCost = top.priority + cost[nIdx];
      if (newCost < bestCost[nIdx]) {
        bestCost[nIdx] = newCost;
        owner[nIdx] = seedIndex;
        heap.push(nIdx, newCost);
      }
    }
  }
  console.log(`[territories] Dijkstra partition done, ${processed.toLocaleString()} cells settled (${elapsed()})`);

  // 4. Per-seed summary (center, area, dominant biome, resource summary) —
  // small enough to be plain JSON, unlike the per-cell grid above.
  const cellCount = new Array(seedPoints.length).fill(0);
  const biomeCounts: Array<Map<number, number>> = seedPoints.map(() => new Map());
  for (let i = 0; i < n; i++) {
    const s = owner[i];
    if (s === NO_OWNER) continue;
    cellCount[s]++;
    const bc = biomeCounts[s];
    bc.set(biome[i], (bc.get(biome[i]) ?? 0) + 1);
  }

  const RESOURCE_KINDS = manifest.resourceKinds as string[];
  const resourceArrays: Record<string, Uint8Array> = {};
  for (const kind of RESOURCE_KINDS) {
    resourceArrays[kind] = readU8(path.join(OUTPUT_DIR, `resource_${kind}.u8`));
  }
  const resourceTotals: Array<Record<string, number>> = seedPoints.map(() =>
    Object.fromEntries(RESOURCE_KINDS.map((k) => [k, 0])),
  );
  for (let i = 0; i < n; i++) {
    const s = owner[i];
    if (s === NO_OWNER) continue;
    for (const kind of RESOURCE_KINDS) {
      const v = resourceArrays[kind][i];
      if (v > 0) resourceTotals[s][kind] += v;
    }
  }

  const seeds = seedPoints.map((seed, seedIndex) => {
    let dominantBiome = biomeIds[0];
    let dominantCount = -1;
    for (const [b, count] of biomeCounts[seedIndex]) {
      if (count > dominantCount) {
        dominantCount = count;
        dominantBiome = biomeIds[b];
      }
    }
    // Average resource amount per land cell in this territory (0-255 scale,
    // matching the raw deposit rasters) — a rough "how much of this
    // resource" signal for the territory-detail endpoint, refined later.
    const resources: Record<string, number> = {};
    for (const kind of RESOURCE_KINDS) {
      resources[kind] = Math.round(resourceTotals[seedIndex][kind] / Math.max(1, cellCount[seedIndex]));
    }
    return {
      seedIndex,
      centerWorldX: (seed.col + 0.5) * CELL_SIZE_KM,
      centerWorldY: (seed.row + 0.5) * CELL_SIZE_KM,
      areaKm2: cellCount[seedIndex] * CELL_SIZE_KM * CELL_SIZE_KM,
      dominantBiome,
      resources,
    };
  });

  const areas = seeds.map((s) => s.areaKm2).sort((a, b) => a - b);
  const median = areas[Math.floor(areas.length / 2)];
  console.log(
    `[territories] area stats km2: min=${areas[0]} median=${median} max=${areas[areas.length - 1]} target=${TERRITORY_TUNING.targetAreaPerSeedKm2}`,
  );

  // 5. Write output.
  fs.writeFileSync(path.join(OUTPUT_DIR, "territoryOwner.u16"), Buffer.from(owner.buffer));
  fs.writeFileSync(path.join(OUTPUT_DIR, "seeds.json"), JSON.stringify({ seeds, noOwnerSentinel: NO_OWNER }, null, 2));

  console.log(`[territories] done in ${elapsed()}, wrote to ${OUTPUT_DIR}`);
}

main();
