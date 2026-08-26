import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
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
  elevationAtWorld,
  islandCenterFor,
  islandProfileFor,
  rampColor,
  type WorldSlot,
  type ZoneTypeId,
} from "@dominion/shared";
import { api, ApiError, type WorldMapSettlement, type ZoneRect } from "../api/client.js";
import { useAllCompanies, useWorldMap, useZones } from "../api/hooks.js";

// ---- client-only rendering constants — spatial layout, not game data -----
const DISPLAY_SCALE = 0.8; // CSS px per world-unit at zoom = 1
const SAMPLE_STEP = 6; // world-units per terrain sample, upscaled via canvas smoothing
const RENDER_MARGIN = 550; // world-units of ocean padding kept around every island's own extent
const PLOT_WORLD_SIZE = ISLAND_BASE_RADIUS * 1.1; // the buildable square, inscribed in the island
const CELL_WORLD_SIZE = PLOT_WORLD_SIZE / PLOT_ZONING_SIZE;
const CELL_PX = CELL_WORLD_SIZE * DISPLAY_SCALE;

const ZOOM_MIN = 0.35;
const ZOOM_MAX = 14;
const ZOOM_HOME = 1.8;
const GRID_FADE_LO = 1.1;
const GRID_FADE_HI = 2.6;
const MARKER_FADE_LO = 2.4;
const MARKER_FADE_HI = 4.8;
const GRAIN_SEED = WORLD_TERRAIN_SEED + 3333;

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

// Bakes the whole visible archipelago as ONE continuous terrain field —
// deliberately not one canvas tile per island. Sampling in a single
// world-space coordinate system (elevationAtWorld) is what keeps ocean and
// coastlines seamless: independently-baked per-island tiles each had their
// own isolated noise field, so the seawater between two tiles never
// actually matched up at the boundary.
function bakeWorldTerrain(canvas: HTMLCanvasElement, settlements: WorldMapSettlement[], bounds: WorldBounds) {
  const claimed = new ClaimedGrid(settlements);
  const worldW = bounds.maxX - bounds.minX;
  const worldH = bounds.maxY - bounds.minY;
  const sampleCols = Math.max(1, Math.round(worldW / SAMPLE_STEP));
  const sampleRows = Math.max(1, Math.round(worldH / SAMPLE_STEP));
  const n = sampleCols * sampleRows;

  const elevation = new Float32Array(n);
  const tints: Array<[number, number, number] | null> = new Array(n).fill(null);
  const candidateBuf: WorldSlot[] = [];

  for (let row = 0; row < sampleRows; row++) {
    const worldY = bounds.minY + row * SAMPLE_STEP;
    for (let col = 0; col < sampleCols; col++) {
      const worldX = bounds.minX + col * SAMPLE_STEP;

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
  const CONTOUR_STEP = 0.09;
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
      let shade = land ? clamp(1 + (dx * -lightX + dy * -lightY) * 4.4, 0.6, 1.42) : 1;
      if (land) {
        const m = e / CONTOUR_STEP;
        const frac = m - Math.floor(m);
        const distToLine = Math.min(frac, 1 - frac);
        if (distToLine < 0.04) shade *= 0.84;
      }
      // grain uses global sample indices (not per-tile-relative), so it
      // never resets/misaligns at a former tile boundary either
      const grain = 1 + (hash2D(col, row, GRAIN_SEED) - 0.5) * 0.04;

      const rgb = rampColor(e);
      let r = rgb[0];
      let g = rgb[1];
      let b = rgb[2];
      const tint = tints[idx];
      if (land && tint) {
        r = lerp(r, tint[0], 0.13);
        g = lerp(g, tint[1], 0.13);
        b = lerp(b, tint[2], 0.13);
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
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(sampleCanvas, 0, 0, sampleCols, sampleRows, 0, 0, displayW, displayH);
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

  return <canvas ref={canvasRef} style={{ position: "absolute", display: "block" }} />;
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

  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const markerLayerRef = useRef<HTMLDivElement>(null);
  const plotLayerRef = useRef<SVGSVGElement | null>(null);
  const zoomRef = useRef(ZOOM_HOME);
  const panRef = useRef({ x: 0, y: 0 });
  const boundsRef = useRef({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  const draggingRef = useRef(false);
  const lastPointRef = useRef({ x: 0, y: 0 });
  const hasCenteredRef = useRef(false);

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

  const zoomTo = (newZoom: number, clientX: number, clientY: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const zoom = zoomRef.current;
    const worldX = (px - panRef.current.x) / zoom;
    const worldY = (py - panRef.current.y) / zoom;
    zoomRef.current = clamp(newZoom, ZOOM_MIN, ZOOM_MAX);
    panRef.current = { x: px - worldX * zoomRef.current, y: py - worldY * zoomRef.current };
    applyTransform();
  };

  const centerOnMine = (atZoom: number) => {
    const viewport = viewportRef.current;
    if (!viewport || !mine) return;
    const centerPx = islandCenterPx(mine.worldCol, mine.worldRow);
    zoomRef.current = clamp(atZoom, ZOOM_MIN, ZOOM_MAX);
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
    const onResize = () => applyTransform();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

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
      zoomTo(zoomRef.current * factor, e.clientX, e.clientY);
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
    panRef.current = {
      x: panRef.current.x + (e.clientX - lastPointRef.current.x),
      y: panRef.current.y + (e.clientY - lastPointRef.current.y),
    };
    lastPointRef.current = { x: e.clientX, y: e.clientY };
    applyTransform();
  };

  const endDrag = () => {
    draggingRef.current = false;
    viewportRef.current?.classList.remove("map-viewport--dragging");
  };

  const zoomAtViewportCenter = (factor: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    zoomTo(zoomRef.current * factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
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
            <button className="btn" onClick={() => (mine ? centerOnMine(ZOOM_HOME) : undefined)} disabled={!mine}>
              My Island
            </button>
            <button
              className={zoneToolActive ? "btn btn--accent" : "btn"}
              onClick={() => setZoneToolActive((v) => !v)}
              disabled={!mine}
              title={mine ? "Drag on your own island to select a zone" : "Found a settlement first"}
            >
              Zone Tool
            </button>
          </div>
        </div>
        <p className="suggestion" style={{ marginTop: 0 }}>
          Scroll to zoom, drag to pan. {mine ? "Toggle Zone Tool, then drag directly on your island to select and commission a zone." : "Found a settlement to start zoning."}
        </p>
        <div
          ref={viewportRef}
          className="map-viewport"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
        >
          <div ref={worldRef} className="map-world">
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
          <div className="map-zoom-readout">{zoomLabel}</div>
        </div>
      </div>

      {selection && <CommissionPanel selection={selection} onClear={() => setSelection(null)} />}
    </div>
  );
}
