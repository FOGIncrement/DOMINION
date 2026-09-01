// Procedural continent geography for Margin's land system (Phase 1 —
// Geography only; see the Margin land-system pivot design). Deliberately a
// separate module from worldTerrain.ts (the old per-player-island system,
// still live in production) rather than a modification of it — this lets
// the continent generator be iterated on freely with zero risk to the
// running game, until Phases 2/3 are ready to cut over.
//
// Only the PURE, per-point primitives live here (elevation, temperature,
// mountain ridges, resource-deposit noise fields) — anything that needs the
// whole grid at once (rivers via flow accumulation, moisture via distance-
// to-water, biome classification that depends on those) lives in the
// offline bake script (packages/server/src/worldgen/generateContinent.ts)
// instead, since those are inherently global computations, not per-point
// functions. This is the one real architecture departure from worldTerrain
// .ts's "pure function, zero storage" philosophy — see the pivot memory for
// why (a global drainage network can't be computed one point at a time).

export const CONTINENT_SEED = 472819365;

// ~5,040,000 cells at 1km^2 each — close to the ~5,000,000km^2 target
// discussed in planning. A one-time offline bake, not a runtime cost, so
// generous resolution is fine; not tuned against a real playerbase yet.
export const CELL_SIZE_KM = 1;
export const CONTINENT_WIDTH = 2800;
export const CONTINENT_HEIGHT = 1800;
export const GRID_COLS = CONTINENT_WIDTH / CELL_SIZE_KM;
export const GRID_ROWS = CONTINENT_HEIGHT / CELL_SIZE_KM;

export const CONTINENT_SEA_LEVEL = 0.4;

// ---- noise primitives (copied from worldTerrain.ts, not imported) --------
// Deliberately duplicated rather than shared — this module is meant to be
// fully decoupled from the island system so either can be iterated on (or
// eventually deleted) independently. If both are still alive and drifting
// apart later, that's the moment to extract a shared noise.ts, not before.
function hash2D(x: number, y: number, seed: number): number {
  let h = seed | 0;
  h = Math.imul(h ^ x, 0x27d4eb2d);
  h = Math.imul(h ^ y, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function valueNoise2D(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const sx = smoothstep(x - x0);
  const sy = smoothstep(y - y0);
  const n00 = hash2D(x0, y0, seed);
  const n10 = hash2D(x1, y0, seed);
  const n01 = hash2D(x0, y1, seed);
  const n11 = hash2D(x1, y1, seed);
  return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy);
}

function fbm(x: number, y: number, seed: number, octaves: number): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let max = 0;
  for (let i = 0; i < octaves; i++) {
    value += valueNoise2D(x * frequency, y * frequency, seed + i * 101) * amplitude;
    max += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value / max;
}

function mulberry32(a: number): () => number {
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- continent shape -------------------------------------------------
// One landmass, not an archipelago: a large radial mask from the continent
// center, its sample point domain-warped (coarse + fine, same two-pass idiom
// worldTerrain.ts uses for island coastlines) so the coastline gets real
// bays/peninsulas instead of a smooth ellipse.
function continentMask(worldX: number, worldY: number): number {
  const coarseX = (fbm(worldX * 0.0006, worldY * 0.0006, CONTINENT_SEED + 500, 4) - 0.5) * 500;
  const coarseY = (fbm(worldX * 0.0006 + 31, worldY * 0.0006 + 31, CONTINENT_SEED + 700, 4) - 0.5) * 500;
  const fineX = (fbm(worldX * 0.003, worldY * 0.003, CONTINENT_SEED + 900, 3) - 0.5) * 120;
  const fineY = (fbm(worldX * 0.003 + 17, worldY * 0.003 + 17, CONTINENT_SEED + 1100, 3) - 0.5) * 120;
  const wx = worldX + coarseX + fineX;
  const wy = worldY + coarseY + fineY;

  const cx = CONTINENT_WIDTH / 2;
  const cy = CONTINENT_HEIGHT / 2;
  const nx = (wx - cx) / (CONTINENT_WIDTH / 2);
  const ny = (wy - cy) / (CONTINENT_HEIGHT / 2);
  const d = Math.hypot(nx, ny);
  // A plateau before the falloff begins — without this, mask=1 only ever
  // holds at the exact center point, so the "full interior elevation" zone
  // shrinks to a tiny core and the landmass reads far smaller than the
  // continent envelope this file's constants imply.
  const PLATEAU = 0.35;
  const t = clamp01((d - PLATEAU) / (1 - PLATEAU));
  return 1 - smoothstep(t);
}

// Deliberately NOT dominated by the mask term the way the island system's
// formula is — there, mask*0.8 pushes almost the whole interior toward the
// mountain-core cap, which is fine for a small island but reads as an
// unbroken highland once stretched across a whole continent. Here the mask
// interpolates between a clearly-submerged ocean floor (mask=0) and a
// modest plains/hills interior baseline (mask=1, comfortably below the
// mountain threshold), with broad low-frequency noise for regional
// highlands/lowlands on top — mountains come ONLY from explicit ridges
// below, never just from being far from the coast.
const OCEAN_FLOOR_ELEVATION = -0.3;
const INTERIOR_BASE_ELEVATION = 0.55;

function baseElevationAt(worldX: number, worldY: number): number {
  const mask = continentMask(worldX, worldY);
  const regional = fbm(worldX * 0.003, worldY * 0.003, CONTINENT_SEED + 50, 3);
  const detail = fbm(worldX * 0.01, worldY * 0.01, CONTINENT_SEED, 5);
  const baseline = lerp(OCEAN_FLOOR_ELEVATION, INTERIOR_BASE_ELEVATION, mask);
  return baseline + (regional - 0.5) * 0.25 + (detail - 0.5) * 0.12;
}

// ---- mountain ranges ----------------------------------------------------
// A small set of ridge polylines (seeded random walks), computed once at
// module load — deterministic, so every process (bake script, any future
// preview tool) agrees on the same ridges without needing to share state.
export interface RidgePoint {
  x: number;
  y: number;
}

export interface Ridge {
  points: RidgePoint[];
}

const RIDGE_COUNT = 5;

function generateRidges(): Ridge[] {
  const rng = mulberry32((CONTINENT_SEED ^ 0x51ed270b) >>> 0);
  const ridges: Ridge[] = [];
  for (let i = 0; i < RIDGE_COUNT; i++) {
    const points: RidgePoint[] = [];
    let x = CONTINENT_WIDTH * (0.15 + rng() * 0.7);
    let y = CONTINENT_HEIGHT * (0.15 + rng() * 0.7);
    let angle = rng() * Math.PI * 2;
    const steps = 15 + Math.floor(rng() * 10);
    const stepLen = 80 + rng() * 40;
    for (let s = 0; s < steps; s++) {
      points.push({ x, y });
      angle += (rng() - 0.5) * 0.6; // gentle meander, not a straight line or a random zigzag
      x += Math.cos(angle) * stepLen;
      y += Math.sin(angle) * stepLen;
    }
    ridges.push({ points });
  }
  return ridges;
}

export const RIDGES: Ridge[] = generateRidges();

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const abLenSq = abx * abx + aby * aby;
  const t = abLenSq > 0 ? clamp01((apx * abx + apy * aby) / abLenSq) : 0;
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  return Math.hypot(px - cx, py - cy);
}

function distanceToNearestRidge(x: number, y: number): number {
  let min = Infinity;
  for (const ridge of RIDGES) {
    for (let i = 0; i < ridge.points.length - 1; i++) {
      const a = ridge.points[i];
      const b = ridge.points[i + 1];
      const d = distanceToSegment(x, y, a.x, a.y, b.x, b.y);
      if (d < min) min = d;
    }
  }
  return min;
}

const MOUNTAIN_INFLUENCE_RADIUS = 35; // km — a narrower band than the first pass, which read as a solid highway
const MOUNTAIN_BOOST = 0.35;

function mountainBoost(worldX: number, worldY: number): number {
  const d = distanceToNearestRidge(worldX, worldY) / MOUNTAIN_INFLUENCE_RADIUS;
  const mask = 1 - smoothstep(clamp01(d));
  // Raised to a power so the boost is peaked (narrow crest, gentle skirt)
  // rather than a flat plateau the width of the whole influence radius —
  // the first pass's flat mask made every ridge look like a uniform slash.
  const peaked = mask ** 1.6;
  const jag = fbm(worldX * 0.03, worldY * 0.03, CONTINENT_SEED + 2000, 4);
  return peaked * MOUNTAIN_BOOST * (0.5 + 0.5 * jag);
}

/** Elevation at a world-space point (km), roughly 0-1+, CONTINENT_SEA_LEVEL=0.4 is the coastline. */
export function continentElevationAt(worldX: number, worldY: number): number {
  const base = baseElevationAt(worldX, worldY);
  if (base < CONTINENT_SEA_LEVEL) return base; // no mountain-building underwater
  return base + mountainBoost(worldX, worldY);
}

export function isContinentLand(elevation: number): boolean {
  return elevation >= CONTINENT_SEA_LEVEL;
}

// ---- temperature ----------------------------------------------------
// A latitude gradient (grid row, not a literal sphere) plus elevation-based
// lapse-rate cooling — moisture is deliberately NOT computed here, since it
// needs distance-to-water, which only exists once the bake script has
// materialized the grid and found the coastline/rivers/lakes.
export function temperatureAt(worldX: number, worldY: number, elevation: number): number {
  const latT = clamp01(worldY / CONTINENT_HEIGHT);
  const wobble = (fbm(worldX * 0.004, worldY * 0.004, CONTINENT_SEED + 3000, 3) - 0.5) * 0.15;
  let t = latT + wobble;
  const elevAboveSea = Math.max(0, elevation - CONTINENT_SEA_LEVEL);
  t -= elevAboveSea * 0.9;
  return clamp01(t);
}

// ---- biome classification ----------------------------------------------
// Flat threshold cascade, same idiom as worldTerrain.ts's TERRAIN_BANDS —
// tuned by inspection against the preview tool, not derived from a formula.
export type BiomeId =
  | "ocean"
  | "lake"
  | "river"
  | "beach"
  | "desert"
  | "plains"
  | "grassland"
  | "forest"
  | "taiga"
  | "tundra"
  | "mountain"
  | "snow";

export const BIOME_COLORS: Record<BiomeId, [number, number, number]> = {
  ocean: [58, 110, 165],
  lake: [79, 140, 195],
  river: [90, 150, 205],
  beach: [230, 215, 165],
  desert: [223, 197, 125],
  plains: [176, 196, 108],
  grassland: [141, 179, 92],
  forest: [79, 121, 66],
  taiga: [88, 120, 96],
  tundra: [176, 186, 170],
  mountain: [120, 114, 108],
  snow: [240, 240, 245],
};

export function classifyBiome(
  elevation: number,
  temperature: number,
  moisture: number,
  isRiver: boolean,
  isLake: boolean,
): BiomeId {
  if (elevation < CONTINENT_SEA_LEVEL) return "ocean";
  if (isLake) return "lake";
  if (isRiver) return "river";
  if (elevation > 0.82) return "snow";
  if (elevation > 0.68) return "mountain";
  if (elevation < CONTINENT_SEA_LEVEL + 0.02) return "beach";
  if (temperature < 0.2) return moisture > 0.45 ? "taiga" : "tundra";
  if (temperature > 0.7 && moisture < 0.35) return "desert";
  if (moisture > 0.65) return "forest";
  if (moisture > 0.3) return "grassland";
  return "plains";
}

// ---- resource deposits ----------------------------------------------
// Phase 1 taxonomy only: existing Food/Wood/Stone/Gold plus Iron Ore and
// Coal (see the Margin land-system pivot memory — the user's much larger
// 5-tier production-chain draft is saved there for Phase 3, not built now).
// Each kind gets its own noise field, thresholded in the bake script (where
// biome is known) into clustered deposit *regions* rather than uniform
// per-cell scatter, so a territory can plausibly read as "has real iron
// deposits" rather than every cell rolling independently.
export type ResourceDepositType = "food" | "wood" | "stone" | "iron" | "coal" | "gold";

const RESOURCE_SEED_OFFSETS: Record<ResourceDepositType, number> = {
  food: 4001,
  wood: 4002,
  stone: 4003,
  iron: 4004,
  coal: 4005,
  gold: 4006,
};

export function resourceNoiseAt(worldX: number, worldY: number, kind: ResourceDepositType): number {
  return fbm(worldX * 0.02, worldY * 0.02, CONTINENT_SEED + RESOURCE_SEED_OFFSETS[kind], 4);
}
