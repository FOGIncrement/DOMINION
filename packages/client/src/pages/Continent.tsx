import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BIOME_COLORS,
  COMPANY_INDUSTRIES,
  COMPANY_INDUSTRY_IDS,
  TERRITORY_TUNING,
  type BiomeId,
  type CompanyIndustryId,
} from "@dominion/shared";
import { api, ApiError, type AttackResult, type TerritoryClaim } from "../api/client.js";
import {
  useGovernment,
  useMapPreview,
  useMyCompanies,
  useMyMilitary,
  useMyTerritories,
  useTerritoryClaims,
} from "../api/hooks.js";

// Display px per (already-downsampled, 4km-per-cell) preview cell, at zoom=1
// — a plain integer scale drawn with imageSmoothingEnabled=false, matching
// the pixel-art upscale idiom the old island Map already uses. The viewport
// itself now supports real zoom/pan (see ContinentCanvas) on top of this.
const CANVAS_SCALE = 4;
const ZOOM_MAX = 12;
const CENTER_ZOOM = 4; // zoom level "Center on My Territory" jumps to

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

// FNV-1a, same as Map.tsx's hashString — deterministic, good enough spread
// for stable per-owner color assignment (not cryptographic, doesn't need to
// be).
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.trim().replace("#", "");
  const n = parseInt(clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

// Stable color per owner id — every territory that player owns renders the
// same hue, which is what makes same-owner neighboring seeds read as one
// merged nation rather than a patchwork of unrelated parcels.
function ownerColor(ownerId: string): [number, number, number] {
  return hslToRgb(hashString(ownerId) % 360, 0.55, 0.5);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

interface Geometry {
  cols: number;
  rows: number;
  cellSizeKm: number;
  biomeIds: string[];
  biome: Uint8Array;
  seed: Uint16Array;
  noSeedSentinel: number;
}

interface Bounds {
  minCol: number;
  minRow: number;
  maxCol: number;
  maxRow: number;
}

// The continent is one landmass on a much larger grid (open ocean padding
// on every side, by design — see continentTerrain.ts's mask), so rendering
// the full grid wastes most of the canvas on empty water. Cropping to the
// land's own bounding box (plus a small margin) is what the initial
// fit-to-viewport zoom frames — real pan/zoom (below) handles seeing any
// part of it up close from there.
const CROP_MARGIN_CELLS = 12;

function computeLandBounds(geometry: Geometry): Bounds {
  let minCol = geometry.cols, minRow = geometry.rows, maxCol = -1, maxRow = -1;
  for (let row = 0; row < geometry.rows; row++) {
    for (let col = 0; col < geometry.cols; col++) {
      if (geometry.seed[row * geometry.cols + col] === geometry.noSeedSentinel) continue;
      if (col < minCol) minCol = col;
      if (col > maxCol) maxCol = col;
      if (row < minRow) minRow = row;
      if (row > maxRow) maxRow = row;
    }
  }
  if (maxCol < 0) return { minCol: 0, minRow: 0, maxCol: geometry.cols - 1, maxRow: geometry.rows - 1 };
  return {
    minCol: Math.max(0, minCol - CROP_MARGIN_CELLS),
    minRow: Math.max(0, minRow - CROP_MARGIN_CELLS),
    maxCol: Math.min(geometry.cols - 1, maxCol + CROP_MARGIN_CELLS),
    maxRow: Math.min(geometry.rows - 1, maxRow + CROP_MARGIN_CELLS),
  };
}

// Visual grouping key for border detection: ocean/lake is one group, every
// unclaimed seed is its own group (so distinct claimable parcels stay
// visible), and every seed owned by the same player collapses into one
// group (so a claimed nation's internal seed borders don't render) — this
// is the "merge = don't draw internal borders" rule from the land-system
// design, applied at render time rather than as stored geometry.
function groupIdFor(seedIndex: number, claimMap: Map<number, TerritoryClaim>, noSeedSentinel: number): number {
  if (seedIndex === noSeedSentinel) return -1;
  const claim = claimMap.get(seedIndex);
  if (!claim) return -(seedIndex + 2);
  return hashString(claim.ownerId) | 0;
}

function renderContinent(
  ctx: CanvasRenderingContext2D,
  geometry: Geometry,
  bounds: Bounds,
  claimMap: Map<number, TerritoryClaim>,
  accentRgb: [number, number, number],
  selectedSeedIndex: number | null,
) {
  const { cols, biome, seed, biomeIds, noSeedSentinel } = geometry;
  const n = cols * geometry.rows;
  const groupId = new Int32Array(n);
  for (let i = 0; i < n; i++) groupId[i] = groupIdFor(seed[i], claimMap, noSeedSentinel);

  const outW = bounds.maxCol - bounds.minCol + 1;
  const outH = bounds.maxRow - bounds.minRow + 1;
  const image = ctx.createImageData(outW, outH);
  const data = image.data;
  for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
    for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
      const idx = row * cols + col;
      const biomeId = biomeIds[biome[idx]] as BiomeId;
      let [r, g, b] = BIOME_COLORS[biomeId] ?? [90, 90, 90];

      const s = seed[idx];
      if (s !== noSeedSentinel) {
        const claim = claimMap.get(s);
        if (claim) {
          const tint = claim.isMine ? accentRgb : ownerColor(claim.ownerId);
          const strength = claim.isMine ? 0.6 : 0.5;
          r = lerp(r, tint[0], strength);
          g = lerp(g, tint[1], strength);
          b = lerp(b, tint[2], strength);
        }
      }

      const g0 = groupId[idx];
      const isBorder = (col < bounds.maxCol && groupId[idx + 1] !== g0) || (row < bounds.maxRow && groupId[idx + cols] !== g0);
      if (isBorder) {
        r *= 0.45;
        g *= 0.45;
        b *= 0.45;
      }

      // Selection highlight — traces the specific clicked seed's own
      // boundary (not its merged-nation group), so clicking one province of
      // a multi-seed nation still shows exactly which one is selected. Full-
      // strength, overriding the border darkening above rather than
      // blending with it, so it reads clearly against the muted map palette.
      if (selectedSeedIndex !== null) {
        const isSelf = s === selectedSeedIndex;
        const rightDiffers = col < bounds.maxCol && (seed[idx + 1] === selectedSeedIndex) !== isSelf;
        const downDiffers = row < bounds.maxRow && (seed[idx + cols] === selectedSeedIndex) !== isSelf;
        if (rightDiffers || downDiffers) {
          r = 255;
          g = 255;
          b = 255;
        }
      }

      const p = ((row - bounds.minRow) * outW + (col - bounds.minCol)) * 4;
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
      data[p + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

export interface ContinentCanvasHandle {
  centerOn: (worldX: number, worldY: number) => void;
  zoomBy: (factor: number) => void;
}

const ContinentCanvas = forwardRef<
  ContinentCanvasHandle,
  {
    geometry: Geometry;
    claims: TerritoryClaim[];
    selected: number | null;
    onSelect: (seedIndex: number | null) => void;
    children?: React.ReactNode;
  }
>(function ContinentCanvas({ geometry, claims, selected, onSelect, children }, ref) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const minZoomRef = useRef(0.1);
  const draggingRef = useRef(false);
  const lastPointRef = useRef({ x: 0, y: 0 });
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const [zoomLabel, setZoomLabel] = useState("1.0×");

  const claimMap = useMemo(() => new Map(claims.map((c) => [c.seedIndex, c])), [claims]);
  const bounds = useMemo(() => computeLandBounds(geometry), [geometry]);
  const outW = bounds.maxCol - bounds.minCol + 1;
  const outH = bounds.maxRow - bounds.minRow + 1;
  const nativeW = outW * CANVAS_SCALE;
  const nativeH = outH * CANVAS_SCALE;

  const applyTransform = () => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!viewport || !canvas) return;
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

    canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
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
      centerOn: (worldX: number, worldY: number) => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        const nx = (worldX / geometry.cellSizeKm - bounds.minCol) * CANVAS_SCALE;
        const ny = (worldY / geometry.cellSizeKm - bounds.minRow) * CANVAS_SCALE;
        zoomRef.current = clamp(CENTER_ZOOM, minZoomRef.current, ZOOM_MAX);
        panRef.current = {
          x: viewport.clientWidth / 2 - nx * zoomRef.current,
          y: viewport.clientHeight / 2 - ny * zoomRef.current,
        };
        applyTransform();
      },
      zoomBy: (factor: number) => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        const rect = viewport.getBoundingClientRect();
        zoomTo(zoomRef.current * factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geometry, bounds],
  );

  // Bake the bitmap once per geometry/bounds/claims/selection change — pure
  // raster content, independent of the current pan/zoom transform.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const accentHex = getComputedStyle(document.documentElement).getPropertyValue("--accent") || "#45d1a8";
    const accent = hexToRgb(accentHex);

    const offscreen = document.createElement("canvas");
    offscreen.width = outW;
    offscreen.height = outH;
    const offCtx = offscreen.getContext("2d")!;
    renderContinent(offCtx, geometry, bounds, claimMap, accent, selected);

    canvas.width = nativeW;
    canvas.height = nativeH;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offscreen, 0, 0, outW, outH, 0, 0, nativeW, nativeH);
  }, [geometry, bounds, claimMap, selected, outW, outH, nativeW, nativeH]);

  // Initial fit-to-viewport zoom (and the floor zoomTo/centerOn clamp to) —
  // computed once the viewport has a real size, not before.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const fitZoom = Math.min(viewport.clientWidth / nativeW, viewport.clientHeight / nativeH, 1);
    minZoomRef.current = Math.min(1, Math.max(0.05, fitZoom));
    zoomRef.current = minZoomRef.current;
    panRef.current = {
      x: (viewport.clientWidth - nativeW * zoomRef.current) / 2,
      y: (viewport.clientHeight - nativeH * zoomRef.current) / 2,
    };
    applyTransform();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeW, nativeH]);

  useEffect(() => {
    const onResize = () => applyTransform();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React's onWheel is bound passively, so preventDefault() inside it
  // silently no-ops (the page scrolls along with the zoom) — a native
  // listener with { passive: false } is required to actually stop that.
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
    draggingRef.current = true;
    lastPointRef.current = { x: e.clientX, y: e.clientY };
    pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
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

  // A plain click can't be distinguished from "the end of a drag" via a
  // separate onClick handler once panning is in play, so selection is
  // decided here instead: pointerup counts as a click only if the pointer
  // barely moved since pointerdown.
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    viewportRef.current?.classList.remove("map-viewport--dragging");
    const start = pointerDownPosRef.current;
    pointerDownPosRef.current = null;
    if (!start) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) return;

    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const zoom = zoomRef.current;
    const nativeX = (px - panRef.current.x) / zoom;
    const nativeY = (py - panRef.current.y) / zoom;
    const col = bounds.minCol + Math.floor(nativeX / CANVAS_SCALE);
    const row = bounds.minRow + Math.floor(nativeY / CANVAS_SCALE);
    if (col < bounds.minCol || col > bounds.maxCol || row < bounds.minRow || row > bounds.maxRow) return;
    const seedIndex = geometry.seed[row * geometry.cols + col];
    onSelect(seedIndex === geometry.noSeedSentinel ? null : seedIndex);
  };

  return (
    <div
      ref={viewportRef}
      className="map-viewport"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <canvas
        ref={canvasRef}
        className="map-terrain-canvas"
        style={{ position: "absolute", top: 0, left: 0, transformOrigin: "0 0" }}
      />
      <div className="map-zoom-readout">{zoomLabel}</div>
      {children}
    </div>
  );
});

// Every land-gated industry (Power Plant, Wheat Farm, etc. — COMPANY_
// INDUSTRIES entries with requiresTerritory: true) can be founded on any
// territory you own, one per industry per territory — no per-resource
// deposit check (see the recipe-economy plan's "Land = ownership gate"
// decision). Founds via the territory-gated path (routes/territory.ts's
// POST /:seedIndex/found), separate from, and not subject to, the ordinary
// zoning-capacity founding route.
function LandCompanyFounder({
  seedIndex,
  industryId,
  onFounded,
}: {
  seedIndex: number;
  industryId: CompanyIndustryId;
  onFounded: () => void;
}) {
  const industry = COMPANY_INDUSTRIES[industryId];
  const [name, setName] = useState(`${industry.name} #${seedIndex}`);
  const [error, setError] = useState<string | null>(null);

  const found = useMutation({
    mutationFn: () => api.foundOnTerritory(seedIndex, industryId, name),
    onSuccess: () => {
      setError(null);
      onFounded();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Founding failed"),
  });

  return (
    <div style={{ marginTop: 6 }}>
      {error && <div className="auth-error">{error}</div>}
      <div className="trade-row">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ flex: 1, minWidth: 0 }}
        />
        <button className="btn" disabled={found.isPending} onClick={() => found.mutate()}>
          Found {industry.name}
        </button>
      </div>
      <p className="suggestion" style={{ marginTop: 2, marginBottom: 0 }}>
        {industry.foundingCost}g · {industry.outputs.map((o) => o.resource).join(", ")}
      </p>
    </div>
  );
}

function TerritoryPanel({
  seedIndex,
  claims,
  pickingMode,
  onChanged,
  onClose,
}: {
  seedIndex: number;
  claims: TerritoryClaim[];
  pickingMode: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [battleReport, setBattleReport] = useState<AttackResult | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["territoryDetail", seedIndex],
    queryFn: () => api.territoryDetail(seedIndex),
  });
  const { data: military } = useMyMilitary();
  const { data: companiesData } = useMyCompanies();
  const claimInfo = claims.find((c) => c.seedIndex === seedIndex) ?? null;

  const invalidateAfterAcquire = () => {
    queryClient.invalidateQueries({ queryKey: ["territoryClaims"] });
    queryClient.invalidateQueries({ queryKey: ["myTerritories"] });
    queryClient.invalidateQueries({ queryKey: ["territoryDetail", seedIndex] });
    queryClient.invalidateQueries({ queryKey: ["myTerritoryDetail"] });
    queryClient.invalidateQueries({ queryKey: ["government"] });
  };

  // Free — only ever succeeds server-side while the player owns zero
  // territory (see the "choose your starting land" picker flow).
  const claim = useMutation({
    mutationFn: () => api.claimTerritory(seedIndex),
    onSuccess: () => {
      setError(null);
      invalidateAfterAcquire();
      onChanged();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Claim failed"),
  });

  // Paid (Government treasury) — every territory after a player's first.
  const buy = useMutation({
    mutationFn: () => api.buyTerritory(seedIndex),
    onSuccess: () => {
      setError(null);
      invalidateAfterAcquire();
      onChanged();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Purchase failed"),
  });

  const attack = useMutation({
    mutationFn: () => api.attackTerritory(seedIndex),
    onSuccess: (result) => {
      setError(null);
      setBattleReport(result);
      queryClient.invalidateQueries({ queryKey: ["territoryClaims"] });
      queryClient.invalidateQueries({ queryKey: ["myTerritories"] });
      queryClient.invalidateQueries({ queryKey: ["territoryDetail", seedIndex] });
      queryClient.invalidateQueries({ queryKey: ["myMilitary"] });
      onChanged();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Attack failed"),
  });

  if (isLoading || !data) {
    return (
      <div className="map-territory-popup">
        <button className="map-territory-popup__close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="loading">Loading territory...</div>
      </div>
    );
  }

  const unclaimedOrAbandoned = !claimInfo || (claimInfo.status === "abandoned" && !claimInfo.isMine);
  // Free claiming is only ever open during the one-time starting-territory
  // pick — every territory after that is bought (Government treasury) or
  // taken by force, never free (see the territory-acquisition rework).
  const canClaim = pickingMode && unclaimedOrAbandoned;
  const canBuy = !pickingMode && unclaimedOrAbandoned;
  const buyPrice = Math.round(data.areaKm2 * TERRITORY_TUNING.buyPricePerKm2);
  const canAttack = !pickingMode && !!claimInfo && !claimInfo.isMine && claimInfo.status !== "abandoned";
  const cantAttackReason = !military
    ? null
    : military.armyStrength <= 0
      ? "You have no army — raise one below first."
      : military.cooldownRemainingSeconds > 0
        ? `Army recovering — ${Math.ceil(military.cooldownRemainingSeconds / 3600)}h left.`
        : null;
  const resourceEntries = Object.entries(data.resources).filter(([, v]) => v > 0);

  // A blank-slate territory has no production until you found something on
  // it — one land-gated company per industry per territory (see
  // routes/territory.ts's POST /:seedIndex/found).
  const territoryCompanies = (companiesData?.companies ?? []).filter((c) => c.territorySeedIndex === seedIndex);
  const landGatedIndustries = COMPANY_INDUSTRY_IDS.filter((id) => COMPANY_INDUSTRIES[id].requiresTerritory);

  return (
    // stopPropagation on every pointer stage — the popup is a DOM sibling of
    // the canvas inside the same .map-viewport that ContinentCanvas binds its
    // pan/select pointer handlers to, so without this, any click inside the
    // popup (Close, Claim, Attack, the founder form) also bubbles up and
    // re-selects/deselects whatever territory is underneath it on the map.
    <div
      className="map-territory-popup"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      <button className="map-territory-popup__close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <h2 className="card__title">Territory #{data.seedIndex}</h2>
      {error && <div className="auth-error">{error}</div>}
      <p className="suggestion" style={{ marginTop: 0 }}>
        {data.dominantBiome} · {Math.round(data.areaKm2).toLocaleString()} km²
      </p>
      <p className="suggestion">
        Status:{" "}
        <strong>
          {claimInfo?.isMine
            ? "Yours"
            : claimInfo
              ? `${claimInfo.status} — held by ${claimInfo.ownerLabel}`
              : "Unclaimed"}
        </strong>
      </p>
      {resourceEntries.length > 0 && (
        <p className="suggestion">Resources: {resourceEntries.map(([k, v]) => `${k} ${v}`).join(", ")}</p>
      )}
      {canClaim && (
        <button className="btn btn--accent" disabled={claim.isPending} onClick={() => claim.mutate()}>
          {claimInfo?.status === "abandoned" ? "Claim Abandoned Territory (Free)" : "Choose as My Starting Territory"}
        </button>
      )}
      {canBuy && (
        <button className="btn btn--accent" disabled={buy.isPending} onClick={() => buy.mutate()}>
          Buy This Territory ({buyPrice.toLocaleString()}g)
        </button>
      )}
      {canAttack && (
        <>
          <p className="suggestion">Your army: {Math.round(military?.armyStrength ?? 0)} strength</p>
          <button
            className="btn btn--accent"
            disabled={attack.isPending || !!cantAttackReason}
            title={cantAttackReason ?? undefined}
            onClick={() => attack.mutate()}
          >
            Attack
          </button>
        </>
      )}
      {battleReport && (
        <div className={battleReport.won ? "suggestion" : "auth-error"} style={{ marginTop: 8 }}>
          {battleReport.won
            ? `Victory! Your forces (${Math.round(battleReport.attackerPower)}) overpowered the defenders (${Math.round(battleReport.defenderPower)}). This territory is now yours.`
            : `Defeat. Your forces (${Math.round(battleReport.attackerPower)}) were repelled by the defenders (${Math.round(battleReport.defenderPower)}). Your army is spent.`}
        </div>
      )}
      {claimInfo?.isMine && (
        <div style={{ marginTop: 10 }}>
          <div className="card-section-label">Land-Gated Companies</div>
          {landGatedIndustries.map((industryId) => {
            const founded = territoryCompanies.find((c) => c.industry === industryId);
            return founded ? (
              <p className="suggestion" key={industryId} style={{ marginTop: 4 }}>
                {founded.name} ({COMPANY_INDUSTRIES[industryId].name}) is running here.
              </p>
            ) : (
              <LandCompanyFounder
                key={industryId}
                seedIndex={seedIndex}
                industryId={industryId}
                onFounded={() => {
                  queryClient.invalidateQueries({ queryKey: ["myCompanies"] });
                  onChanged();
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// Army is funded from the player's own Government treasury (the same pool
// zone commissions already spend from), not Settlement resources — see
// routes/military.ts.
function MilitaryPanel() {
  const queryClient = useQueryClient();
  const { data: military } = useMyMilitary();
  const { data: government } = useGovernment();
  const [goldAmount, setGoldAmount] = useState(100);
  const [error, setError] = useState<string | null>(null);

  const raise = useMutation({
    mutationFn: () => api.raiseArmy(goldAmount),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["myMilitary"] });
      queryClient.invalidateQueries({ queryKey: ["government"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to raise army"),
  });

  const cooldownHours =
    military && military.cooldownRemainingSeconds > 0 ? Math.ceil(military.cooldownRemainingSeconds / 3600) : 0;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2 className="card__title">Your Army</h2>
      {error && <div className="auth-error">{error}</div>}
      <p className="suggestion" style={{ marginTop: 0 }}>
        Strength: {Math.round(military?.armyStrength ?? 0)}
        {cooldownHours > 0 && ` · recovering — ${cooldownHours}h left before you can attack again`}
      </p>
      <p className="suggestion">Government treasury: {Math.round(government?.treasury ?? 0)}g</p>
      <div className="trade-row">
        <input
          type="number"
          min={1}
          step={10}
          value={goldAmount}
          onChange={(e) => setGoldAmount(Math.max(1, Number(e.target.value) || 1))}
          style={{ width: 90 }}
        />
        <button className="btn" disabled={raise.isPending} onClick={() => raise.mutate()}>
          Raise Army
        </button>
      </div>
    </div>
  );
}

export default function Continent({ pickingMode = false }: { pickingMode?: boolean }) {
  const { data: preview } = useMapPreview();
  const { data: claimsData } = useTerritoryClaims();
  const { data: mineData } = useMyTerritories();
  const [selected, setSelected] = useState<number | null>(null);
  const canvasHandleRef = useRef<ContinentCanvasHandle>(null);
  const hasCenteredRef = useRef(false);

  const geometry = useMemo<Geometry | null>(() => {
    if (!preview) return null;
    return {
      cols: preview.cols,
      rows: preview.rows,
      cellSizeKm: preview.cellSizeKm,
      biomeIds: preview.biomeIds,
      biome: base64ToUint8(preview.biome),
      seed: base64ToUint16(preview.seed),
      noSeedSentinel: preview.noSeedSentinel,
    };
  }, [preview]);

  const claims = claimsData?.claims ?? [];
  const mine = mineData?.territories ?? [];
  const mineTotalArea = mine.reduce((sum, t) => sum + t.areaKm2, 0);

  const centerOnMine = () => {
    if (mine.length > 0) canvasHandleRef.current?.centerOn(mine[0].centerWorldX, mine[0].centerWorldY);
  };

  // Auto-center on the player's own territory once, the first time it's
  // available — directly serves "I need to zoom in to see my country"
  // without requiring a button click first. Doesn't re-fire on later polls.
  useEffect(() => {
    if (hasCenteredRef.current || !geometry || mine.length === 0) return;
    hasCenteredRef.current = true;
    centerOnMine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry, mine.length]);

  if (!geometry) {
    return (
      <div className="page page--full">
        <div className="loading">Loading continent...</div>
      </div>
    );
  }

  return (
    <div className="page page--full">
      {pickingMode && (
        <div className="card" style={{ borderColor: "var(--accent)" }}>
          <h2 className="card__title">Choose Your Starting Territory</h2>
          <p className="suggestion" style={{ marginTop: 0 }}>
            Click any unclaimed (or abandoned) territory below and choose it as your one free starting territory.
            This is the only free land you'll ever get — after this, more territory costs your government treasury
            to buy, or has to be taken by force.
          </p>
        </div>
      )}
      <div className="card">
        <div className="trade-row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <h2 className="card__title" style={{ margin: 0 }}>
            The Continent
          </h2>
          <div className="trade-row">
            <button className="btn" onClick={() => canvasHandleRef.current?.zoomBy(1 / 1.5)}>
              −
            </button>
            <button className="btn" onClick={() => canvasHandleRef.current?.zoomBy(1.5)}>
              +
            </button>
            <button className="btn" disabled={mine.length === 0} onClick={centerOnMine}>
              Center on My Territory
            </button>
          </div>
        </div>
        <p className="suggestion" style={{ marginTop: 4 }}>
          {pickingMode
            ? "Scroll to zoom, drag to pan. Click a territory to inspect it, then choose it as your starting land."
            : "Scroll to zoom, drag to pan. Click any territory to inspect, buy, or attack it — the selected one gets a bright outline. Same-owner territories share a color and merge visually; borders mark distinct parcels and the coastline."}
        </p>
        <ContinentCanvas ref={canvasHandleRef} geometry={geometry} claims={claims} selected={selected} onSelect={setSelected}>
          {selected !== null && (
            <TerritoryPanel
              key={selected}
              seedIndex={selected}
              claims={claims}
              pickingMode={pickingMode}
              onChanged={() => {}}
              onClose={() => setSelected(null)}
            />
          )}
        </ContinentCanvas>
      </div>

      {!pickingMode && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 className="card__title">Your Territories</h2>
          <p className="suggestion" style={{ marginTop: 0 }}>
            {mine.length === 0
              ? "You don't hold any territory yet."
              : `${mine.length} territor${mine.length === 1 ? "y" : "ies"} · ${Math.round(mineTotalArea).toLocaleString()} km² total`}
          </p>
        </div>
      )}

      {!pickingMode && <MilitaryPanel />}
    </div>
  );
}
