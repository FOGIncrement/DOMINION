import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BUILDING_TYPES,
  CELLS_PER_ZONE_SLOT,
  ISLAND_BASE_RADIUS,
  ISLAND_PITCH,
  PLOT_ZONING_SIZE,
  SEA_LEVEL,
  WORLD_PLOT_COLS,
  WORLD_PLOT_ROWS,
  WORLD_TERRAIN_SEED,
  ZONE_TYPES,
  ZONE_TYPE_IDS,
  bandColor,
  elevationAtWorld,
  islandCenterFor,
  islandProfileFor,
  zoneCategoryForIndustry,
  type BuildingTypeId,
  type CompanyIndustryId,
  type WorldSlot,
  type ZoneTypeId,
} from "@dominion/shared";
import { api, ApiError, type SettlementDetailCompany, type WorldMapSettlement, type ZoneRect } from "../api/client.js";
import { useAllCompanies, useSettlementDetail, useWorldMap, useZones } from "../api/hooks.js";

// ---- client-only rendering constants — spatial layout, not game data -----
const DISPLAY_SCALE = 0.8; // CSS px per world-unit at zoom = 1
const SAMPLE_STEP = 6; // world-units per terrain sample, upscaled via canvas smoothing
const RENDER_MARGIN = 550; // world-units of ocean padding kept around every island's own extent
const PLOT_WORLD_SIZE = ISLAND_BASE_RADIUS * 1.1; // the buildable square, inscribed in the island
const CELL_WORLD_SIZE = PLOT_WORLD_SIZE / PLOT_ZONING_SIZE;
const CELL_PX = CELL_WORLD_SIZE * DISPLAY_SCALE;

const ZOOM_MIN = 0.35;
// The old hard zoom ceiling. It's now the entry TRIGGER for the island
// detail view (see DETAIL_TRIGGER_ZOOM below) rather than a clamp — zooming
// in over open ocean past this point just keeps zooming, uncapped up to
// ZOOM_MAX_DETAIL, since there's no island to switch into.
const ZOOM_MAX_DETAIL = 40;
const ZOOM_HOME = 1.8;
const GRID_FADE_LO = 1.1;
const GRID_FADE_HI = 2.6;
const MARKER_FADE_LO = 2.4;
const MARKER_FADE_HI = 4.8;
const GRAIN_SEED = WORLD_TERRAIN_SEED + 3333;

// ---- zoom-to-island-detail (Phase B) -------------------------------------
const DETAIL_TRIGGER_ZOOM = 14; // crossing this while zooming in enters detail mode; crossing back down exits it
const DETAIL_CAPTURE_RADIUS = ISLAND_BASE_RADIUS; // world-units — how close the viewport center must be to an island to enter its detail view
const DETAIL_SAMPLE_STEP = SAMPLE_STEP / 4; // ~4x finer bake than the whole-map terrain
const DETAIL_MARGIN = 60; // world-units of padding around the island's own radius, so the bake isn't cropped at the coastline mask edge
const DETAIL_TRANSITION_MS = 280;
// A half-viewport at DETAIL_TRIGGER_ZOOM only spans ~50-65 world-units (a
// typical viewport width in px, divided by DISPLAY_SCALE*zoom) — these
// radii/offsets are kept comfortably inside that so the town and both
// company clusters are at least partly visible the instant detail mode is
// entered, rather than requiring the player to pan blind to discover them.
const TOWN_CORE_RADIUS = PLOT_WORLD_SIZE * 0.06;
const FALLBACK_CLUSTER_RADIUS = PLOT_WORLD_SIZE * 0.05;
const INDUSTRIAL_CLUSTER_OFFSET = { x: PLOT_WORLD_SIZE * 0.1, y: -PLOT_WORLD_SIZE * 0.03 };
const RETAIL_CLUSTER_OFFSET = { x: -PLOT_WORLD_SIZE * 0.1, y: PLOT_WORLD_SIZE * 0.05 };
const BUILDING_SEED = WORLD_TERRAIN_SEED + 5000;
const COMPANY_SEED = WORLD_TERRAIN_SEED + 6000;
const PEOPLE_PER_POP = 7; // ~1 dot per 7 population
const PEOPLE_MIN = 6;
const PEOPLE_MAX = 140;
const PERSON_RADIUS_WORLD = 2;
const PERSON_SPEED_MIN = 6; // world-units/sec
const PERSON_SPEED_MAX = 16;

const ZONE_TYPE_COLORS: Record<ZoneTypeId, string> = {
  industrial: "#c17f3a",
  retail: "#2f8f8a",
};

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function hash2D(x: number, y: number, seed: number): number {
  let h = seed | 0;
  h = Math.imul(h ^ x, 0x27d4eb2d);
  h = Math.imul(h ^ y, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function islandCenterPx(worldCol: number, worldRow: number) {
  const c = islandCenterFor(worldCol, worldRow);
  return { x: c.x * DISPLAY_SCALE, y: c.y * DISPLAY_SCALE };
}

// FNV-1a — cheap, deterministic, good-enough distribution for turning a
// cuid into two independent-looking hash coordinates below. Not
// cryptographic, doesn't need to be; only used for stable visual placement.
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// A deterministic jittered-disk scatter point (world-units, relative to
// whatever cluster center the caller places it around) for a given id — the
// detail view's stand-in for "spiral/grid-packed" placement of buildings and
// fallback-cluster companies. Same id always lands in the same spot, so a
// 15s poll refresh never makes the town jitter around; sqrt(b) gives a
// uniform (not center-biased) distribution across the disk.
function stablePoint(id: string, salt: number, radius: number): { x: number; y: number } {
  const h = hashString(id);
  const a = hash2D(h & 0xffff, (h >>> 16) & 0xffff, salt);
  const b = hash2D((h >>> 3) & 0xffff, (h >>> 19) & 0xffff, salt + 97);
  const angle = a * Math.PI * 2;
  const dist = Math.sqrt(b) * radius;
  return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist };
}

// Flattens every cell of a category's real completed zone rects (in the
// settlement's local PLOT_ZONING_SIZE grid) into world-space cell centers —
// companies in that category get assigned one cell each via a stable hash of
// their own id, so they visually sit inside the zone that actually grants
// their founding capacity rather than a generic cluster.
function flattenZoneCells(rects: ZoneRect[], plotOrigin: { x: number; y: number }): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  for (const r of rects) {
    for (let cy = 0; cy < r.height; cy++) {
      for (let cx = 0; cx < r.width; cx++) {
        cells.push({
          x: plotOrigin.x + (r.x + cx + 0.5) * CELL_WORLD_SIZE,
          y: plotOrigin.y + (r.y + cy + 0.5) * CELL_WORLD_SIZE,
        });
      }
    }
  }
  return cells;
}

// Which settlement (if any) the viewport is currently centered over, for
// deciding whether crossing DETAIL_TRIGGER_ZOOM while zooming in should
// enter that island's detail view — "the viewport center," not the cursor,
// so panning-then-zooming behaves predictably regardless of scroll focal
// point. pan/zoom are in scene units (world-units * DISPLAY_SCALE), matching
// how panRef/zoomRef are used everywhere else in this file.
function nearestSettlementAtViewportCenter(
  settlements: WorldMapSettlement[],
  viewport: HTMLDivElement,
  pan: { x: number; y: number },
  zoom: number,
): WorldMapSettlement | null {
  const worldX = (viewport.clientWidth / 2 - pan.x) / zoom / DISPLAY_SCALE;
  const worldY = (viewport.clientHeight / 2 - pan.y) / zoom / DISPLAY_SCALE;
  let best: WorldMapSettlement | null = null;
  let bestD = Infinity;
  for (const s of settlements) {
    const c = islandCenterFor(s.worldCol, s.worldRow);
    const d = Math.hypot(c.x - worldX, c.y - worldY);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best && bestD <= DETAIL_CAPTURE_RADIUS ? best : null;
}

// Bounding box (world-units) for one island's detail bake — centered on its
// slot, padded past the island radius so the finer bake isn't cropped right
// at the coastline mask's own falloff edge.
function islandDetailBounds(worldCol: number, worldRow: number): WorldBounds {
  const c = islandCenterFor(worldCol, worldRow);
  const r = ISLAND_BASE_RADIUS + DETAIL_MARGIN;
  return { minX: c.x - r, minY: c.y - r, maxX: c.x + r, maxY: c.y + r };
}

interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// World-space (not px) bounding box covering every real settlement's island
// plus a comfortable ocean margin — used both to size/position the terrain
// bake and to clamp panning, so the two always agree.
function computeWorldBounds(settlements: WorldMapSettlement[]): WorldBounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of settlements) {
    const c = islandCenterFor(s.worldCol, s.worldRow);
    minX = Math.min(minX, c.x - RENDER_MARGIN);
    minY = Math.min(minY, c.y - RENDER_MARGIN);
    maxX = Math.max(maxX, c.x + RENDER_MARGIN);
    maxY = Math.max(maxY, c.y + RENDER_MARGIN);
  }
  return { minX, minY, maxX, maxY };
}

class ClaimedGrid {
  private flags: Uint8Array;

  constructor(settlements: WorldMapSettlement[]) {
    this.flags = new Uint8Array(WORLD_PLOT_COLS * WORLD_PLOT_ROWS);
    for (const s of settlements) {
      if (s.worldCol >= 0 && s.worldCol < WORLD_PLOT_COLS && s.worldRow >= 0 && s.worldRow < WORLD_PLOT_ROWS) {
        this.flags[s.worldRow * WORLD_PLOT_COLS + s.worldCol] = 1;
      }
    }
  }

  has(worldCol: number, worldRow: number): boolean {
    if (worldCol < 0 || worldCol >= WORLD_PLOT_COLS || worldRow < 0 || worldRow >= WORLD_PLOT_ROWS) return false;
    return this.flags[worldRow * WORLD_PLOT_COLS + worldCol] === 1;
  }
}

// Bakes a terrain field for an arbitrary world-space region — shared by the
// whole-archipelago bake (bakeWorldTerrain) and the finer per-island bake
// (bakeIslandDetailTerrain, Phase B). Sampling in a single continuous
// world-space coordinate system (elevationAtWorld) is what keeps ocean and
// coastlines seamless: independently-baked per-island tiles each had their
// own isolated noise field, so the seawater between two tiles never
// actually matched up at the boundary — both callers stay on that same
// shared field, just at different bounds/stride.
function bakeTerrainRegion(
  canvas: HTMLCanvasElement,
  settlements: WorldMapSettlement[],
  bounds: WorldBounds,
  sampleStep: number,
) {
  const claimed = new ClaimedGrid(settlements);
  const worldW = bounds.maxX - bounds.minX;
  const worldH = bounds.maxY - bounds.minY;
  const sampleCols = Math.max(1, Math.round(worldW / sampleStep));
  const sampleRows = Math.max(1, Math.round(worldH / sampleStep));
  const n = sampleCols * sampleRows;

  const elevation = new Float32Array(n);
  const tints: Array<[number, number, number] | null> = new Array(n).fill(null);
  const candidateBuf: WorldSlot[] = [];

  for (let row = 0; row < sampleRows; row++) {
    const worldY = bounds.minY + row * sampleStep;
    for (let col = 0; col < sampleCols; col++) {
      const worldX = bounds.minX + col * sampleStep;

      candidateBuf.length = 0;
      const baseCol = Math.floor(worldX / ISLAND_PITCH);
      const baseRow = Math.floor(worldY / ISLAND_PITCH);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const wc = baseCol + dc;
          const wr = baseRow + dr;
          if (claimed.has(wc, wr)) candidateBuf.push({ worldCol: wc, worldRow: wr });
        }
      }

      const { elevation: e, dominant } = elevationAtWorld(worldX, worldY, candidateBuf);
      const idx = row * sampleCols + col;
      elevation[idx] = e;
      if (dominant) tints[idx] = islandProfileFor(dominant.worldCol, dominant.worldRow).tint;
    }
  }

  const lightX = -0.6;
  const lightY = -0.75;
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = sampleCols;
  sampleCanvas.height = sampleRows;
  const sampleCtx = sampleCanvas.getContext("2d")!;
  const image = sampleCtx.createImageData(sampleCols, sampleRows);
  const data = image.data;

  for (let row = 0; row < sampleRows; row++) {
    for (let col = 0; col < sampleCols; col++) {
      const idx = row * sampleCols + col;
      const e = elevation[idx];
      const eL = elevation[row * sampleCols + Math.max(0, col - 1)];
      const eR = elevation[row * sampleCols + Math.min(sampleCols - 1, col + 1)];
      const eU = elevation[Math.max(0, row - 1) * sampleCols + col];
      const eD = elevation[Math.min(sampleRows - 1, row + 1) * sampleCols + col];
      const dx = eR - eL;
      const dy = eD - eU;
      const land = e >= SEA_LEVEL;
      // Posterized into 3 discrete levels (not the old continuous 0.6-1.42
      // range, and no separate contour-line pass) so relief still reads
      // against flat biome bands without a smooth gradient fighting the
      // pixel-art look — a contour line at a fixed elevation interval reads
      // as a stray dark stripe once color itself is already banded.
      let shade = 1;
      if (land) {
        const continuous = clamp(1 + (dx * -lightX + dy * -lightY) * 4.4, 0.6, 1.42);
        shade = continuous < 0.85 ? 0.8 : continuous > 1.15 ? 1.2 : 1;
      }
      // grain uses global sample indices (not per-tile-relative), so it
      // never resets/misaligns at a former tile boundary either
      const grain = 1 + (hash2D(col, row, GRAIN_SEED) - 0.5) * 0.04;

      const rgb = bandColor(e);
      let r = rgb[0];
      let g = rgb[1];
      let b = rgb[2];
      const tint = tints[idx];
      if (land && tint) {
        r = lerp(r, tint[0], 0.2);
        g = lerp(g, tint[1], 0.2);
        b = lerp(b, tint[2], 0.2);
      }

      const p = idx * 4;
      data[p] = clampByte(r * shade * grain);
      data[p + 1] = clampByte(g * shade * grain);
      data[p + 2] = clampByte(b * shade * grain);
      data[p + 3] = 255;
    }
  }
  sampleCtx.putImageData(image, 0, 0);

  const displayW = worldW * DISPLAY_SCALE;
  const displayH = worldH * DISPLAY_SCALE;
  canvas.width = displayW;
  canvas.height = displayH;
  canvas.style.left = `${bounds.minX * DISPLAY_SCALE}px`;
  canvas.style.top = `${bounds.minY * DISPLAY_SCALE}px`;
  canvas.style.width = `${displayW}px`;
  canvas.style.height = `${displayH}px`;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sampleCanvas, 0, 0, sampleCols, sampleRows, 0, 0, displayW, displayH);
}

function bakeWorldTerrain(canvas: HTMLCanvasElement, settlements: WorldMapSettlement[], bounds: WorldBounds) {
  bakeTerrainRegion(canvas, settlements, bounds, SAMPLE_STEP);
}

// Same bake, same palette, scoped to one island's bounding box at ~4x finer
// stride — cheap even at that finer stride since the region covers a tiny
// fraction of the whole-map bake's area. No new terrain math (see the
// module comment above bakeTerrainRegion).
function bakeIslandDetailTerrain(canvas: HTMLCanvasElement, settlements: WorldMapSettlement[], worldCol: number, worldRow: number) {
  bakeTerrainRegion(canvas, settlements, islandDetailBounds(worldCol, worldRow), DETAIL_SAMPLE_STEP);
}

function WorldTerrainCanvas({ settlements, bounds }: { settlements: WorldMapSettlement[]; bounds: WorldBounds }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Only the roster's identity/positions matter — polling refreshes the
  // settlements array constantly, but terrain only needs rebaking if the
  // set of slots actually changes.
  const rosterKey = useMemo(
    () => settlements.map((s) => `${s.worldCol}:${s.worldRow}`).sort().join(","),
    [settlements],
  );

  useEffect(() => {
    if (canvasRef.current) bakeWorldTerrain(canvasRef.current, settlements, bounds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterKey]);

  return <canvas ref={canvasRef} className="map-terrain-canvas" style={{ position: "absolute", display: "block" }} />;
}

function IslandDetailTerrainCanvas({
  settlements,
  worldCol,
  worldRow,
}: {
  settlements: WorldMapSettlement[];
  worldCol: number;
  worldRow: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rosterKey = useMemo(
    () => settlements.map((s) => `${s.worldCol}:${s.worldRow}`).sort().join(","),
    [settlements],
  );

  useEffect(() => {
    if (canvasRef.current) bakeIslandDetailTerrain(canvasRef.current, settlements, worldCol, worldRow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterKey, worldCol, worldRow]);

  return <canvas ref={canvasRef} className="map-terrain-canvas" style={{ position: "absolute", display: "block" }} />;
}

// Decorative-only ambient population — count derived from population, not
// tied to specific buildings/workplaces (the game doesn't track that).
// Plain ephemeral Math.random() walk state, reseeded fresh every time
// detail mode is entered (this component only exists while mounted), unlike
// the hash-seeded building/company placement below which must stay stable
// across polls.
interface PersonDot {
  x: number;
  y: number;
  tx: number;
  ty: number;
  speed: number;
  nextRetargetAt: number;
}

function IslandPeopleCanvas({
  worldCol,
  worldRow,
  populationCount,
}: {
  worldCol: number;
  worldRow: number;
  populationCount: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dotsRef = useRef<PersonDot[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const islandCenter = useMemo(() => islandCenterFor(worldCol, worldRow), [worldCol, worldRow]);
  const half = PLOT_WORLD_SIZE / 2;

  // Seed once per mount (i.e. once per detail-mode entry) — deliberately not
  // re-run when populationCount ticks from a later poll, or the whole crowd
  // would jump to new positions every 15s instead of just wandering.
  useEffect(() => {
    const count = Math.max(PEOPLE_MIN, Math.min(PEOPLE_MAX, Math.round(populationCount / PEOPLE_PER_POP)));
    const randomPoint = () => ({
      x: islandCenter.x + (Math.random() * 2 - 1) * half,
      y: islandCenter.y + (Math.random() * 2 - 1) * half,
    });
    dotsRef.current = Array.from({ length: count }, () => {
      const start = randomPoint();
      const target = randomPoint();
      return {
        x: start.x,
        y: start.y,
        tx: target.x,
        ty: target.y,
        speed: PERSON_SPEED_MIN + Math.random() * (PERSON_SPEED_MAX - PERSON_SPEED_MIN),
        nextRetargetAt: 0,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Correctness requirement, not a nice-to-have: this is the only continuous
  // per-frame loop anywhere on this page, so it must actually stop —
  // cancelled on unmount (leaving detail mode unmounts this component) and
  // paused/resumed on tab visibility, or a player leaving a detail view open
  // in a background tab burns CPU/battery indefinitely.
  useEffect(() => {
    const draw = (ts: number) => {
      const canvas = canvasRef.current;
      if (canvas) {
        const dt = lastTsRef.current === null ? 0 : Math.min(0.25, (ts - lastTsRef.current) / 1000);
        lastTsRef.current = ts;
        const ctx = canvas.getContext("2d")!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const originX = islandCenter.x - half;
        const originY = islandCenter.y - half;
        for (const dot of dotsRef.current) {
          if (ts >= dot.nextRetargetAt) {
            dot.tx = islandCenter.x + (Math.random() * 2 - 1) * half;
            dot.ty = islandCenter.y + (Math.random() * 2 - 1) * half;
            dot.nextRetargetAt = ts + 1000 + Math.random() * 2000;
          }
          const dx = dot.tx - dot.x;
          const dy = dot.ty - dot.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 0.5) {
            const step = Math.min(dist, dot.speed * dt);
            dot.x += (dx / dist) * step;
            dot.y += (dy / dist) * step;
          }
          const px = (dot.x - originX) * DISPLAY_SCALE;
          const py = (dot.y - originY) * DISPLAY_SCALE;
          ctx.beginPath();
          ctx.arc(px, py, PERSON_RADIUS_WORLD * DISPLAY_SCALE, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(35, 27, 19, 0.8)";
          ctx.fill();
        }
      }
      rafRef.current = requestAnimationFrame(draw);
    };

    const start = () => {
      if (rafRef.current === null) {
        lastTsRef.current = null;
        rafRef.current = requestAnimationFrame(draw);
      }
    };
    const stop = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    start();
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [islandCenter.x, islandCenter.y, half]);

  return (
    <canvas
      ref={canvasRef}
      width={Math.max(1, Math.round(PLOT_WORLD_SIZE * DISPLAY_SCALE))}
      height={Math.max(1, Math.round(PLOT_WORLD_SIZE * DISPLAY_SCALE))}
      style={{
        position: "absolute",
        left: (islandCenter.x - half) * DISPLAY_SCALE,
        top: (islandCenter.y - half) * DISPLAY_SCALE,
        pointerEvents: "none",
      }}
    />
  );
}

// Buildings cluster near the island center ("town core"); companies cluster
// by zone category, and — for a player-owned settlement with real completed
// zones in that category — sit inside the actual zone cells rather than a
// generic cluster (see flattenZoneCells). Everything else (privacy for
// non-owned settlements, and an owned settlement's baseline-free-slot
// companies before any zone exists) falls back to a hash-seeded cluster
// offset from the town core. NPC settlements only ever have buildings —
// Company rows have no settlementId, so an NPC's companies (ownerId: null)
// can't be looked up here at all.
function IslandDetailLayer({ settlements, target }: { settlements: WorldMapSettlement[]; target: WorldMapSettlement }) {
  const { data: detail } = useSettlementDetail(target.id);
  const navigate = useNavigate();
  const islandCenter = useMemo(() => islandCenterFor(target.worldCol, target.worldRow), [target.worldCol, target.worldRow]);
  const plotOrigin = useMemo(
    () => ({ x: islandCenter.x - PLOT_WORLD_SIZE / 2, y: islandCenter.y - PLOT_WORLD_SIZE / 2 }),
    [islandCenter.x, islandCenter.y],
  );

  const placedBuildings = useMemo(() => {
    if (!detail) return [];
    return detail.buildings.map((b) => {
      const p = stablePoint(b.id, BUILDING_SEED, TOWN_CORE_RADIUS);
      return { building: b, worldX: islandCenter.x + p.x, worldY: islandCenter.y + p.y };
    });
  }, [detail, islandCenter.x, islandCenter.y]);

  const placedCompanies = useMemo(() => {
    if (!detail) return [];
    const out: { company: SettlementDetailCompany; worldX: number; worldY: number }[] = [];
    for (const zoneType of ZONE_TYPE_IDS) {
      const inCategory = detail.companies.filter(
        (c) => zoneCategoryForIndustry(c.industry as CompanyIndustryId) === zoneType,
      );
      if (inCategory.length === 0) continue;
      const rects = detail.zones.filter((z) => z.zoneType === zoneType && z.status === "completed");
      if (rects.length > 0) {
        const cells = flattenZoneCells(rects, plotOrigin);
        for (const c of inCategory) {
          const cell = cells[hashString(c.id) % cells.length];
          out.push({ company: c, worldX: cell.x, worldY: cell.y });
        }
      } else {
        const offset = zoneType === "industrial" ? INDUSTRIAL_CLUSTER_OFFSET : RETAIL_CLUSTER_OFFSET;
        const clusterCenter = { x: islandCenter.x + offset.x, y: islandCenter.y + offset.y };
        for (const c of inCategory) {
          const p = stablePoint(c.id, COMPANY_SEED, FALLBACK_CLUSTER_RADIUS);
          out.push({ company: c, worldX: clusterCenter.x + p.x, worldY: clusterCenter.y + p.y });
        }
      }
    }
    return out;
  }, [detail, islandCenter.x, islandCenter.y, plotOrigin]);

  return (
    <>
      <IslandDetailTerrainCanvas settlements={settlements} worldCol={target.worldCol} worldRow={target.worldRow} />
      <IslandPeopleCanvas
        worldCol={target.worldCol}
        worldRow={target.worldRow}
        populationCount={detail?.population.count ?? 0}
      />
      {placedBuildings.map(({ building, worldX, worldY }) => (
        <div
          key={building.id}
          title={`${BUILDING_TYPES[building.type as BuildingTypeId]?.name ?? building.type} · Lv ${building.level} · ${building.workersAssigned} worker${building.workersAssigned === 1 ? "" : "s"}`}
          onClick={target.isMine ? () => navigate("/") : undefined}
          style={{
            position: "absolute",
            left: worldX * DISPLAY_SCALE,
            top: worldY * DISPLAY_SCALE,
            transform: "translate(-50%, -50%)",
            width: 10,
            height: 10,
            background: "#caa35a",
            border: "1px solid rgba(0,0,0,0.5)",
            boxShadow: "0 1px 2px rgba(0,0,0,0.4)",
            cursor: target.isMine ? "pointer" : "default",
          }}
        />
      ))}
      {placedCompanies.map(({ company, worldX, worldY }) => (
        <div
          key={company.id}
          title={`${company.name} · ${company.industryName} · Lv ${company.level} · ${company.workersAssigned} worker${company.workersAssigned === 1 ? "" : "s"}`}
          onClick={() => navigate("/companies", { state: { jumpToCompanyId: company.id } })}
          style={{
            position: "absolute",
            left: worldX * DISPLAY_SCALE,
            top: worldY * DISPLAY_SCALE,
            transform: "translate(-50%, -50%)",
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: ZONE_TYPE_COLORS[zoneCategoryForIndustry(company.industry as CompanyIndustryId)],
            border: "1px solid rgba(0,0,0,0.5)",
            boxShadow: "0 1px 2px rgba(0,0,0,0.4)",
            cursor: "pointer",
          }}
        />
      ))}
    </>
  );
}

function IslandMarker({ settlement }: { settlement: WorldMapSettlement }) {
  const centerPx = islandCenterPx(settlement.worldCol, settlement.worldRow);
  const color = settlement.isMine ? "var(--accent)" : settlement.isPlayer ? "var(--series-stone)" : "var(--text-muted)";
  const label = settlement.isMine ? `${settlement.name} (you)` : settlement.archetypeName ? `${settlement.name} (${settlement.archetypeName})` : settlement.name;

  return (
    <div
      style={{
        position: "absolute",
        left: centerPx.x,
        top: centerPx.y,
        transform: "translate(-50%, -50%)",
        display: "flex",
        alignItems: "center",
        gap: 6,
        pointerEvents: "none",
        whiteSpace: "nowrap",
      }}
      title={label}
    >
      <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, boxShadow: "0 0 0 2px rgba(0,0,0,0.4)" }} />
      <span style={{ fontSize: 12, fontWeight: 700, color: "#fff", textShadow: "0 1px 3px rgba(0,0,0,0.85)" }}>{label}</span>
    </div>
  );
}

interface Selection {
  x: number;
  y: number;
  width: number;
  height: number;
}

function normalizeRect(a: { x: number; y: number }, b: { x: number; y: number }): Selection {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x) + 1, height: Math.abs(a.y - b.y) + 1 };
}

function rectsOverlap(a: Selection, b: Selection): boolean {
  return !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
}

function clampCell(value: number, max: number): number {
  return Math.max(0, Math.min(max - 1, Math.floor(value)));
}

// The real zoning grid + real placed zones for the player's own island —
// this replaces the old standalone "Your Plot" panel. Positioned in world
// space like everything else in .world, so it pans/zooms along with the
// terrain beneath it; its own SVG viewBox stays in un-scaled CSS px, which
// is why pointToCell divides by the current zoom to normalize back.
function MyPlotOverlay({
  settlement,
  zones,
  zoneToolActive,
  zoomRef,
  plotLayerRef,
  selection,
  onSelectionChange,
  onSelectionDone,
}: {
  settlement: WorldMapSettlement;
  zones: ZoneRect[];
  zoneToolActive: boolean;
  zoomRef: React.MutableRefObject<number>;
  plotLayerRef: React.MutableRefObject<SVGSVGElement | null>;
  selection: Selection | null;
  onSelectionChange: (s: Selection | null) => void;
  onSelectionDone: (s: Selection) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [hovering, setHovering] = useState(false);

  const setSvgRefs = (node: SVGSVGElement | null) => {
    svgRef.current = node;
    plotLayerRef.current = node;
  };

  const centerPx = islandCenterPx(settlement.worldCol, settlement.worldRow);
  const plotSizePx = PLOT_ZONING_SIZE * CELL_PX;
  const left = centerPx.x - plotSizePx / 2;
  const top = centerPx.y - plotSizePx / 2;

  const pointToCell = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const zoom = zoomRef.current || 1;
    const x = clampCell((e.clientX - rect.left) / zoom / CELL_PX, PLOT_ZONING_SIZE);
    const y = clampCell((e.clientY - rect.top) / zoom / CELL_PX, PLOT_ZONING_SIZE);
    return { x, y };
  };

  const isBlocked = (cell: { x: number; y: number }) =>
    zones.some((z) => cell.x >= z.x && cell.x < z.x + z.width && cell.y >= z.y && cell.y < z.y + z.height);

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!zoneToolActive) return;
    const cell = pointToCell(e);
    if (!cell || isBlocked(cell)) return;
    e.stopPropagation();
    dragStart.current = cell;
    onSelectionChange({ x: cell.x, y: cell.y, width: 1, height: 1 });
    setHovering(true);
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragStart.current) return;
    e.stopPropagation();
    const cell = pointToCell(e);
    if (!cell) return;
    onSelectionChange(normalizeRect(dragStart.current, cell));
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragStart.current) {
      setHovering(false);
      return;
    }
    e.stopPropagation();
    dragStart.current = null;
    setHovering(false);
    if (!selection) return;
    if (zones.some((z) => rectsOverlap(z, selection))) {
      onSelectionChange(null);
      return;
    }
    onSelectionDone(selection);
  };

  return (
    <svg
      ref={setSvgRefs}
      width={plotSizePx}
      height={plotSizePx}
      style={{
        position: "absolute",
        left,
        top,
        touchAction: "none",
        cursor: zoneToolActive ? "crosshair" : "default",
        pointerEvents: zoneToolActive ? "auto" : "none",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <rect width={plotSizePx} height={plotSizePx} fill="none" stroke="var(--accent)" strokeWidth={2} strokeOpacity={0.7} />
      {Array.from({ length: PLOT_ZONING_SIZE + 1 }).map((_, i) => (
        <g key={`grid-${i}`}>
          <line x1={i * CELL_PX} y1={0} x2={i * CELL_PX} y2={plotSizePx} stroke="rgba(255,255,255,0.18)" />
          <line x1={0} y1={i * CELL_PX} x2={plotSizePx} y2={i * CELL_PX} stroke="rgba(255,255,255,0.18)" />
        </g>
      ))}
      {zones.map((z, i) => (
        <rect
          key={i}
          x={z.x * CELL_PX}
          y={z.y * CELL_PX}
          width={z.width * CELL_PX}
          height={z.height * CELL_PX}
          fill={ZONE_TYPE_COLORS[z.zoneType as ZoneTypeId] ?? "var(--text-muted)"}
          opacity={z.status === "completed" ? 0.85 : z.status === "building" ? 0.55 : 0.3}
          stroke={z.status === "pending" ? "var(--text-muted)" : "none"}
          strokeDasharray={z.status === "pending" ? "4 3" : undefined}
        >
          <title>
            {ZONE_TYPES[z.zoneType as ZoneTypeId]?.name ?? z.zoneType} — {z.status}
          </title>
        </rect>
      ))}
      {selection && (
        <rect
          x={selection.x * CELL_PX}
          y={selection.y * CELL_PX}
          width={selection.width * CELL_PX}
          height={selection.height * CELL_PX}
          fill="var(--accent)"
          opacity={hovering ? 0.5 : 0.35}
          stroke="var(--accent)"
        />
      )}
    </svg>
  );
}

function CommissionPanel({ selection, onClear }: { selection: Selection; onClear: () => void }) {
  const queryClient = useQueryClient();
  const { data: zones } = useZones();
  const { data: allCompanies } = useAllCompanies();
  const [zoneType, setZoneType] = useState<ZoneTypeId>("industrial");
  const [constructionCompanyId, setConstructionCompanyId] = useState("");
  const [treasuryCost, setTreasuryCost] = useState(ZONE_TYPES.industrial.suggestedTreasuryCost);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const constructionCompanies = (allCompanies?.companies ?? []).filter((c) => c.industry === "construction");
  const catalogEntry = zones?.zones.find((z) => z.id === zoneType);
  const area = selection.width * selection.height;
  const grantedSlots = Math.floor(area / CELLS_PER_ZONE_SLOT);

  const commission = useMutation({
    mutationFn: () =>
      api.commissionZone(constructionCompanyId, zoneType, treasuryCost, {
        zoneX: selection.x,
        zoneY: selection.y,
        zoneWidth: selection.width,
        zoneHeight: selection.height,
      }),
    onSuccess: (res) => {
      setError(null);
      setMessage(res.pending ? "Commission sent — awaiting the construction company's acceptance." : "Commissioned — zone under construction.");
      queryClient.invalidateQueries({ queryKey: ["worldMap"] });
      queryClient.invalidateQueries({ queryKey: ["zones"] });
      queryClient.invalidateQueries({ queryKey: ["myZoneProjects"] });
      queryClient.invalidateQueries({ queryKey: ["government"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Commission failed"),
  });

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2 className="card__title">Commission This Rectangle</h2>
      {error && <div className="auth-error">{error}</div>}
      {message && !error && <div className="suggestion">{message}</div>}
      <p className="suggestion" style={{ marginTop: 0 }}>
        {selection.width}×{selection.height} cells ({area} total) — grants {grantedSlots} founding slot{grantedSlots === 1 ? "" : "s"} once built.
      </p>
      <div className="trade-row" style={{ flexWrap: "wrap" }}>
        <select
          value={zoneType}
          onChange={(e) => {
            const next = e.target.value as ZoneTypeId;
            setZoneType(next);
            setTreasuryCost(ZONE_TYPES[next].suggestedTreasuryCost);
          }}
        >
          {ZONE_TYPE_IDS.map((id) => (
            <option key={id} value={id}>
              {ZONE_TYPES[id].name}
            </option>
          ))}
        </select>
        <select value={constructionCompanyId} onChange={(e) => setConstructionCompanyId(e.target.value)}>
          <option value="">Construction company...</option>
          {constructionCompanies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} {c.isPlayerOwned ? "" : "(NPC/other player)"}
            </option>
          ))}
        </select>
        <label className="suggestion" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          Treasury offer
          <input
            type="number"
            min={0}
            step={5}
            value={treasuryCost}
            onChange={(e) => setTreasuryCost(Math.max(0, Number(e.target.value) || 0))}
            style={{ width: 90 }}
          />
          g
        </label>
      </div>
      <p className="suggestion">
        Suggested treasury payment for a typical {catalogEntry?.name ?? ZONE_TYPES[zoneType].name} is{" "}
        {catalogEntry?.suggestedTreasuryCost ?? ZONE_TYPES[zoneType].suggestedTreasuryCost}g — edit above to propose differently.
      </p>
      <div className="trade-row">
        <button
          className="btn btn--accent"
          disabled={!constructionCompanyId || treasuryCost <= 0 || commission.isPending}
          onClick={() => commission.mutate()}
        >
          Commission
        </button>
        <button className="btn" onClick={onClear}>
          Clear selection
        </button>
      </div>
    </div>
  );
}

export default function MapPage() {
  const { data } = useWorldMap();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [zoneToolActive, setZoneToolActive] = useState(false);
  const [zoomLabel, setZoomLabel] = useState(`${ZOOM_HOME.toFixed(1)}×`);
  // The settlement whose island detail view is entering/active, and a
  // separate visibility flag driving the CSS opacity crossfade — kept apart
  // from `detailSettlement` itself so exiting can fade out *then* unmount
  // (see exitDetailMode) instead of vanishing the instant zoom crosses back
  // under the trigger.
  const [detailSettlement, setDetailSettlement] = useState<WorldMapSettlement | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);

  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const detailWorldRef = useRef<HTMLDivElement>(null);
  const markerLayerRef = useRef<HTMLDivElement>(null);
  const plotLayerRef = useRef<SVGSVGElement | null>(null);
  const zoomRef = useRef(ZOOM_HOME);
  const panRef = useRef({ x: 0, y: 0 });
  // Detail mode's own, independent pan/zoom ref-pair — world-mode's panRef/
  // zoomRef are never touched while detail mode is active, so leaving it is
  // just "resume reading the ref-pair that was never modified," not a
  // literal restore-from-snapshot.
  const detailZoomRef = useRef(DETAIL_TRIGGER_ZOOM);
  const detailPanRef = useRef({ x: 0, y: 0 });
  const detailActiveRef = useRef(false);
  const exitTimeoutRef = useRef<number | null>(null);
  const boundsRef = useRef({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  const draggingRef = useRef(false);
  const lastPointRef = useRef({ x: 0, y: 0 });
  const hasCenteredRef = useRef(false);
  // Mirrors `data` for the wheel handler, whose effect only re-registers on
  // [!!data] (see below) — without this, the handler's closure would keep
  // reading whatever settlement roster existed the moment loading finished.
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    return () => {
      if (exitTimeoutRef.current !== null) window.clearTimeout(exitTimeoutRef.current);
    };
  }, []);

  const mine = useMemo(() => data?.settlements.find((s) => s.isMine) ?? null, [data]);

  const applyTransform = () => {
    const viewport = viewportRef.current;
    const world = worldRef.current;
    if (!viewport || !world) return;
    const zoom = zoomRef.current;
    const b = boundsRef.current;
    const contentW = (b.maxX - b.minX) * zoom;
    const contentH = (b.maxY - b.minY) * zoom;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;

    let panX = panRef.current.x;
    let panY = panRef.current.y;
    if (contentW <= vw) {
      panX = (vw - (b.minX + b.maxX) * zoom) / 2;
    } else {
      panX = clamp(panX, vw - b.maxX * zoom, -b.minX * zoom);
    }
    if (contentH <= vh) {
      panY = (vh - (b.minY + b.maxY) * zoom) / 2;
    } else {
      panY = clamp(panY, vh - b.maxY * zoom, -b.minY * zoom);
    }
    panRef.current = { x: panX, y: panY };
    world.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;

    const gridOpacity = clamp((zoom - GRID_FADE_LO) / (GRID_FADE_HI - GRID_FADE_LO), 0, 1);
    const markerOpacity = 1 - clamp((zoom - MARKER_FADE_LO) / (MARKER_FADE_HI - MARKER_FADE_LO), 0, 1);
    if (markerLayerRef.current) markerLayerRef.current.style.opacity = String(markerOpacity);
    if (plotLayerRef.current) plotLayerRef.current.style.opacity = String(gridOpacity);
    setZoomLabel(`${zoom.toFixed(zoom < 2 ? 1 : 0)}×`);
  };

  const applyDetailTransform = () => {
    const world = detailWorldRef.current;
    if (!world) return;
    const zoom = detailZoomRef.current;
    world.style.transform = `translate(${detailPanRef.current.x}px, ${detailPanRef.current.y}px) scale(${zoom})`;
    setZoomLabel(`${zoom.toFixed(0)}×`);
  };

  const detailZoomToImpl = (newZoom: number, clientX: number, clientY: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const zoom = detailZoomRef.current;
    const worldX = (px - detailPanRef.current.x) / zoom;
    const worldY = (py - detailPanRef.current.y) / zoom;
    detailZoomRef.current = clamp(newZoom, DETAIL_TRIGGER_ZOOM, ZOOM_MAX_DETAIL);
    detailPanRef.current = { x: px - worldX * detailZoomRef.current, y: py - worldY * detailZoomRef.current };
    applyDetailTransform();
  };

  // Fades the detail view in over the mounted island (see the JSX below —
  // the world-mode div fades out in lockstep via its own opacity, both
  // driven by `detailVisible`), framed on the target island at the trigger
  // zoom level. World-mode's own pan/zoom ref-pair is left completely
  // untouched here — see the ref comments above.
  const enterDetailMode = (settlement: WorldMapSettlement) => {
    if (exitTimeoutRef.current !== null) {
      window.clearTimeout(exitTimeoutRef.current);
      exitTimeoutRef.current = null;
    }
    const viewport = viewportRef.current;
    const center = islandCenterFor(settlement.worldCol, settlement.worldRow);
    detailZoomRef.current = DETAIL_TRIGGER_ZOOM;
    if (viewport) {
      detailPanRef.current = {
        x: viewport.clientWidth / 2 - center.x * DISPLAY_SCALE * DETAIL_TRIGGER_ZOOM,
        y: viewport.clientHeight / 2 - center.y * DISPLAY_SCALE * DETAIL_TRIGGER_ZOOM,
      };
    }
    setDetailSettlement(settlement);
  };

  const exitDetailMode = () => {
    setDetailVisible(false);
    // World-mode's own zoomRef/panRef were never touched while detail mode
    // was active, so they're still correct — but the zoom readout (shared
    // state between both modes) was last written by applyDetailTransform,
    // so it needs one more refresh back to the world-mode value once the
    // fade-out finishes and world-mode becomes interactive again.
    exitTimeoutRef.current = window.setTimeout(() => {
      setDetailSettlement(null);
      exitTimeoutRef.current = null;
      applyTransform();
    }, DETAIL_TRANSITION_MS);
  };

  // The single entry point for every zoom gesture (wheel + the +/- buttons),
  // in both modes. Branches on detailActiveRef rather than taking a mode
  // argument so callers don't need to know which mode is active — they just
  // ask for an absolute zoom level focused at a screen point, same as
  // before Phase B existed.
  const zoomTo = (newZoom: number, clientX: number, clientY: number) => {
    if (detailActiveRef.current) {
      if (newZoom < DETAIL_TRIGGER_ZOOM) {
        exitDetailMode();
        return;
      }
      detailZoomToImpl(newZoom, clientX, clientY);
      return;
    }

    if (newZoom >= DETAIL_TRIGGER_ZOOM && zoomRef.current < DETAIL_TRIGGER_ZOOM) {
      const viewport = viewportRef.current;
      const target = viewport
        ? nearestSettlementAtViewportCenter(dataRef.current?.settlements ?? [], viewport, panRef.current, zoomRef.current)
        : null;
      if (target) {
        enterDetailMode(target);
        return;
      }
    }

    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const zoom = zoomRef.current;
    const worldX = (px - panRef.current.x) / zoom;
    const worldY = (py - panRef.current.y) / zoom;
    zoomRef.current = clamp(newZoom, ZOOM_MIN, ZOOM_MAX_DETAIL);
    panRef.current = { x: px - worldX * zoomRef.current, y: py - worldY * zoomRef.current };
    applyTransform();
  };

  const centerOnMine = (atZoom: number) => {
    const viewport = viewportRef.current;
    if (!viewport || !mine) return;
    const centerPx = islandCenterPx(mine.worldCol, mine.worldRow);
    zoomRef.current = clamp(atZoom, ZOOM_MIN, ZOOM_MAX_DETAIL);
    panRef.current = {
      x: viewport.clientWidth / 2 - centerPx.x * zoomRef.current,
      y: viewport.clientHeight / 2 - centerPx.y * zoomRef.current,
    };
    applyTransform();
  };

  // Compute the content bounding box whenever the settlement roster changes
  // (so panning stays clamped correctly as new nations appear), but only
  // frame the camera on the player's own island once, on first load — not
  // every time polling picks up someone else founding a settlement.
  useEffect(() => {
    if (!data || data.settlements.length === 0) return;
    const worldBounds = computeWorldBounds(data.settlements);
    boundsRef.current = {
      minX: worldBounds.minX * DISPLAY_SCALE,
      minY: worldBounds.minY * DISPLAY_SCALE,
      maxX: worldBounds.maxX * DISPLAY_SCALE,
      maxY: worldBounds.maxY * DISPLAY_SCALE,
    };

    if (!hasCenteredRef.current) {
      hasCenteredRef.current = true;
      if (mine) {
        centerOnMine(ZOOM_HOME);
        return;
      }
      const s = data.settlements[0];
      const centerPx = islandCenterPx(s.worldCol, s.worldRow);
      const viewport = viewportRef.current;
      if (viewport) {
        zoomRef.current = ZOOM_HOME;
        panRef.current = {
          x: viewport.clientWidth / 2 - centerPx.x * ZOOM_HOME,
          y: viewport.clientHeight / 2 - centerPx.y * ZOOM_HOME,
        };
      }
    }
    applyTransform();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.settlements.length]);

  useEffect(() => {
    const onResize = () => {
      applyTransform();
      if (detailActiveRef.current) applyDetailTransform();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Mirrors detailSettlement into a ref (for the wheel handler's closure,
  // same reasoning as dataRef above) and drives the mount/entry transform +
  // the fade-in half of the crossfade — applying the transform synchronously
  // before flipping opacity means the detail view never visibly "jumps" once
  // the fade starts.
  useEffect(() => {
    detailActiveRef.current = detailSettlement !== null;
    if (!detailSettlement) {
      setDetailVisible(false);
      return;
    }
    applyDetailTransform();
    const id = requestAnimationFrame(() => setDetailVisible(true));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailSettlement]);

  // React's onWheel prop is bound passively, so preventDefault() inside it
  // silently no-ops (the page scrolls along with the zoom). A native
  // listener with { passive: false } is required to actually stop that.
  // Depends on `data` (not []): the viewport div doesn't exist yet on the
  // first render while the map is still loading, so viewportRef.current is
  // null until data arrives and the real tree mounts — the effect needs to
  // re-run at that point to actually attach the listener.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0016);
      const base = detailActiveRef.current ? detailZoomRef.current : zoomRef.current;
      zoomTo(base * factor, e.clientX, e.clientY);
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!data]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (zoneToolActive) return; // zoning drags are handled by MyPlotOverlay; elsewhere, do nothing while the tool is active
    draggingRef.current = true;
    lastPointRef.current = { x: e.clientX, y: e.clientY };
    viewportRef.current?.classList.add("map-viewport--dragging");
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const dx = e.clientX - lastPointRef.current.x;
    const dy = e.clientY - lastPointRef.current.y;
    lastPointRef.current = { x: e.clientX, y: e.clientY };
    if (detailSettlement) {
      detailPanRef.current = { x: detailPanRef.current.x + dx, y: detailPanRef.current.y + dy };
      applyDetailTransform();
    } else {
      panRef.current = { x: panRef.current.x + dx, y: panRef.current.y + dy };
      applyTransform();
    }
  };

  const endDrag = () => {
    draggingRef.current = false;
    viewportRef.current?.classList.remove("map-viewport--dragging");
  };

  const zoomAtViewportCenter = (factor: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const base = detailSettlement ? detailZoomRef.current : zoomRef.current;
    zoomTo(base * factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  const backToWorldMap = () => {
    if (detailSettlement) exitDetailMode();
  };

  if (!data) {
    return (
      <div className="page page--full">
        <div className="loading">Loading map...</div>
      </div>
    );
  }

  return (
    <div className="page page--full">
      <div className="card">
        <div className="trade-row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <h2 className="card__title" style={{ margin: 0 }}>
            World Map
          </h2>
          <div className="trade-row">
            <button className="btn" onClick={() => zoomAtViewportCenter(1 / 1.5)}>
              −
            </button>
            <button className="btn" onClick={() => zoomAtViewportCenter(1.5)}>
              +
            </button>
            <button
              className="btn"
              onClick={() => {
                if (detailSettlement) exitDetailMode();
                if (mine) centerOnMine(ZOOM_HOME);
              }}
              disabled={!mine}
            >
              My Island
            </button>
            <button
              className={zoneToolActive ? "btn btn--accent" : "btn"}
              onClick={() => setZoneToolActive((v) => !v)}
              disabled={!mine || !!detailSettlement}
              title={mine ? "Drag on your own island to select a zone" : "Found a settlement first"}
            >
              Zone Tool
            </button>
            {detailSettlement && (
              <button className="btn btn--accent" onClick={backToWorldMap}>
                ← Back to World Map
              </button>
            )}
          </div>
        </div>
        <p className="suggestion" style={{ marginTop: 0 }}>
          {detailSettlement
            ? `Viewing ${detailSettlement.name}. Scroll out or use "Back to World Map" to return.`
            : `Scroll to zoom, drag to pan. ${mine ? "Toggle Zone Tool, then drag directly on your island to select and commission a zone. Keep zooming in on any island to see it up close." : "Found a settlement to start zoning."}`}
        </p>
        <div
          ref={viewportRef}
          className="map-viewport"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
        >
          <div
            ref={worldRef}
            className="map-world"
            style={{ opacity: detailSettlement ? 0 : 1, pointerEvents: detailSettlement ? "none" : "auto" }}
          >
            <WorldTerrainCanvas settlements={data.settlements} bounds={computeWorldBounds(data.settlements)} />
            {mine && (
              <MyPlotOverlay
                settlement={mine}
                zones={data.myZones}
                zoneToolActive={zoneToolActive}
                zoomRef={zoomRef}
                plotLayerRef={plotLayerRef}
                selection={selection}
                onSelectionChange={setSelection}
                onSelectionDone={setSelection}
              />
            )}
            <div ref={markerLayerRef} style={{ position: "absolute", inset: 0 }}>
              {data.settlements.map((s) => (
                <IslandMarker key={s.id} settlement={s} />
              ))}
            </div>
          </div>
          {detailSettlement && (
            <div
              ref={detailWorldRef}
              className="map-world"
              style={{ opacity: detailVisible ? 1 : 0, pointerEvents: detailVisible ? "auto" : "none" }}
            >
              <IslandDetailLayer settlements={data.settlements} target={detailSettlement} />
            </div>
          )}
          <div className="map-zoom-readout">{zoomLabel}</div>
        </div>
      </div>

      {selection && <CommissionPanel selection={selection} onClear={() => setSelection(null)} />}
    </div>
  );
}
