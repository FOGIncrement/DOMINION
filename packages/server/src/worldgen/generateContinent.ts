// Offline, one-time bake for Margin's Phase 1 continent geography. Not a
// live server module — run via `npm run worldgen` (tsx). Everything here is
// the "global" half of terrain generation that packages/shared/src/
// continentTerrain.ts's pure per-point functions can't do on their own:
// rivers and lakes need the whole elevation grid materialized before a
// drainage network can be traced, and moisture needs to know where the
// water ended up before it can be computed. See that module's header
// comment for the full reasoning.
//
// Output is raw binary typed-array dumps (not JSON — 5M+ cells of JSON
// would be enormous) plus a small manifest, written to a gitignored
// worldgen-output/ directory — fully regeneratable from CONTINENT_SEED, so
// treated as a build artifact, never committed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CELL_SIZE_KM,
  CONTINENT_HEIGHT,
  CONTINENT_SEA_LEVEL,
  CONTINENT_SEED,
  CONTINENT_WIDTH,
  GRID_COLS,
  GRID_ROWS,
  classifyBiome,
  continentElevationAt,
  resourceNoiseAt,
  temperatureAt,
  type BiomeId,
  type ResourceDepositType,
} from "@dominion/shared";
import { MinHeap } from "./minHeap.js";

const OUTPUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../worldgen-output");

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// 8-connected neighbor offsets, shared by every grid pass below (flood
// fill, flow direction, moisture BFS) so they all agree on adjacency.
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


function main(): void {
  const n = GRID_COLS * GRID_ROWS;
  console.log(`[worldgen] seed=${CONTINENT_SEED} grid=${GRID_COLS}x${GRID_ROWS} (${n.toLocaleString()} cells)`);
  const t0 = Date.now();
  const elapsed = () => `${Date.now() - t0}ms`;

  // 1. Elevation — the one part of this file that's just sampling the pure
  // per-point function from continentTerrain.ts.
  const elevation = new Float32Array(n);
  for (let row = 0; row < GRID_ROWS; row++) {
    const worldY = row * CELL_SIZE_KM + CELL_SIZE_KM / 2;
    for (let col = 0; col < GRID_COLS; col++) {
      const worldX = col * CELL_SIZE_KM + CELL_SIZE_KM / 2;
      elevation[row * GRID_COLS + col] = continentElevationAt(worldX, worldY);
    }
  }
  console.log(`[worldgen] elevation sampled (${elapsed()})`);

  // 2. Priority-flood pit fill (Barnes et al.) — guarantees every land cell
  // has a monotonic downhill path to the sea, which real hand-off noise
  // alone never does (fBm produces a huge number of tiny local minima that
  // would otherwise all read as "lakes," just noise, not real basins).
  // Seeded from every ocean cell (the true drainage exits), expanding
  // inland; a neighbor gets raised to the seed's elevation only if it was
  // actually lower — that raise amount is what distinguishes a real filled
  // basin (a lake) from ordinary terrain that never needed filling.
  const filled = Float32Array.from(elevation);
  const resolved = new Uint8Array(n);
  const heap = new MinHeap();
  for (let i = 0; i < n; i++) {
    if (elevation[i] < CONTINENT_SEA_LEVEL) {
      resolved[i] = 1;
      heap.push(i, elevation[i]);
    }
  }
  while (heap.size > 0) {
    const top = heap.popMin()!;
    const row = Math.floor(top.idx / GRID_COLS);
    const col = top.idx % GRID_COLS;
    for (const [dc, dr] of NEIGHBOR_OFFSETS) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr < 0 || nr >= GRID_ROWS || nc < 0 || nc >= GRID_COLS) continue;
      const nIdx = nr * GRID_COLS + nc;
      if (resolved[nIdx]) continue;
      resolved[nIdx] = 1;
      if (filled[nIdx] < top.priority) filled[nIdx] = top.priority;
      heap.push(nIdx, filled[nIdx]);
    }
  }
  console.log(`[worldgen] priority-flood fill done (${elapsed()})`);

  // 3. Flow direction over the FILLED elevation, not the raw one — every
  // land cell now has a real downhill (or flat-into-a-lake) neighbor.
  const flowDir = new Int8Array(n).fill(-1);
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const idx = row * GRID_COLS + col;
      if (elevation[idx] < CONTINENT_SEA_LEVEL) continue;
      let bestDir = -1;
      let bestElevation = filled[idx];
      for (let d = 0; d < NEIGHBOR_OFFSETS.length; d++) {
        const [dc, dr] = NEIGHBOR_OFFSETS[d];
        const nr = row + dr;
        const nc = col + dc;
        if (nr < 0 || nr >= GRID_ROWS || nc < 0 || nc >= GRID_COLS) continue;
        const nIdx = nr * GRID_COLS + nc;
        if (filled[nIdx] < bestElevation) {
          bestElevation = filled[nIdx];
          bestDir = d;
        }
      }
      flowDir[idx] = bestDir; // stays -1 only on rare flat plateaus inside a filled lake
    }
  }
  console.log(`[worldgen] flow direction done (${elapsed()})`);

  // 4. Flow accumulation — process land cells in descending filled-elevation
  // order so every upstream contributor has already been folded in before
  // its own downstream neighbor is processed.
  const accumulation = new Float32Array(n);
  const landIndices: number[] = [];
  for (let i = 0; i < n; i++) {
    if (elevation[i] >= CONTINENT_SEA_LEVEL) {
      accumulation[i] = 1;
      landIndices.push(i);
    }
  }
  landIndices.sort((a, b) => filled[b] - filled[a]);
  for (const idx of landIndices) {
    const dir = flowDir[idx];
    if (dir < 0) continue;
    const row = Math.floor(idx / GRID_COLS);
    const col = idx % GRID_COLS;
    const [dc, dr] = NEIGHBOR_OFFSETS[dir];
    const nIdx = (row + dr) * GRID_COLS + (col + dc);
    accumulation[nIdx] += accumulation[idx];
  }
  console.log(`[worldgen] flow accumulation done (${elapsed()})`);

  // 5. Rivers (high accumulation) and lakes (real filled basins) — starting
  // thresholds, tuned by inspection against the preview tool, not derived.
  const RIVER_ACCUMULATION_THRESHOLD = 400;
  const LAKE_FILL_THRESHOLD = 0.01;
  const isRiver = new Uint8Array(n);
  const isLake = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (elevation[i] < CONTINENT_SEA_LEVEL) continue;
    if (filled[i] - elevation[i] > LAKE_FILL_THRESHOLD) isLake[i] = 1;
    else if (accumulation[i] > RIVER_ACCUMULATION_THRESHOLD) isRiver[i] = 1;
  }
  console.log(`[worldgen] rivers/lakes classified (${elapsed()})`);

  // 6. Moisture — multi-source BFS distance transform from every water cell
  // (ocean + river + lake). Plain Int32Array ring buffer as the BFS queue —
  // a real Array with .shift() would be O(n) per pop, disastrous at this
  // cell count.
  const WATER_DECAY_CELLS = 45;
  const distToWater = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let qHead = 0;
  let qTail = 0;
  for (let i = 0; i < n; i++) {
    if (elevation[i] < CONTINENT_SEA_LEVEL || isRiver[i] || isLake[i]) {
      distToWater[i] = 0;
      queue[qTail++] = i;
    }
  }
  while (qHead < qTail) {
    const idx = queue[qHead++];
    const d = distToWater[idx];
    const row = Math.floor(idx / GRID_COLS);
    const col = idx % GRID_COLS;
    for (const [dc, dr] of NEIGHBOR_OFFSETS) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr < 0 || nr >= GRID_ROWS || nc < 0 || nc >= GRID_COLS) continue;
      const nIdx = nr * GRID_COLS + nc;
      if (distToWater[nIdx] !== -1) continue;
      distToWater[nIdx] = d + 1;
      queue[qTail++] = nIdx;
    }
  }
  console.log(`[worldgen] moisture distance transform done (${elapsed()})`);

  // 7. Temperature + biome classification + resource deposits, all per-cell
  // now that water/moisture are known.
  const BIOME_IDS: BiomeId[] = [
    "ocean",
    "lake",
    "river",
    "beach",
    "desert",
    "plains",
    "grassland",
    "forest",
    "taiga",
    "tundra",
    "mountain",
    "snow",
  ];
  const biomeIndex = new Map(BIOME_IDS.map((b, i) => [b, i]));
  const biome = new Uint8Array(n);

  const RESOURCE_KINDS: ResourceDepositType[] = ["food", "wood", "stone", "iron", "coal", "gold"];
  const resourceAmount: Record<ResourceDepositType, Uint8Array> = {
    food: new Uint8Array(n),
    wood: new Uint8Array(n),
    stone: new Uint8Array(n),
    iron: new Uint8Array(n),
    coal: new Uint8Array(n),
    gold: new Uint8Array(n),
  };

  for (let row = 0; row < GRID_ROWS; row++) {
    const worldY = row * CELL_SIZE_KM + CELL_SIZE_KM / 2;
    for (let col = 0; col < GRID_COLS; col++) {
      const worldX = col * CELL_SIZE_KM + CELL_SIZE_KM / 2;
      const idx = row * GRID_COLS + col;
      const e = elevation[idx];
      const temperature = temperatureAt(worldX, worldY, e);
      const moisture = Math.max(0, 1 - distToWater[idx] / WATER_DECAY_CELLS);
      const b = classifyBiome(e, temperature, moisture, isRiver[idx] === 1, isLake[idx] === 1);
      biome[idx] = biomeIndex.get(b)!;

      if (e < CONTINENT_SEA_LEVEL) continue;

      // Deposit regions, not per-cell scatter — each kind only rolls on the
      // biomes it plausibly occurs in, thresholded high enough on its own
      // clustered noise field that deposits read as a handful of real
      // regions rather than salt-and-pepper noise across the whole map.
      if (b === "plains" || b === "grassland") {
        const food = resourceNoiseAt(worldX, worldY, "food");
        if (food > 0.62) resourceAmount.food[idx] = Math.round(clamp01((food - 0.62) / 0.38) * 255);
      }
      if (b === "forest" || b === "taiga") {
        const wood = resourceNoiseAt(worldX, worldY, "wood");
        if (wood > 0.58) resourceAmount.wood[idx] = Math.round(clamp01((wood - 0.58) / 0.42) * 255);
      }
      if (b === "mountain" || b === "snow") {
        const stone = resourceNoiseAt(worldX, worldY, "stone");
        if (stone > 0.5) resourceAmount.stone[idx] = Math.round(clamp01((stone - 0.5) / 0.5) * 255);
        const iron = resourceNoiseAt(worldX, worldY, "iron");
        if (iron > 0.68) resourceAmount.iron[idx] = Math.round(clamp01((iron - 0.68) / 0.32) * 255);
        const coal = resourceNoiseAt(worldX, worldY, "coal");
        if (coal > 0.68) resourceAmount.coal[idx] = Math.round(clamp01((coal - 0.68) / 0.32) * 255);
        const gold = resourceNoiseAt(worldX, worldY, "gold");
        if (gold > 0.78) resourceAmount.gold[idx] = Math.round(clamp01((gold - 0.78) / 0.22) * 255);
      }
    }
  }
  console.log(`[worldgen] temperature/biome/resources done (${elapsed()})`);

  // 8. Write output — raw typed-array buffers, not JSON, plus one small
  // manifest describing how to interpret them.
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, "elevation.f32"), Buffer.from(elevation.buffer));
  fs.writeFileSync(path.join(OUTPUT_DIR, "biome.u8"), Buffer.from(biome.buffer));
  fs.writeFileSync(path.join(OUTPUT_DIR, "isRiver.u8"), Buffer.from(isRiver.buffer));
  fs.writeFileSync(path.join(OUTPUT_DIR, "isLake.u8"), Buffer.from(isLake.buffer));
  // Raw upstream drainage per cell — Phase 2's territory partition uses this
  // to scale river-crossing cost by how big the river actually is at that
  // point, not just a flat "it's a river" toll.
  fs.writeFileSync(path.join(OUTPUT_DIR, "riverFlow.f32"), Buffer.from(accumulation.buffer));
  for (const kind of RESOURCE_KINDS) {
    fs.writeFileSync(path.join(OUTPUT_DIR, `resource_${kind}.u8`), Buffer.from(resourceAmount[kind].buffer));
  }
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "manifest.json"),
    JSON.stringify(
      {
        seed: CONTINENT_SEED,
        gridCols: GRID_COLS,
        gridRows: GRID_ROWS,
        cellSizeKm: CELL_SIZE_KM,
        continentWidthKm: CONTINENT_WIDTH,
        continentHeightKm: CONTINENT_HEIGHT,
        seaLevel: CONTINENT_SEA_LEVEL,
        biomeIds: BIOME_IDS,
        resourceKinds: RESOURCE_KINDS,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  console.log(`[worldgen] done in ${elapsed()}, wrote to ${OUTPUT_DIR}`);
}

main();
