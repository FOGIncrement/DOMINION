import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BIOME_COLORS, type BiomeId } from "@dominion/shared";
import { api, ApiError, type AttackResult, type TerritoryClaim } from "../api/client.js";
import { useGovernment, useMapPreview, useMyMilitary, useMyTerritories, useTerritoryClaims } from "../api/hooks.js";

// Display px per (already-downsampled, 4km-per-cell) preview cell — a plain
// integer scale drawn with imageSmoothingEnabled=false, matching the
// pixel-art upscale idiom the old island Map already uses. Higher than it
// would need to be for the full grid, since the canvas is cropped to just
// the continent's own bounding box (see computeLandBounds) rather than the
// whole ocean-padded world.
const CANVAS_SCALE = 4;

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
// land's own bounding box (plus a small margin) makes the actual continent
// fill the view without needing real pan/zoom, which is out of scope for
// this quick pass.
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

      const p = ((row - bounds.minRow) * outW + (col - bounds.minCol)) * 4;
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
      data[p + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

function ContinentCanvas({
  geometry,
  claims,
  onSelect,
}: {
  geometry: Geometry;
  claims: TerritoryClaim[];
  onSelect: (seedIndex: number | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const claimMap = useMemo(() => new Map(claims.map((c) => [c.seedIndex, c])), [claims]);
  const bounds = useMemo(() => computeLandBounds(geometry), [geometry]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const accentHex = getComputedStyle(document.documentElement).getPropertyValue("--accent") || "#45d1a8";
    const accent = hexToRgb(accentHex);

    const outW = bounds.maxCol - bounds.minCol + 1;
    const outH = bounds.maxRow - bounds.minRow + 1;
    const offscreen = document.createElement("canvas");
    offscreen.width = outW;
    offscreen.height = outH;
    const offCtx = offscreen.getContext("2d")!;
    renderContinent(offCtx, geometry, bounds, claimMap, accent);

    canvas.width = outW * CANVAS_SCALE;
    canvas.height = outH * CANVAS_SCALE;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offscreen, 0, 0, outW, outH, 0, 0, canvas.width, canvas.height);
  }, [geometry, bounds, claimMap]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (canvas.width / rect.width);
    const py = (e.clientY - rect.top) * (canvas.height / rect.height);
    const col = bounds.minCol + Math.floor(px / CANVAS_SCALE);
    const row = bounds.minRow + Math.floor(py / CANVAS_SCALE);
    if (col < bounds.minCol || col > bounds.maxCol || row < bounds.minRow || row > bounds.maxRow) return;
    const seedIndex = geometry.seed[row * geometry.cols + col];
    onSelect(seedIndex === geometry.noSeedSentinel ? null : seedIndex);
  };

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      style={{ display: "block", width: "100%", height: "auto", cursor: "pointer", imageRendering: "pixelated" }}
    />
  );
}

function TerritoryPanel({
  seedIndex,
  claims,
  onChanged,
}: {
  seedIndex: number;
  claims: TerritoryClaim[];
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [battleReport, setBattleReport] = useState<AttackResult | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["territoryDetail", seedIndex],
    queryFn: () => api.territoryDetail(seedIndex),
  });
  const { data: military } = useMyMilitary();
  const claimInfo = claims.find((c) => c.seedIndex === seedIndex) ?? null;

  const claim = useMutation({
    mutationFn: () => api.claimTerritory(seedIndex),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["territoryClaims"] });
      queryClient.invalidateQueries({ queryKey: ["myTerritories"] });
      queryClient.invalidateQueries({ queryKey: ["territoryDetail", seedIndex] });
      onChanged();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Claim failed"),
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
      <div className="card">
        <div className="loading">Loading territory...</div>
      </div>
    );
  }

  const canClaim = !claimInfo || (claimInfo.status === "abandoned" && !claimInfo.isMine);
  const canAttack = !!claimInfo && !claimInfo.isMine && claimInfo.status !== "abandoned";
  const cantAttackReason = !military
    ? null
    : military.armyStrength <= 0
      ? "You have no army — raise one below first."
      : military.cooldownRemainingSeconds > 0
        ? `Army recovering — ${Math.ceil(military.cooldownRemainingSeconds / 3600)}h left.`
        : null;
  const resourceEntries = Object.entries(data.resources).filter(([, v]) => v > 0);

  return (
    <div className="card">
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
          {claimInfo?.status === "abandoned" ? "Claim Abandoned Territory" : "Claim This Territory"}
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

export default function Continent() {
  const { data: preview } = useMapPreview();
  const { data: claimsData } = useTerritoryClaims();
  const { data: mineData } = useMyTerritories();
  const [selected, setSelected] = useState<number | null>(null);

  const geometry = useMemo<Geometry | null>(() => {
    if (!preview) return null;
    return {
      cols: preview.cols,
      rows: preview.rows,
      biomeIds: preview.biomeIds,
      biome: base64ToUint8(preview.biome),
      seed: base64ToUint16(preview.seed),
      noSeedSentinel: preview.noSeedSentinel,
    };
  }, [preview]);

  const claims = claimsData?.claims ?? [];
  const mine = mineData?.territories ?? [];
  const mineTotalArea = mine.reduce((sum, t) => sum + t.areaKm2, 0);

  if (!geometry) {
    return (
      <div className="page page--full">
        <div className="loading">Loading continent...</div>
      </div>
    );
  }

  return (
    <div className="page page--full">
      <div className="card">
        <h2 className="card__title" style={{ margin: 0 }}>
          The Continent
        </h2>
        <p className="suggestion" style={{ marginTop: 4 }}>
          Every player's land in one place. Click any territory to inspect and claim it. Same-owner territories
          share a color and merge visually; borders mark distinct claimable parcels and the coastline.
        </p>
        <ContinentCanvas geometry={geometry} claims={claims} onSelect={setSelected} />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2 className="card__title">Your Territories</h2>
        <p className="suggestion" style={{ marginTop: 0 }}>
          {mine.length === 0
            ? "You don't hold any territory yet — click a territory on the map to claim it."
            : `${mine.length} territor${mine.length === 1 ? "y" : "ies"} · ${Math.round(mineTotalArea).toLocaleString()} km² total`}
        </p>
      </div>

      <MilitaryPanel />

      {selected !== null && (
        <div style={{ marginTop: 16 }}>
          <TerritoryPanel key={selected} seedIndex={selected} claims={claims} onChanged={() => {}} />
        </div>
      )}
    </div>
  );
}
