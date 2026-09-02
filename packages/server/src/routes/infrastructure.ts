import { Router } from "express";
import { z } from "zod";
import { PLOT_ZONING_SIZE, ZONE_BASELINE_FREE_SLOTS, ZONE_TYPES, ZONE_TYPE_IDS, type ZoneTypeId } from "@dominion/shared";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/index.js";
import { getOrCreateGovernment } from "./government.js";

export const infrastructureRouter = Router();
infrastructureRouter.use(requireAuth);

function statusOf(p: { cancelledAt: Date | null; acceptedAt: Date | null; completedAt: Date | null }) {
  if (p.cancelledAt) return "cancelled";
  if (!p.acceptedAt) return "pending";
  if (p.completedAt) return "completed";
  return "building";
}

export interface ZoneRect {
  zoneType: string;
  x: number;
  y: number;
  width: number;
  height: number;
  status: "completed" | "pending" | "building";
}

// Every placed rectangle on a settlement's local zoning grid — completed
// zones plus anything still pending/building (an in-flight commission's
// footprint is reserved the moment it's proposed, not just once accepted,
// so two commissions can't race to claim overlapping land). Rows from
// before zone placement existed have null coordinates and are skipped
// rather than rendered/validated against. Shared by the commission route's
// overlap check below and the world map's plot-rendering route.
export async function getSettlementZoneRects(settlementId: string): Promise<ZoneRect[]> {
  const [completed, projects] = await Promise.all([
    prisma.settlementZone.findMany({ where: { settlementId, zoneX: { not: null } } }),
    prisma.zoneProject.findMany({
      where: { settlementId, cancelledAt: null, completedAt: null, zoneX: { not: null } },
    }),
  ]);

  const rects: ZoneRect[] = completed.map((z) => ({
    zoneType: z.type,
    x: z.zoneX!,
    y: z.zoneY!,
    width: z.zoneWidth!,
    height: z.zoneHeight!,
    status: "completed",
  }));
  for (const p of projects) {
    rects.push({
      zoneType: p.zoneType,
      x: p.zoneX!,
      y: p.zoneY!,
      width: p.zoneWidth!,
      height: p.zoneHeight!,
      status: p.acceptedAt ? "building" : "pending",
    });
  }
  return rects;
}

function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
}

// Capacity used is the sum of facilityCount across every non-closed company
// this player owns in the category — a multi-facility company consumes
// proportionally more, same as founding another company would (see
// Company.facilityCount and routes/companies.ts's expand route, both of
// which reuse this instead of maintaining their own count). Capacity
// available is the baseline free allowance plus every completed zone's
// slotsGranted. Only completed zones count — a project that's still
// "building" hasn't delivered capacity yet.
export async function computeZoneCategoryUsage(playerId: string, settlementId: string, zoneType: ZoneTypeId) {
  const def = ZONE_TYPES[zoneType];
  const [companies, zones] = await Promise.all([
    prisma.company.findMany({
      where: { ownerId: playerId, closedAt: null, industry: { in: def.industries } },
      select: { facilityCount: true },
    }),
    prisma.settlementZone.findMany({ where: { settlementId, type: zoneType } }),
  ]);
  const used = companies.reduce((sum, c) => sum + c.facilityCount, 0);
  const available = ZONE_BASELINE_FREE_SLOTS[zoneType] + zones.reduce((sum, z) => sum + z.slotsGranted, 0);
  return { used, available };
}

infrastructureRouter.get("/", async (req: AuthedRequest, res) => {
  const settlement = await prisma.settlement.findUnique({ where: { playerId: req.playerId! } });
  if (!settlement) {
    res.status(404).json({ error: "No settlement found for this player" });
    return;
  }

  const zones = await Promise.all(
    ZONE_TYPE_IDS.map(async (zoneType) => ({
      ...ZONE_TYPES[zoneType],
      ...(await computeZoneCategoryUsage(req.playerId!, settlement.id, zoneType)),
    })),
  );

  res.json({ zones });
});

infrastructureRouter.get("/mine", async (req: AuthedRequest, res) => {
  const projects = await prisma.zoneProject.findMany({
    where: { government: { playerId: req.playerId! } },
    orderBy: { createdAt: "desc" },
  });

  res.json({
    projects: projects.map((p) => ({
      id: p.id,
      zoneType: p.zoneType,
      treasuryCost: p.treasuryCost,
      zoneX: p.zoneX,
      zoneY: p.zoneY,
      zoneWidth: p.zoneWidth,
      zoneHeight: p.zoneHeight,
      buildTimeHours: p.buildTimeHours,
      createdAt: p.createdAt,
      acceptedAt: p.acceptedAt,
      completesAt: p.completesAt,
      completedAt: p.completedAt,
      cancelledAt: p.cancelledAt,
      status: statusOf(p),
    })),
  });
});

const commissionSchema = z.object({
  zoneType: z.enum(ZONE_TYPE_IDS),
  treasuryCost: z.number().positive(),
  zoneX: z.number().int().min(0),
  zoneY: z.number().int().min(0),
  zoneWidth: z.number().int().positive(),
  zoneHeight: z.number().int().positive(),
});

// Pay the treasury cost, done — no construction-company middleman, no
// accept/reject negotiation. Still has a build-time delay before the
// completion sweep (simulation/engine.ts) turns this into a real
// SettlementZone, just committed the instant it's paid for rather than
// requiring a second party's acceptance.
infrastructureRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = commissionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid commission request" });
    return;
  }

  const settlement = await prisma.settlement.findUnique({ where: { playerId: req.playerId! } });
  if (!settlement) {
    res.status(404).json({ error: "No settlement found for this player" });
    return;
  }

  const def = ZONE_TYPES[parsed.data.zoneType];
  const { treasuryCost, zoneX, zoneY, zoneWidth, zoneHeight } = parsed.data;

  if (zoneX + zoneWidth > PLOT_ZONING_SIZE || zoneY + zoneHeight > PLOT_ZONING_SIZE) {
    res.status(400).json({ error: `That rectangle falls outside your ${PLOT_ZONING_SIZE}x${PLOT_ZONING_SIZE} plot` });
    return;
  }

  const existingRects = await getSettlementZoneRects(settlement.id);
  const newRect = { x: zoneX, y: zoneY, width: zoneWidth, height: zoneHeight };
  if (existingRects.some((r) => rectsOverlap(r, newRect))) {
    res.status(400).json({ error: "That rectangle overlaps a zone you've already placed or commissioned" });
    return;
  }

  const government = await getOrCreateGovernment(req.playerId!);
  if (government.treasury < treasuryCost) {
    res.status(400).json({ error: "Not enough treasury funds" });
    return;
  }

  const now = new Date();
  const completesAt = new Date(now.getTime() + def.buildTimeHours * 60 * 60 * 1000);
  const [project] = await prisma.$transaction([
    prisma.zoneProject.create({
      data: {
        governmentId: government.id,
        settlementId: settlement.id,
        zoneType: def.id,
        treasuryCost,
        buildTimeHours: def.buildTimeHours,
        acceptedAt: now,
        completesAt,
        zoneX,
        zoneY,
        zoneWidth,
        zoneHeight,
      },
    }),
    prisma.government.update({ where: { id: government.id }, data: { treasury: { decrement: treasuryCost } } }),
  ]);
  res.status(201).json({ ok: true, projectId: project.id });
});
