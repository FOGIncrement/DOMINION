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

// Capacity used is every non-closed company this player owns in the
// category; capacity available is the baseline free allowance plus every
// completed zone's slotsGranted. Only completed zones count — a project
// that's still "building" hasn't delivered capacity yet.
async function computeCapacity(playerId: string, settlementId: string, zoneType: ZoneTypeId) {
  const def = ZONE_TYPES[zoneType];
  const [used, zones] = await Promise.all([
    prisma.company.count({
      where: { ownerId: playerId, closedAt: null, industry: { in: def.industries } },
    }),
    prisma.settlementZone.findMany({ where: { settlementId, type: zoneType } }),
  ]);
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
      ...(await computeCapacity(req.playerId!, settlement.id, zoneType)),
    })),
  );

  res.json({ zones });
});

infrastructureRouter.get("/mine", async (req: AuthedRequest, res) => {
  const companies = await prisma.company.findMany({ where: { ownerId: req.playerId! }, select: { id: true } });
  const companyIds = companies.map((c) => c.id);

  const projects = await prisma.zoneProject.findMany({
    where: {
      OR: [{ government: { playerId: req.playerId! } }, { constructionCompanyId: { in: companyIds } }],
    },
    include: { constructionCompany: true, government: { include: { player: true } } },
    orderBy: { createdAt: "desc" },
  });

  res.json({
    projects: projects.map((p) => ({
      id: p.id,
      zoneType: p.zoneType,
      constructionCompanyId: p.constructionCompanyId,
      constructionCompanyName: p.constructionCompany.name,
      constructionCompanyIsMine: p.constructionCompany.ownerId === req.playerId,
      governmentIsMine: p.government.playerId === req.playerId,
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
  constructionCompanyId: z.string(),
  zoneType: z.enum(ZONE_TYPE_IDS),
  treasuryCost: z.number().positive(),
  zoneX: z.number().int().min(0),
  zoneY: z.number().int().min(0),
  zoneWidth: z.number().int().positive(),
  zoneHeight: z.number().int().positive(),
});

// Unlike Contract (either company's controller may propose), commissioning
// is never symmetric — only the settlement's own government can initiate,
// so there's no "does the caller control either side" check here at all.
// The only open question is which side the construction company sits on.
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

  const company = await prisma.company.findUnique({ where: { id: parsed.data.constructionCompanyId } });
  if (!company || company.closedAt) {
    res.status(404).json({ error: "Construction company not found" });
    return;
  }
  // Deliberately restricted to the construction industry specifically, not
  // "any company whose outputResource is goods" — the roadmap ask was to
  // give a *construction* company the contract, and "goods" being fungible
  // under the hood doesn't mean every goods-producer should qualify.
  if (company.industry !== "construction") {
    res.status(400).json({ error: `${company.name} isn't a construction company` });
    return;
  }

  const needsOffer = company.ownerId !== null && company.ownerId !== req.playerId;
  const now = new Date();

  if (needsOffer) {
    const project = await prisma.zoneProject.create({
      data: {
        governmentId: government.id,
        constructionCompanyId: company.id,
        settlementId: settlement.id,
        zoneType: def.id,
        treasuryCost,
        buildTimeHours: def.buildTimeHours,
        zoneX,
        zoneY,
        zoneWidth,
        zoneHeight,
      },
    });
    res.status(201).json({ ok: true, projectId: project.id, pending: true });
    return;
  }

  const completesAt = new Date(now.getTime() + def.buildTimeHours * 60 * 60 * 1000);
  const [project] = await prisma.$transaction([
    prisma.zoneProject.create({
      data: {
        governmentId: government.id,
        constructionCompanyId: company.id,
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
    prisma.company.update({
      where: { id: company.id },
      data: {
        cash: { increment: treasuryCost },
        totalRevenue: { increment: treasuryCost },
      },
    }),
  ]);
  res.status(201).json({ ok: true, projectId: project.id, pending: false });
});

infrastructureRouter.post("/:id/accept", async (req: AuthedRequest, res) => {
  const project = await prisma.zoneProject.findUnique({
    where: { id: req.params.id },
    include: { constructionCompany: true, government: true },
  });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  // Only the construction company's owner may accept — the commissioning
  // government is always the proposer here (unlike Contract, this isn't
  // symmetric) and can never legitimately "accept its own offer": if they
  // owned the company, this would already have activated immediately.
  if (project.constructionCompany.ownerId !== req.playerId) {
    res.status(403).json({ error: "You don't control the construction company on this commission" });
    return;
  }
  if (project.cancelledAt) {
    res.status(400).json({ error: "This offer was cancelled" });
    return;
  }
  if (project.acceptedAt) {
    res.status(400).json({ error: "Already accepted" });
    return;
  }
  // Re-validate at accept time, not just at commission time — this is a
  // synchronous lump-sum transfer that can't partially degrade the way
  // Contract's per-tick settlement can, so a shortfall here must reject
  // outright rather than silently transfer less.
  if (project.government.treasury < project.treasuryCost) {
    res.status(400).json({ error: "The commissioning government's treasury can no longer cover this" });
    return;
  }

  const now = new Date();
  const completesAt = new Date(now.getTime() + project.buildTimeHours * 60 * 60 * 1000);
  await prisma.$transaction([
    prisma.zoneProject.update({ where: { id: project.id }, data: { acceptedAt: now, completesAt } }),
    prisma.government.update({ where: { id: project.governmentId }, data: { treasury: { decrement: project.treasuryCost } } }),
    prisma.company.update({
      where: { id: project.constructionCompanyId },
      data: {
        cash: { increment: project.treasuryCost },
        totalRevenue: { increment: project.treasuryCost },
      },
    }),
  ]);
  res.json({ ok: true });
});

// Either party may withdraw/reject a still-pending offer. Once accepted,
// funds and materials have already moved — no refund path in v1, so
// cancellation is only available before that point.
infrastructureRouter.post("/:id/cancel", async (req: AuthedRequest, res) => {
  const project = await prisma.zoneProject.findUnique({
    where: { id: req.params.id },
    include: { constructionCompany: true, government: true },
  });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  if (project.government.playerId !== req.playerId && project.constructionCompany.ownerId !== req.playerId) {
    res.status(403).json({ error: "You aren't a party to this commission" });
    return;
  }
  if (project.cancelledAt) {
    res.status(400).json({ error: "Already cancelled" });
    return;
  }
  if (project.acceptedAt) {
    res.status(400).json({ error: "Already accepted — funds and materials have changed hands, this can't be cancelled" });
    return;
  }

  await prisma.zoneProject.update({ where: { id: project.id }, data: { cancelledAt: new Date() } });
  res.json({ ok: true });
});
