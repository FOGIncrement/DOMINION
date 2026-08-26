import { Router } from "express";
import { NPC_ARCHETYPE_DEFS, WORLD_PLOT_COLS, WORLD_PLOT_ROWS } from "@dominion/shared";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/index.js";
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
