// Lazy-singleton downsampler for a browser-renderable preview of Phase 1/2's
// baked continent — the "quick, minimal visual" step after Phase 2. Point-
// samples (not majority-vote) the full-resolution biome/territory-seed
// rasters onto a coarser grid: every previewed cell is a real value actually
// read from the master grid at that point, not an invented average, which
// matters because clicking a previewed cell has to resolve back to a real
// seedIndex for the claim flow to work correctly. Computed once per server
// process and cached forever — the underlying baked files never change
// without a full worldgen rerun + restart, same lifetime assumption
// loadedTerritoryData.ts already makes for seeds.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CELL_SIZE_KM, GRID_COLS, GRID_ROWS, type BiomeId } from "@dominion/shared";

const OUTPUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../worldgen-output");

// 4km per preview cell (divides the 2800x1800 grid evenly into 700x450) —
// small enough to fetch/decode in a browser in one shot, still fine-grained
// enough that even a below-median (~500km2) territory reads as a real patch
// rather than a single pixel.
const DOWNSAMPLE = 4;
const PREVIEW_COLS = GRID_COLS / DOWNSAMPLE;
const PREVIEW_ROWS = GRID_ROWS / DOWNSAMPLE;

// Matches the NO_OWNER sentinel generateTerritories.ts writes into
// territoryOwner.u16 (max value of a uint16) — not re-derived from seeds.json
// here since this module never touches that file.
const NO_SEED = 0xffff;

export interface MapPreview {
  cols: number;
  rows: number;
  cellSizeKm: number;
  biomeIds: BiomeId[];
  biome: Uint8Array;
  seed: Uint16Array;
  noSeedSentinel: number;
}

function readU8(filePath: string): Uint8Array {
  const buf = fs.readFileSync(filePath);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function readU16(filePath: string): Uint16Array {
  const buf = fs.readFileSync(filePath);
  return new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
}

let cached: MapPreview | null = null;

export function getMapPreview(): MapPreview {
  if (cached) return cached;

  const manifest = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, "manifest.json"), "utf-8"));
  const biomeFull = readU8(path.join(OUTPUT_DIR, "biome.u8"));
  const seedFull = readU16(path.join(OUTPUT_DIR, "territoryOwner.u16"));

  const biome = new Uint8Array(PREVIEW_COLS * PREVIEW_ROWS);
  const seed = new Uint16Array(PREVIEW_COLS * PREVIEW_ROWS);
  for (let row = 0; row < PREVIEW_ROWS; row++) {
    const srcRow = row * DOWNSAMPLE;
    for (let col = 0; col < PREVIEW_COLS; col++) {
      const srcIdx = srcRow * GRID_COLS + col * DOWNSAMPLE;
      const dstIdx = row * PREVIEW_COLS + col;
      biome[dstIdx] = biomeFull[srcIdx];
      seed[dstIdx] = seedFull[srcIdx];
    }
  }

  cached = {
    cols: PREVIEW_COLS,
    rows: PREVIEW_ROWS,
    cellSizeKm: CELL_SIZE_KM * DOWNSAMPLE,
    biomeIds: manifest.biomeIds,
    biome,
    seed,
    noSeedSentinel: NO_SEED,
  };
  return cached;
}
