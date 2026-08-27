// Procedural island terrain for the World Map. Every settlement slot on the
// shared WORLD_PLOT_COLS x WORLD_PLOT_ROWS grid (see gameConfig.ts) gets its
// own island, generated from this module. Everything here is a pure
// function of (WORLD_TERRAIN_SEED, world-space coordinates) — client and
// server import the same module and always agree on where land is, with
// zero terrain data ever sent over the network, the same pattern
// production.ts/companyProduction.ts already use for shared pure formulas.
//
// Ported from a hand-verified prototype (a standalone Canvas/JS mockup
// iterated three times against direct visual feedback) — the noise
// primitives, domain-warp passes, and mountain-core capping below are that
// prototype's proven algorithm. One deliberate departure from the
// prototype: coastline warp and interior detail noise are sampled in a
// single continuous GLOBAL coordinate field (one shared seed), not
// per-island local coordinates — the prototype could get away with
// per-island noise because it baked each island onto its own isolated
// canvas; the real map bakes everything onto one continuous field, so
// ocean and coastlines never show a seam at a former "tile" boundary.
// Per-island character (ruggedness/elevation bias/mountain extent/tint)
// still comes from islandProfileFor, it just modulates the same shared
// field rather than seeding its own.

export const WORLD_TERRAIN_SEED = 918273645;

// One radial island per settlement slot, jittered off the grid so the
// archipelago doesn't read as a checkerboard. The jitter is generous but
// bounded well inside the pitch, so adjacent islands still can't collide
// hard enough to look broken (and if two do drift close, the max-mask
// blending below just renders it as a connected landmass, which reads as
// a natural strait/peninsula rather than a bug).
export const ISLAND_PITCH = 900;
export const ISLAND_BASE_RADIUS = 320;
export const ISLAND_JITTER = 230;
export const SEA_LEVEL = 0.4;

export interface IslandProfile {
  ruggedness: number;
  bias: number;
  coreRadius: number;
  tint: [number, number, number];
}

export interface TerrainBand {
  threshold: number;
  color: [number, number, number];
}

// Hard-edged biome bands (not interpolated) for a pixel-art terrain look —
// ported from a Godot canvas_item shader (grid-snapped noise sample +
// threshold cascade) the palette was already tuned in. Threshold semantics
// match the shader exactly: a band's threshold is its upper bound —
// elevation strictly below it gets that band's flat color, falling through
// to the next band otherwise. SEA_LEVEL (0.4 above) already matches the
// shader's own deepSeaThreshold, so the numbers ported over unscaled.
export const TERRAIN_BANDS: TerrainBand[] = [
  { threshold: 0.4, color: [144, 224, 239] }, // deep sea
  { threshold: 0.47, color: [173, 232, 244] }, // sea
  { threshold: 0.54, color: [202, 240, 249] }, // shallow sea
  { threshold: 0.555, color: [255, 243, 176] }, // sand
  { threshold: 0.6, color: [167, 201, 87] }, // grass
  { threshold: 0.65, color: [106, 153, 78] }, // forest
  { threshold: 0.71, color: [108, 117, 126] }, // mountain
  { threshold: 0.9, color: [255, 255, 255] }, // snow (also the catch-all above this)
];

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

function slotSeed(worldCol: number, worldRow: number): number {
  return (hash2D(worldCol, worldRow, WORLD_TERRAIN_SEED) * 0xffffffff) | 0;
}

const centerCache = new Map<string, { x: number; y: number }>();

export function islandCenterFor(worldCol: number, worldRow: number): { x: number; y: number } {
  const key = `${worldCol}:${worldRow}`;
  const cached = centerCache.get(key);
  if (cached) return cached;

  const baseX = (worldCol + 0.5) * ISLAND_PITCH;
  const baseY = (worldRow + 0.5) * ISLAND_PITCH;
  const jx = (hash2D(worldCol, worldRow, WORLD_TERRAIN_SEED + 41) - 0.5) * 2 * ISLAND_JITTER;
  const jy = (hash2D(worldCol, worldRow, WORLD_TERRAIN_SEED + 67) - 0.5) * 2 * ISLAND_JITTER;
  const center = { x: baseX + jx, y: baseY + jy };
  centerCache.set(key, center);
  return center;
}

// Deterministic per-slot values only, cached since a rendering pass looks
// this up far more often than it changes — at most WORLD_PLOT_COLS *
// WORLD_PLOT_ROWS entries ever exist, so the cache is small and permanent.
const profileCache = new Map<string, IslandProfile>();

export function islandProfileFor(worldCol: number, worldRow: number): IslandProfile {
  const key = `${worldCol}:${worldRow}`;
  const cached = profileCache.get(key);
  if (cached) return cached;

  const rng = mulberry32((slotSeed(worldCol, worldRow) ^ 0x9e3779b9) >>> 0);
  const profile: IslandProfile = {
    ruggedness: 0.6 + rng() * 1.0, // how bumpy the plains/hills texture is
    bias: (rng() - 0.5) * 0.14, // overall low-lying vs. elevated tendency
    coreRadius: 0.16 + rng() * 0.42, // how far the mountain core extends
    tint: [120 + rng() * 110, 120 + rng() * 110, 95 + rng() * 110],
  };
  profileCache.set(key, profile);
  return profile;
}

export interface WorldSlot {
  worldCol: number;
  worldRow: number;
}

// The 3x3 neighborhood of grid slots that could plausibly influence a given
// world point — islands are jittered but never far enough from their grid
// slot to matter beyond one ring of neighbors. Callers filter this down to
// slots that actually have a settlement (unclaimed slots contribute no
// land) before passing it to elevationAtWorld.
export function nearbySlots(worldX: number, worldY: number): WorldSlot[] {
  const col = Math.floor(worldX / ISLAND_PITCH);
  const row = Math.floor(worldY / ISLAND_PITCH);
  const out: WorldSlot[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      out.push({ worldCol: col + dc, worldRow: row + dr });
    }
  }
  return out;
}

export interface ElevationResult {
  elevation: number;
  dominant: WorldSlot | null;
}

// Elevation at a WORLD-space point, given the candidate island slots that
// might influence it (see nearbySlots). Coastline warp and interior detail
// noise are sampled once here in the shared global field — only the
// island-field radial mask (per candidate) and the mountain-capping
// profile (of whichever candidate dominates) vary by island, which is what
// keeps ocean and coastlines seamless across the whole map.
export function elevationAtWorld(worldX: number, worldY: number, candidates: WorldSlot[]): ElevationResult {
  // two stacked domain-warp passes: coarse for major bays/peninsulas, fine
  // for jagged small-scale coastline detail — a single global field, not
  // per-island, so it never discontinues at a boundary between islands
  const coarseX = (fbm(worldX * 0.008, worldY * 0.008, WORLD_TERRAIN_SEED + 500, 3) - 0.5) * 80;
  const coarseY = (fbm(worldX * 0.008 + 31, worldY * 0.008 + 31, WORLD_TERRAIN_SEED + 700, 3) - 0.5) * 80;
  const fineX = (fbm(worldX * 0.035, worldY * 0.035, WORLD_TERRAIN_SEED + 900, 2) - 0.5) * 18;
  const fineY = (fbm(worldX * 0.035 + 17, worldY * 0.035 + 17, WORLD_TERRAIN_SEED + 1100, 2) - 0.5) * 18;
  const wx = worldX + coarseX + fineX;
  const wy = worldY + coarseY + fineY;

  let islandField = 0;
  let dominant: WorldSlot | null = null;
  let dominantD = 1;
  for (const slot of candidates) {
    const center = islandCenterFor(slot.worldCol, slot.worldRow);
    const d = Math.hypot(wx - center.x, wy - center.y) / ISLAND_BASE_RADIUS;
    const mask = 1 - smoothstep(clamp01(d));
    if (mask > islandField) {
      islandField = mask;
      dominant = slot;
      dominantD = d;
    }
  }

  const detailRaw = fbm(worldX * 0.018, worldY * 0.018, WORLD_TERRAIN_SEED, 5);
  const profile = dominant ? islandProfileFor(dominant.worldCol, dominant.worldRow) : null;
  const ruggedness = profile?.ruggedness ?? 1;
  const bias = profile?.bias ?? 0;
  const coreRadius = profile?.coreRadius ?? 0.35;
  // recenter before scaling so ruggedness changes variance, not the mean —
  // otherwise a "flat" island would just sink below sea level everywhere
  const detailCentered = (detailRaw - 0.5) * ruggedness + 0.5;

  let e = islandField * 0.8 + detailCentered * 0.55 - 0.28 + bias;

  // the base formula alone lets noise push elevation into mountain range
  // across a wide plateau near the center (the mask itself stays ~1 there)
  // — pull anything above a modest plains/hills baseline back down unless
  // it's within the island's own core radius, so hills and peaks read as
  // an actual localized highland instead of a flat mass spilling across
  // most of the interior
  const CAP_TARGET = 0.55;
  if (e > CAP_TARGET) {
    const coreMask = 1 - smoothstep(clamp01(dominantD / coreRadius));
    e = CAP_TARGET + (e - CAP_TARGET) * coreMask;
  }

  return { elevation: e, dominant };
}

export function isLand(elevation: number): boolean {
  return elevation >= SEA_LEVEL;
}

export function bandColor(elevation: number): [number, number, number] {
  for (const band of TERRAIN_BANDS) {
    if (elevation < band.threshold) return band.color;
  }
  return TERRAIN_BANDS[TERRAIN_BANDS.length - 1].color;
}
