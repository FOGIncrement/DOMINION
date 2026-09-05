// Resolves a company's real-world (km) position for the shipment/logistics
// feature — a company either has a land-gated territorySeedIndex, a
// zoning-gated zoneId/cellX/cellY, or neither (an NPC company, or any
// company somehow founded without a position). The two position fields are
// mutually exclusive by construction (see the Company model's own comment),
// so this never has to arbitrate between them.
import { PLOT_ZONING_SIZE } from "@dominion/shared";
import { prisma } from "../db.js";
import { getSeedByIndex } from "../worldgen/loadedTerritoryData.js";

export interface WorldPosition {
  worldX: number;
  worldY: number;
}

// Minimal shape needed to resolve a position — matches any full Prisma
// Company row, including the seller/buyer rows engine.ts's Contracts block
// already loads via `include: { seller: true, buyer: true }`.
export interface PositionableCompany {
  ownerId: string | null;
  territorySeedIndex: number | null;
  zoneId: string | null;
  cellX: number | null;
  cellY: number | null;
}

export function getTerritoryWorldPosition(seedIndex: number): WorldPosition | null {
  const seed = getSeedByIndex(seedIndex);
  return seed ? { worldX: seed.centerWorldX, worldY: seed.centerWorldY } : null;
}

// Batched, once per tick run: one query for every distinct owner whose
// zoning-gated company is party to a contract this tick, not one query per
// contract/company (see engine.ts's Contracts block). An owner with zero
// owned Territory rows (lost their only territory, say) maps to null —
// resolveCompanyPosition treats that the same as "no position at all."
export async function buildOwnerTerritoryCentroids(ownerIds: string[]): Promise<Map<string, WorldPosition | null>> {
  const centroids = new Map<string, WorldPosition | null>();
  if (ownerIds.length === 0) return centroids;

  const territories = await prisma.territory.findMany({
    where: { ownerId: { in: ownerIds } },
    select: { ownerId: true, seedIndex: true },
  });
  const bySeedOwner = new Map<string, WorldPosition[]>();
  for (const t of territories) {
    const pos = getTerritoryWorldPosition(t.seedIndex);
    if (!pos) continue;
    const list = bySeedOwner.get(t.ownerId) ?? [];
    list.push(pos);
    bySeedOwner.set(t.ownerId, list);
  }
  for (const ownerId of ownerIds) {
    const positions = bySeedOwner.get(ownerId);
    if (!positions || positions.length === 0) {
      centroids.set(ownerId, null);
      continue;
    }
    centroids.set(ownerId, {
      worldX: positions.reduce((sum, p) => sum + p.worldX, 0) / positions.length,
      worldY: positions.reduce((sum, p) => sum + p.worldY, 0) / positions.length,
    });
  }
  return centroids;
}

// Land-gated -> resolved directly from territorySeedIndex. Zoning-gated ->
// the owner's territory centroid (from the pre-built map, see
// buildOwnerTerritoryCentroids), offset by the cell's position within the
// abstract PLOT_ZONING_SIZE grid — a real km position, not a literal
// geographic placement, but consistent and distance-comparable. Neither
// set (NPC, or a legacy company with no position at all), or the owner has
// no territory to anchor the zoning grid on -> null, meaning "unresolvable,"
// which callers treat as distance 0 / instant (see engine.ts's Contracts
// block and the design decision it documents).
export function resolveCompanyPosition(
  company: PositionableCompany,
  ownerTerritoryCentroids: Map<string, WorldPosition | null>,
  kmPerZoneCell: number,
): WorldPosition | null {
  if (company.territorySeedIndex !== null) {
    return getTerritoryWorldPosition(company.territorySeedIndex);
  }
  if (company.zoneId !== null && company.cellX !== null && company.cellY !== null && company.ownerId !== null) {
    const centroid = ownerTerritoryCentroids.get(company.ownerId);
    if (!centroid) return null;
    return {
      worldX: centroid.worldX + (company.cellX - PLOT_ZONING_SIZE / 2) * kmPerZoneCell,
      worldY: centroid.worldY + (company.cellY - PLOT_ZONING_SIZE / 2) * kmPerZoneCell,
    };
  }
  return null;
}

export function computeDistanceKm(a: WorldPosition, b: WorldPosition): number {
  return Math.hypot(a.worldX - b.worldX, a.worldY - b.worldY);
}

export function computeTransitHours(distanceKm: number, transitSpeedKmPerHour: number, maxTransitHours: number): number {
  return Math.min(maxTransitHours, distanceKm / transitSpeedKmPerHour);
}
