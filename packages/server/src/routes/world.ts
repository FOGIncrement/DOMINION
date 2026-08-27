import { Router } from "express";
import { NPC_ARCHETYPE_DEFS, WORLD_PLOT_COLS, WORLD_PLOT_ROWS, type CompanyIndustryId } from "@dominion/shared";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/index.js";
import { getConfig } from "../gameConfigStore.js";
import { getSettlementZoneRects } from "./infrastructure.js";

export const worldRouter = Router();

// Every settlement's slot on the shared world-plot grid, plus (only for the
// requesting player's own settlement) the placed zone rectangles within
// its local plot — everyone else's internal zoning isn't this player's
// business to see, only that their plot exists and whose it is. A
// settlement with no plot (worldCol/worldRow still null — the grid was
// full, or it predates this migration and hasn't been backfilled) is
// simply omitted rather than rendered at some fabricated position.
worldRouter.get("/map", requireAuth, async (req: AuthedRequest, res) => {
  const settlements = await prisma.settlement.findMany({
    where: { worldCol: { not: null }, worldRow: { not: null } },
    select: { id: true, name: true, playerId: true, archetype: true, worldCol: true, worldRow: true },
  });

  const mine = settlements.find((s) => s.playerId === req.playerId);
  const myZones = mine ? await getSettlementZoneRects(mine.id) : [];

  res.json({
    cols: WORLD_PLOT_COLS,
    rows: WORLD_PLOT_ROWS,
    settlements: settlements.map((s) => ({
      id: s.id,
      name: s.name,
      worldCol: s.worldCol!,
      worldRow: s.worldRow!,
      isPlayer: s.playerId !== null,
      isMine: s.playerId === req.playerId,
      archetypeName: s.archetype ? NPC_ARCHETYPE_DEFS[s.archetype as keyof typeof NPC_ARCHETYPE_DEFS]?.name : null,
    })),
    myZones,
  });
});

// Powers the World Map's zoom-to-detail island view. Discloses per-building
// type/level/workers and, for a player-owned settlement, its companies
// grouped by that one settlement — geographic grouping that /map and
// /companies never expose today, even though each item is already mostly
// public on its own (buildings via the Dashboard for your own settlement,
// companies world-wide via GET /companies). Zone placement stays behind the
// same isMine boundary /map already enforces — that's the one genuinely
// strategic secret here.
worldRouter.get("/settlements/:id/detail", requireAuth, async (req: AuthedRequest, res) => {
  const settlement = await prisma.settlement.findUnique({
    where: { id: req.params.id },
    include: { population: true, buildings: true },
  });
  if (!settlement || settlement.worldCol === null || settlement.worldRow === null) {
    res.status(404).json({ error: "Settlement not found" });
    return;
  }

  const isMine = settlement.playerId === req.playerId;
  const config = getConfig();

  const companies = settlement.playerId
    ? await prisma.company.findMany({
        where: { ownerId: settlement.playerId, closedAt: null },
        orderBy: { foundedAt: "asc" },
      })
    : [];

  res.json({
    id: settlement.id,
    name: settlement.name,
    worldCol: settlement.worldCol,
    worldRow: settlement.worldRow,
    isMine,
    isPlayer: settlement.playerId !== null,
    archetypeName: settlement.archetype
      ? NPC_ARCHETYPE_DEFS[settlement.archetype as keyof typeof NPC_ARCHETYPE_DEFS]?.name
      : null,
    population: { count: Math.round(settlement.population?.count ?? 0) },
    buildings: settlement.buildings.map((b) => ({
      id: b.id,
      type: b.type,
      level: b.level,
      workersAssigned: b.workersAssigned,
    })),
    companies: companies.map((c) => ({
      id: c.id,
      name: c.name,
      industry: c.industry,
      industryName: config.COMPANY_INDUSTRIES[c.industry as CompanyIndustryId]?.name ?? c.industry,
      level: c.level,
      workersAssigned: c.workersAssigned,
    })),
    zones: isMine ? await getSettlementZoneRects(settlement.id) : [],
  });
});

worldRouter.get("/settlements", async (_req, res) => {
  const settlements = await prisma.settlement.findMany({
    where: { playerId: null },
    include: { population: true, buildings: true },
    orderBy: { foundedAt: "asc" },
  });

  res.json({
    settlements: settlements.map((s) => ({
      id: s.id,
      name: s.name,
      archetype: s.archetype,
      archetypeName: s.archetype ? NPC_ARCHETYPE_DEFS[s.archetype as keyof typeof NPC_ARCHETYPE_DEFS]?.name : null,
      population: Math.round(s.population?.count ?? 0),
      buildingCount: s.buildings.length,
      gold: Math.round(s.gold),
      foundedAt: s.foundedAt,
    })),
  });
});
