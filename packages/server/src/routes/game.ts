import { Router } from "express";
import { computeUnemployment } from "@dominion/shared";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/index.js";
import { housingCapacity } from "../simulation/consumption.js";
import { computeOfflineSummaryAndAdvance } from "../offlineSummary.js";

export const gameRouter = Router();
gameRouter.use(requireAuth);

async function loadOwnedSettlement(playerId: string) {
  const settlement = await prisma.settlement.findUnique({
    where: { playerId },
    include: { population: true },
  });
  if (!settlement || !settlement.population) return null;
  return settlement;
}

// The legacy building/tech economy (buildings, worker assignment on them,
// the tech tree) was removed 2026-09-03 alongside wood/stone — population
// capacity now comes from housingCapacity's territory-count formula, food
// from the new land-gated `farm` company, and this route just reports
// settlement/population state plus the offline-away summary.
gameRouter.get("/state", async (req: AuthedRequest, res) => {
  const settlement = await loadOwnedSettlement(req.playerId!);
  if (!settlement) {
    res.status(404).json({ error: "No settlement found for this player" });
    return;
  }
  const offlineSummary = await computeOfflineSummaryAndAdvance(req.playerId!, settlement.id, {
    food: settlement.food,
    gold: settlement.gold,
    population: settlement.population!.count,
  });

  // "Available" is the same pool /companies/:id/workers draws from and
  // enforces a hard cap against.
  const [companies, territoriesOwned] = await Promise.all([
    prisma.company.findMany({ where: { ownerId: req.playerId!, closedAt: null }, select: { workersAssigned: true } }),
    prisma.territory.count({ where: { ownerId: req.playerId! } }),
  ]);
  const companyWorkers = companies.reduce((sum, c) => sum + c.workersAssigned, 0);
  const available = computeUnemployment(settlement.population!.count, companyWorkers);

  res.json({
    settlement: {
      id: settlement.id,
      name: settlement.name,
      era: settlement.era,
      food: settlement.food,
      gold: settlement.gold,
      storageCap: settlement.storageCap,
      foundedAt: settlement.foundedAt,
    },
    population: {
      count: settlement.population!.count,
      happiness: settlement.population!.happiness,
      capacity: housingCapacity(territoriesOwned),
      available,
    },
    offlineSummary,
  });
});
