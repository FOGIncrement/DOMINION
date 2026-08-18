import { Router } from "express";
import { NPC_ARCHETYPE_DEFS } from "@dominion/shared";
import { prisma } from "../db.js";

export const worldRouter = Router();

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
