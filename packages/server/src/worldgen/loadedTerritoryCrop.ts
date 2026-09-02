// Native-resolution (CELL_SIZE_KM=1, no downsampling — unlike
// loadedMapPreview.ts's 4x-coarsened preview) crop of just a player's own
// owned territory, for the "My Territory" page (see routes/territory.ts's
// GET /mine/detail). The full-resolution biome/territory-seed rasters are
// loaded and cached once per server process, same lifetime assumption
// loadedMapPreview.ts already makes — cropping per-request is cheap even
// against the full ~5M-cell grid (a handful of milliseconds), since it's a
// rare per-player action, not a hot loop.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CELL_SIZE_KM, GRID_COLS, GRID_ROWS, type BiomeId } from "@dominion/shared";

const OUTPUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../worldgen-output");

const NO_SEED = 0xffff;

// Margin around the tightest bounding box of the player's own seeds, in
// native cells — enough to see a little surrounding land/coastline for
// context without ballooning the crop for a small territory.
const CROP_MARGIN_CELLS = 30;

interface FullGrid {
  biomeIds: BiomeId[];
  biome: Uint8Array;
  seed: Uint16Array;
}

let cached: FullGrid | null = null;

function loadFullGrid(): FullGrid {
  if (cached) return cached;
  const manifest = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, "manifest.json"), "utf-8"));
  const biomeBuf = fs.readFileSync(path.join(OUTPUT_DIR, "biome.u8"));
  const seedBuf = fs.readFileSync(path.join(OUTPUT_DIR, "territoryOwner.u16"));
  cached = {
    biomeIds: manifest.biomeIds,
    biome: new Uint8Array(biomeBuf.buffer, biomeBuf.byteOffset, biomeBuf.byteLength),
    seed: new Uint16Array(seedBuf.buffer, seedBuf.byteOffset, seedBuf.byteLength / 2),
  };
  return cached;
}

export interface TerritoryCrop {
  cols: number;
  rows: number;
  cellSizeKm: number;
  biomeIds: BiomeId[];
  biome: Uint8Array;
  seed: Uint16Array;
  noSeedSentinel: number;
  offsetWorldX: number;
  offsetWorldY: number;
}

// Returns null if none of the requested seed indexes actually appear in the
// baked grid (shouldn't happen for a real owned territory, but a caller
// with zero territories has nothing to crop).
export function getTerritoryCrop(seedIndexes: number[]): TerritoryCrop | null {
  const grid = loadFullGrid();
  const wanted = new Set(seedIndexes);
  if (wanted.size === 0) return null;

  let minCol = GRID_COLS, minRow = GRID_ROWS, maxCol = -1, maxRow = -1;
  for (let row = 0; row < GRID_ROWS; row++) {
    const rowBase = row * GRID_COLS;
    for (let col = 0; col < GRID_COLS; col++) {
      const s = grid.seed[rowBase + col];
      if (s === NO_SEED || !wanted.has(s)) continue;
      if (col < minCol) minCol = col;
      if (col > maxCol) maxCol = col;
      if (row < minRow) minRow = row;
      if (row > maxRow) maxRow = row;
    }
  }
  if (maxCol < 0) return null;

  minCol = Math.max(0, minCol - CROP_MARGIN_CELLS);
  minRow = Math.max(0, minRow - CROP_MARGIN_CELLS);
  maxCol = Math.min(GRID_COLS - 1, maxCol + CROP_MARGIN_CELLS);
  maxRow = Math.min(GRID_ROWS - 1, maxRow + CROP_MARGIN_CELLS);

  const outW = maxCol - minCol + 1;
  const outH = maxRow - minRow + 1;
  const biome = new Uint8Array(outW * outH);
  const seed = new Uint16Array(outW * outH);
  for (let row = minRow; row <= maxRow; row++) {
    const srcBase = row * GRID_COLS;
    const dstBase = (row - minRow) * outW;
    for (let col = minCol; col <= maxCol; col++) {
      const dst = dstBase + (col - minCol);
      biome[dst] = grid.biome[srcBase + col];
      seed[dst] = grid.seed[srcBase + col];
    }
  }

  return {
    cols: outW,
    rows: outH,
    cellSizeKm: CELL_SIZE_KM,
    biomeIds: grid.biomeIds,
    biome,
    seed,
    noSeedSentinel: NO_SEED,
    offsetWorldX: minCol * CELL_SIZE_KM,
    offsetWorldY: minRow * CELL_SIZE_KM,
  };
}
