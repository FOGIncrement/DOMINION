import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  BIOME_COLORS,
  CELLS_PER_ZONE_SLOT,
  COMPANY_INDUSTRIES,
  PLOT_ZONING_SIZE,
  ZONE_TYPES,
  ZONE_TYPE_IDS,
  type BiomeId,
  type CompanyIndustryId,
  type ZoneTypeId,
} from "@dominion/shared";
import { api, ApiError, type MyCompany, type ZoneRect } from "../api/client.js";
import { useMyCompanies, useMyContracts, useMyTerritories, useMyTerritoryDetail, useWorldMap, useZones } from "../api/hooks.js";
import { CompanyAvatar, INDUSTRY_META } from "../industryMeta.js";
import { ContractsTab, LostControlOverview, OverviewTab, WorkforceTab } from "../components/CompanyDetailTabs.js";

// "My Territory" — repurposed 2026-09-03 from the old per-island world map
// (now fully superseded by Continent.tsx) into a close-up, native-resolution
// view of just the player's own land. Renders from the un-downsampled
// worldgen raster (GET /territory/mine/detail, cellSizeKm=1) instead of
// Continent.tsx's 4x-downsampled preview, so terrain features read as real
// terrain instead of coarse pixel blocks. Sprites for built companies are
// explicit future work — this ships the page, the high-res render, and the
// ported zone-shape drawing (this page's one genuinely unique feature over
// Continent.tsx and Government.tsx's simpler zone form).
const CANVAS_SCALE = 8; // display px per native (1km) cell at zoom=1 — 8x Continent.tsx's effective px/km
const ZOOM_MAX = 16;
const CENTER_ZOOM = 3;

// The zone-placement grid is an abstract PLOT_ZONING_SIZE x PLOT_ZONING_SIZE
// slot grid, same as it always was — not tied to real km/terrain geometry
// (a zone "cell" isn't a real-world area). Its on-screen SIZE, though, is
// computed per-render from the territory crop's own dimensions (see
// zoneGridSizePx below) rather than this fixed px-per-cell constant it used
// to be — a fixed 220px square (10 cells * 22px) was a tiny, easy-to-miss
// patch in the center of a much bigger territory crop (often 2000+ px wide
// at native resolution), which read as "zoning barely works on my land"
// rather than "zoning is an abstract capacity tool." PLOT_ZONING_SIZE (the
// cell COUNT, which is what founding-capacity math actually cares about,
// see CELLS_PER_ZONE_SLOT) is unchanged — only how large each cell renders.
const MIN_ZONE_GRID_PX = 300;
const ZONE_GRID_FRACTION = 0.7; // of the smaller crop dimension, at zoom=1

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function base64ToUint16(b64: string): Uint16Array {
  const bytes = base64ToUint8(b64);
  return new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
}

const ZONE_TYPE_COLORS: Record<ZoneTypeId, string> = {
  industrial: "#c17f3a",
  retail: "#2f8f8a",
};

interface Geometry {
  cols: number;
  rows: number;
  biomeIds: BiomeId[];
  biome: Uint8Array;
  seed: Uint16Array;
  noSeedSentinel: number;
}

function renderTerritory(ctx: CanvasRenderingContext2D, geometry: Geometry, mySeedIndexes: Set<number>, accentRgb: [number, number, number]) {
  const { cols, rows, biome, seed, biomeIds, noSeedSentinel } = geometry;
  const image = ctx.createImageData(cols, rows);
  const data = image.data;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col;
      const biomeId = biomeIds[biome[idx]] as BiomeId;
      let [r, g, b] = BIOME_COLORS[biomeId] ?? [90, 90, 90];

      const s = seed[idx];
      const isMine = s !== noSeedSentinel && mySeedIndexes.has(s);
      const p = idx * 4;
      if (isMine) {
        data[p] = r * 0.7 + accentRgb[0] * 0.3;
        data[p + 1] = g * 0.7 + accentRgb[1] * 0.3;
        data[p + 2] = b * 0.7 + accentRgb[2] * 0.3;
        data[p + 3] = 255;
      } else {
        // Fully transparent, not dimmed — an exact cutout of the player's
        // own border shape against the page background, "as if nothing else
        // around exists," rather than a continent view with everything else
        // faded. The crop's margin (see loadedTerritoryCrop.ts) still frames
        // the shape with breathing room; those margin cells just render
        // invisible now instead of as dimmed context.
        data[p] = 0;
        data[p + 1] = 0;
        data[p + 2] = 0;
        data[p + 3] = 0;
      }
    }
  }
  ctx.putImageData(image, 0, 0);
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.trim().replace("#", "");
  const n = parseInt(clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
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

export interface TerritoryCanvasHandle {
  zoomBy: (factor: number) => void;
  centerOnZoneGrid: () => void;
}

// A company placed via the Founding Grid — just enough to render a marker
// and to tell an empty cell from an occupied one on click.
export interface PlacedCompanyMarker {
  id: string;
  zoneId: string;
  cellX: number;
  cellY: number;
  industry: CompanyIndustryId;
  name: string;
}

// What clicking a cell means, when the zone tool (drag-to-draw-a-zone) is
// off — the two Founding Grid entry points: an empty cell inside a
// completed zone opens the founding drawer, an occupied one opens the
// split management panel. Clicking outside any zone, or inside one that's
// still building/pending, does nothing.
export type CellClickResult =
  | { mode: "found"; zoneId: string; zoneType: ZoneTypeId; x: number; y: number }
  | { mode: "manage"; companyId: string };

const TerritoryCanvas = forwardRef<
  TerritoryCanvasHandle,
  {
    geometry: Geometry;
    mySeedIndexes: Set<number>;
    zones: ZoneRect[];
    placedCompanies: PlacedCompanyMarker[];
    zoneToolActive: boolean;
    selection: Selection | null;
    onSelectionChange: (s: Selection | null) => void;
    onSelectionDone: (s: Selection) => void;
    onCellClick: (result: CellClickResult) => void;
  }
>(function TerritoryCanvas(
  { geometry, mySeedIndexes, zones, placedCompanies, zoneToolActive, selection, onSelectionChange, onSelectionDone, onCellClick },
  ref,
) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const minZoomRef = useRef(0.2);
  const draggingRef = useRef(false);
  const lastPointRef = useRef({ x: 0, y: 0 });
  const zoneDragStart = useRef<{ x: number; y: number } | null>(null);
  const [zoomLabel, setZoomLabel] = useState("1.0×");

  const nativeW = geometry.cols * CANVAS_SCALE;
  const nativeH = geometry.rows * CANVAS_SCALE;
  // The zone grid is anchored at the center of the rendered crop — an
  // abstract overlay, not a real geographic placement — but sized as a
  // fraction of the crop itself so it reads as spanning "your land," not a
  // small fixed patch lost in the middle of it (see the module comment
  // above MIN_ZONE_GRID_PX).
  const zoneGridSizePx = Math.max(MIN_ZONE_GRID_PX, Math.min(nativeW, nativeH) * ZONE_GRID_FRACTION);
  const zoneCellPx = zoneGridSizePx / PLOT_ZONING_SIZE;
  const zoneGridLeft = nativeW / 2 - zoneGridSizePx / 2;
  const zoneGridTop = nativeH / 2 - zoneGridSizePx / 2;

  const applyTransform = () => {
    const viewport = viewportRef.current;
    const world = worldRef.current;
    if (!viewport || !world) return;
    const zoom = zoomRef.current;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const contentW = nativeW * zoom;
    const contentH = nativeH * zoom;

    let panX = panRef.current.x;
    let panY = panRef.current.y;
    if (contentW <= vw) panX = (vw - contentW) / 2;
    else panX = clamp(panX, vw - contentW, 0);
    if (contentH <= vh) panY = (vh - contentH) / 2;
    else panY = clamp(panY, vh - contentH, 0);
    panRef.current = { x: panX, y: panY };

    world.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    setZoomLabel(`${zoom.toFixed(1)}×`);
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
    zoomRef.current = clamp(newZoom, minZoomRef.current, ZOOM_MAX);
    panRef.current = { x: px - worldX * zoomRef.current, y: py - worldY * zoomRef.current };
    applyTransform();
  };

  useImperativeHandle(
    ref,
    () => ({
      zoomBy: (factor: number) => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        const rect = viewport.getBoundingClientRect();
        zoomTo(zoomRef.current * factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
      },
      centerOnZoneGrid: () => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        zoomRef.current = clamp(CENTER_ZOOM, minZoomRef.current, ZOOM_MAX);
        panRef.current = {
          x: viewport.clientWidth / 2 - (zoneGridLeft + zoneGridSizePx / 2) * zoomRef.current,
          y: viewport.clientHeight / 2 - (zoneGridTop + zoneGridSizePx / 2) * zoomRef.current,
        };
        applyTransform();
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geometry, zoneGridLeft, zoneGridTop],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const accentHex = getComputedStyle(document.documentElement).getPropertyValue("--accent") || "#45d1a8";
    const accent = hexToRgb(accentHex);

    const offscreen = document.createElement("canvas");
    offscreen.width = geometry.cols;
    offscreen.height = geometry.rows;
    const offCtx = offscreen.getContext("2d")!;
    renderTerritory(offCtx, geometry, mySeedIndexes, accent);

    canvas.width = nativeW;
    canvas.height = nativeH;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offscreen, 0, 0, geometry.cols, geometry.rows, 0, 0, nativeW, nativeH);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry, mySeedIndexes, nativeW, nativeH]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const fitZoom = Math.min(viewport.clientWidth / nativeW, viewport.clientHeight / nativeH, 1);
    minZoomRef.current = Math.min(1, Math.max(0.05, fitZoom));
    // Default view fits the whole cropped shape (island + dark-void margin)
    // in frame, not zoomed into the zone grid — the point of this page is
    // to read as "your territory, cut out, at a glance" on first load. The
    // zone grid still gets its own dedicated zoom via the "Center on Zone
    // Grid" button (see centerOnZoneGrid below) for when a player actually
    // wants to draw a zone.
    zoomRef.current = clamp(fitZoom, minZoomRef.current, ZOOM_MAX);
    panRef.current = {
      x: (viewport.clientWidth - nativeW * zoomRef.current) / 2,
      y: (viewport.clientHeight - nativeH * zoomRef.current) / 2,
    };
    applyTransform();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeW, nativeH]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    // A ResizeObserver on the viewport itself, not just a window resize
    // listener — the Founding Grid's split management panel opening/
    // closing resizes .map-viewport via CSS flex with no window resize
    // event firing at all, which would otherwise leave pan/zoom stale
    // (clipped content, an un-reclamped pan) the moment the panel mounts.
    const observer = new ResizeObserver(() => applyTransform());
    observer.observe(viewport);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (zoneToolActive) return; // zoning drags are handled by the SVG overlay below
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
    panRef.current = { x: panRef.current.x + dx, y: panRef.current.y + dy };
    applyTransform();
  };

  const endDrag = () => {
    draggingRef.current = false;
    viewportRef.current?.classList.remove("map-viewport--dragging");
  };

  const isBlocked = (cell: { x: number; y: number }) =>
    zones.some((z) => cell.x >= z.x && cell.x < z.x + z.width && cell.y >= z.y && cell.y < z.y + z.height);

  const pointToZoneCell = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const zoom = zoomRef.current || 1;
    const x = clampCell((e.clientX - rect.left) / zoom / zoneCellPx, PLOT_ZONING_SIZE);
    const y = clampCell((e.clientY - rect.top) / zoom / zoneCellPx, PLOT_ZONING_SIZE);
    return { x, y };
  };

  const handleZonePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!zoneToolActive) return;
    const cell = pointToZoneCell(e);
    if (!cell || isBlocked(cell)) return;
    e.stopPropagation();
    zoneDragStart.current = cell;
    onSelectionChange({ x: cell.x, y: cell.y, width: 1, height: 1 });
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const handleZonePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!zoneDragStart.current) return;
    e.stopPropagation();
    const cell = pointToZoneCell(e);
    if (!cell) return;
    onSelectionChange(normalizeRect(zoneDragStart.current, cell));
  };

  const handleZonePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!zoneDragStart.current) return;
    e.stopPropagation();
    zoneDragStart.current = null;
    if (!selection) return;
    if (zones.some((z) => rectsOverlap(z, selection))) {
      onSelectionChange(null);
      return;
    }
    onSelectionDone(selection);
  };

  // Founding Grid — active whenever the zone tool (drag-to-draw) is off.
  // Simple click, not a drag: find which zone the clicked cell falls in
  // (zones don't overlap by construction), then whether that cell is
  // already occupied.
  const handleCellPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const cell = pointToZoneCell(e);
    if (!cell) return;
    const zone = zones.find((z) => cell.x >= z.x && cell.x < z.x + z.width && cell.y >= z.y && cell.y < z.y + z.height);
    if (!zone || zone.status !== "completed" || !zone.id) return;
    const occupant = placedCompanies.find((c) => c.zoneId === zone.id && c.cellX === cell.x && c.cellY === cell.y);
    onCellClick(
      occupant
        ? { mode: "manage", companyId: occupant.id }
        : { mode: "found", zoneId: zone.id, zoneType: zone.zoneType as ZoneTypeId, x: cell.x, y: cell.y },
    );
  };

  return (
    <div
      ref={viewportRef}
      className="map-viewport"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
    >
      <div ref={worldRef} style={{ position: "absolute", top: 0, left: 0, transformOrigin: "0 0" }}>
        <canvas ref={canvasRef} className="map-terrain-canvas" style={{ position: "absolute", top: 0, left: 0 }} />
        <svg
          ref={svgRef}
          width={zoneGridSizePx}
          height={zoneGridSizePx}
          style={{
            position: "absolute",
            left: zoneGridLeft,
            top: zoneGridTop,
            touchAction: "none",
            cursor: zoneToolActive ? "crosshair" : "pointer",
            pointerEvents: "auto",
          }}
          onPointerDown={zoneToolActive ? handleZonePointerDown : undefined}
          onPointerMove={zoneToolActive ? handleZonePointerMove : undefined}
          onPointerUp={zoneToolActive ? handleZonePointerUp : handleCellPointerUp}
        >
          <rect width={zoneGridSizePx} height={zoneGridSizePx} fill="rgba(0,0,0,0.15)" stroke="var(--accent)" strokeWidth={2} strokeOpacity={0.7} />
          {Array.from({ length: PLOT_ZONING_SIZE + 1 }).map((_, i) => (
            <g key={`grid-${i}`}>
              <line x1={i * zoneCellPx} y1={0} x2={i * zoneCellPx} y2={zoneGridSizePx} stroke="rgba(255,255,255,0.18)" />
              <line x1={0} y1={i * zoneCellPx} x2={zoneGridSizePx} y2={i * zoneCellPx} stroke="rgba(255,255,255,0.18)" />
            </g>
          ))}
          {zones.map((z, i) => (
            <rect
              key={i}
              x={z.x * zoneCellPx}
              y={z.y * zoneCellPx}
              width={z.width * zoneCellPx}
              height={z.height * zoneCellPx}
              fill={ZONE_TYPE_COLORS[z.zoneType as ZoneTypeId] ?? "var(--text-muted)"}
              opacity={z.status === "completed" ? 0.85 : 0.55}
            >
              <title>
                {ZONE_TYPES[z.zoneType as ZoneTypeId]?.name ?? z.zoneType} — {z.status}
              </title>
            </rect>
          ))}
          {placedCompanies.map((c) => {
            const meta = INDUSTRY_META[c.industry];
            const cx = c.cellX * zoneCellPx;
            const cy = c.cellY * zoneCellPx;
            return (
              <g key={c.id}>
                <rect x={cx + 1} y={cy + 1} width={zoneCellPx - 2} height={zoneCellPx - 2} fill={meta.color} rx={2}>
                  <title>{c.name}</title>
                </rect>
                <text
                  x={cx + zoneCellPx / 2}
                  y={cy + zoneCellPx / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={Math.min(11, zoneCellPx * 0.32)}
                  fontWeight={700}
                  fill="var(--surface-0)"
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >
                  {meta.letter}
                </text>
              </g>
            );
          })}
          {selection && (
            <rect
              x={selection.x * zoneCellPx}
              y={selection.y * zoneCellPx}
              width={selection.width * zoneCellPx}
              height={selection.height * zoneCellPx}
              fill="var(--accent)"
              opacity={0.4}
              stroke="var(--accent)"
            />
          )}
        </svg>
      </div>
      <div className="map-zoom-readout">{zoomLabel}</div>
    </div>
  );
});

function CommissionPanel({ selection, onClear }: { selection: Selection; onClear: () => void }) {
  const queryClient = useQueryClient();
  const { data: zones } = useZones();
  const [zoneType, setZoneType] = useState<ZoneTypeId>("industrial");
  const [treasuryCost, setTreasuryCost] = useState(ZONE_TYPES.industrial.suggestedTreasuryCost);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const catalogEntry = zones?.zones.find((z) => z.id === zoneType);
  const area = selection.width * selection.height;
  const grantedSlots = Math.floor(area / CELLS_PER_ZONE_SLOT);

  // Pay the treasury cost, done — no construction company, no accept/cancel
  // negotiation.
  const commission = useMutation({
    mutationFn: () =>
      api.commissionZone(zoneType, treasuryCost, {
        zoneX: selection.x,
        zoneY: selection.y,
        zoneWidth: selection.width,
        zoneHeight: selection.height,
      }),
    onSuccess: () => {
      setError(null);
      setMessage("Commissioned — zone under construction.");
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
        <label className="suggestion" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          Treasury cost
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
          disabled={treasuryCost <= 0 || commission.isPending}
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

// Founding Grid — founding. Slides up from the bottom of the map viewport
// (the first drawer pattern in this codebase; everything else spatial is
// either inline or a full-backdrop .modal). Two steps: pick an industry
// (filtered to what the zone's own type allows), then name + seed money.
// Closes on success — the player clicks the now-filled cell again to
// manage it, per the approved flow; this does not auto-transition into
// the split panel.
function CellFoundingDrawer({
  zoneId,
  zoneType,
  x,
  y,
  onClose,
  onFounded,
}: {
  zoneId: string;
  zoneType: ZoneTypeId;
  x: number;
  y: number;
  onClose: () => void;
  onFounded: () => void;
}) {
  const queryClient = useQueryClient();
  const validIndustries = ZONE_TYPES[zoneType].industries;
  const [industry, setIndustry] = useState<CompanyIndustryId | null>(null);
  const [name, setName] = useState("");
  const [seedMoney, setSeedMoney] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const found = useMutation({
    mutationFn: () => api.foundCompanyAtCell(zoneId, x, y, industry!, name, seedMoney),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["myCompanies"] });
      queryClient.invalidateQueries({ queryKey: ["gameState"] });
      queryClient.invalidateQueries({ queryKey: ["allCompanies"] });
      queryClient.invalidateQueries({ queryKey: ["worldMap"] });
      queryClient.invalidateQueries({ queryKey: ["zones"] });
      onFounded();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Founding failed"),
  });

  return (
    <div className="cell-drawer">
      <div className="cell-drawer__head">
        <span>{industry ? `Found ${ZONE_TYPES[zoneType].name} company` : "Pick a company for this square"}</span>
        <button className="cell-drawer__close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      {error && <div className="auth-error">{error}</div>}
      {!industry ? (
        <div className="cell-drawer__industries">
          {validIndustries.map((id) => {
            const meta = INDUSTRY_META[id];
            const def = COMPANY_INDUSTRIES[id];
            return (
              <button
                key={id}
                className="cell-drawer__industry"
                style={{ borderColor: meta.color }}
                onClick={() => {
                  setIndustry(id);
                  setName(`${def.name} #${x}-${y}`);
                }}
              >
                <span className="cc-avatar" style={{ background: meta.color }}>
                  {meta.letter}
                </span>
                <span>{def.name}</span>
                <span className="cell-drawer__industry-cost">{def.foundingCost}g</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="trade-row" style={{ flexWrap: "wrap" }}>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
          <label className="suggestion" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            Seed money
            <input
              type="number"
              min={0}
              step={10}
              value={seedMoney}
              onChange={(e) => setSeedMoney(Math.max(0, Number(e.target.value) || 0))}
              style={{ width: 90 }}
            />
          </label>
          <button className="btn" onClick={() => setIndustry(null)}>
            ← Back
          </button>
          <button className="btn btn--accent" disabled={found.isPending || name.trim().length < 2} onClick={() => found.mutate()}>
            Found
          </button>
        </div>
      )}
    </div>
  );
}

// Founding Grid — managing. A persistent panel next to the map (not a
// drawer) reusing the same tabbed detail view Companies.tsx's Command
// Center already uses, via the extracted CompanyDetailTabs components — a
// second entry point onto the exact same management UI, not a
// reimplementation of it.
function PlacedCompanyDetail({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const { data: mine } = useMyCompanies();
  const { data: myContracts } = useMyContracts();
  const [activeTab, setActiveTab] = useState<"overview" | "workforce" | "contracts">("overview");

  const company = (mine?.companies ?? []).find((c) => c.id === companyId);
  if (!company) return null;

  const jumpToCompanies = (id: string) => navigate("/companies", { state: { jumpToCompanyId: id } });

  const tabs: { key: "overview" | "workforce" | "contracts"; label: string }[] = [
    { key: "overview", label: "Overview" },
    ...(company.controlledByMe ? [{ key: "workforce" as const, label: "Workforce" }] : []),
    { key: "contracts", label: "Contracts" },
  ];

  return (
    <div className="founding-grid-shell__detail cc-detail">
      <div className="cc-detail__header">
        <div className="cc-detail__title-row">
          <CompanyAvatar industry={company.industry as CompanyIndustryId} size="lg" />
          <div>
            <div className="cc-detail__name">{company.name}</div>
            <div className="cc-detail__meta">
              {COMPANY_INDUSTRIES[company.industry as CompanyIndustryId].name} · Level {company.level}
            </div>
          </div>
        </div>
        <div className="trade-row">
          <span className={`cc-badge cc-badge--${company.controlledByMe ? "mine" : "other"}`}>
            {company.controlledByMe ? "Yours" : company.controllerLabel}
          </span>
          <button className="btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
      </div>
      <div className="cc-tabs">
        {tabs.map((t) => (
          <button key={t.key} className={`cc-tab${activeTab === t.key ? " cc-tab--active" : ""}`} onClick={() => setActiveTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {activeTab === "overview" &&
        (company.controlledByMe ? (
          <OverviewTab company={company} contracts={myContracts?.contracts ?? []} onGoToWorkforce={() => setActiveTab("workforce")} />
        ) : (
          <LostControlOverview company={company} />
        ))}
      {activeTab === "workforce" && company.controlledByMe && <WorkforceTab company={company} />}
      {activeTab === "contracts" && (
        <ContractsTab companyId={company.id} isMine onSelectCompany={jumpToCompanies} onProposeTo={jumpToCompanies} />
      )}
    </div>
  );
}

export default function MyTerritoryPage() {
  const { data: detail, isLoading, isError } = useMyTerritoryDetail();
  const { data: mine } = useMyTerritories();
  const { data: worldMap } = useWorldMap();
  const { data: myCompanies } = useMyCompanies();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [zoneToolActive, setZoneToolActive] = useState(false);
  // Founding Grid — mutually exclusive with each other and with the zone
  // tool: starting one clears the others, matching the approved flow
  // (founding via the drawer, managing via the split panel, never both at
  // once).
  const [foundingCell, setFoundingCell] = useState<{ zoneId: string; zoneType: ZoneTypeId; x: number; y: number } | null>(null);
  const [managingCompanyId, setManagingCompanyId] = useState<string | null>(null);
  const canvasHandleRef = useRef<TerritoryCanvasHandle>(null);

  const geometry = useMemo<Geometry | null>(() => {
    if (!detail) return null;
    return {
      cols: detail.cols,
      rows: detail.rows,
      biomeIds: detail.biomeIds as BiomeId[],
      biome: base64ToUint8(detail.biome),
      seed: base64ToUint16(detail.seed),
      noSeedSentinel: detail.noSeedSentinel,
    };
  }, [detail]);

  const mySeedIndexes = useMemo(() => new Set((mine?.territories ?? []).map((t) => t.seedIndex)), [mine]);
  const zones = worldMap?.myZones ?? [];
  const totalArea = (mine?.territories ?? []).reduce((sum, t) => sum + t.areaKm2, 0);
  const placedCompanies = useMemo(
    () =>
      (myCompanies?.companies ?? [])
        .filter((c): c is MyCompany & { zoneId: string; cellX: number; cellY: number } => c.zoneId !== null && c.cellX !== null && c.cellY !== null)
        .map((c) => ({ id: c.id, zoneId: c.zoneId, cellX: c.cellX, cellY: c.cellY, industry: c.industry as CompanyIndustryId, name: c.name })),
    [myCompanies],
  );

  const startZoneTool = () => {
    setZoneToolActive((v) => !v);
    setFoundingCell(null);
    setManagingCompanyId(null);
    setSelection(null);
  };

  if (isLoading || !geometry) {
    return (
      <div className="page page--full">
        <div className="loading">Loading your territory...</div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="page page--full">
        <div className="card">
          <h2 className="card__title">My Territory</h2>
          <div className="empty-state">You don't hold any territory yet — choose one on the Continent page first.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page page--full">
      <div className="card">
        <div className="trade-row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <h2 className="card__title" style={{ margin: 0 }}>
            My Territory
          </h2>
          <div className="trade-row">
            <button className="btn" onClick={() => canvasHandleRef.current?.zoomBy(1 / 1.5)}>
              −
            </button>
            <button className="btn" onClick={() => canvasHandleRef.current?.zoomBy(1.5)}>
              +
            </button>
            <button className="btn" onClick={() => canvasHandleRef.current?.centerOnZoneGrid()}>
              Center
            </button>
            <button
              className={zoneToolActive ? "btn btn--accent" : "btn"}
              onClick={startZoneTool}
              title="Drag inside the highlighted grid to select a zone"
            >
              Zone Tool
            </button>
          </div>
        </div>
        <p className="suggestion" style={{ marginTop: 0 }}>
          {mine?.territories.length ?? 0} territor{(mine?.territories.length ?? 0) === 1 ? "y" : "ies"} ·{" "}
          {Math.round(totalArea).toLocaleString()} km² total — rendered at native resolution, much higher detail than
          the Continent overview. Toggle Zone Tool to draw a new one, or click an empty square in a completed zone to
          found a company there — click a founded square to manage it.
        </p>
        <div className="founding-grid-shell">
          <div className="founding-grid-shell__map">
            <TerritoryCanvas
              ref={canvasHandleRef}
              geometry={geometry}
              mySeedIndexes={mySeedIndexes}
              zones={zones}
              placedCompanies={placedCompanies}
              zoneToolActive={zoneToolActive}
              selection={selection}
              onSelectionChange={setSelection}
              onSelectionDone={setSelection}
              onCellClick={(result) => {
                if (result.mode === "found") {
                  setFoundingCell({ zoneId: result.zoneId, zoneType: result.zoneType, x: result.x, y: result.y });
                  setManagingCompanyId(null);
                } else {
                  setManagingCompanyId(result.companyId);
                  setFoundingCell(null);
                }
              }}
            />
            {foundingCell && (
              <CellFoundingDrawer
                zoneId={foundingCell.zoneId}
                zoneType={foundingCell.zoneType}
                x={foundingCell.x}
                y={foundingCell.y}
                onClose={() => setFoundingCell(null)}
                onFounded={() => setFoundingCell(null)}
              />
            )}
          </div>
          {managingCompanyId && (
            <PlacedCompanyDetail companyId={managingCompanyId} onClose={() => setManagingCompanyId(null)} />
          )}
        </div>
      </div>

      {selection && <CommissionPanel selection={selection} onClear={() => setSelection(null)} />}
    </div>
  );
}
