import { Router } from "express";
import { z } from "zod";
import {
  BUILDING_TYPE_IDS,
  RESOURCE_TYPES,
  TECHS,
  computeBuildingUpgradeCost,
  computeUnemployment,
  type BuildingTypeId,
  type ResourceType,
} from "@dominion/shared";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/index.js";
import { getConfig } from "../gameConfigStore.js";
import { housingCapacity } from "../simulation/consumption.js";
import { computeOfflineSummaryAndAdvance } from "../offlineSummary.js";
import { ensurePlayerTerritory } from "./territory.js";
import type { SettlementSnapshot } from "../simulation/types.js";

export const gameRouter = Router();
gameRouter.use(requireAuth);

async function loadOwnedSettlement(playerId: string) {
  const settlement = await prisma.settlement.findUnique({
    where: { playerId },
    include: { population: true, buildings: true, techs: true },
  });
  if (!settlement || !settlement.population) return null;
  return settlement;
}

function toSnapshot(settlement: NonNullable<Awaited<ReturnType<typeof loadOwnedSettlement>>>): SettlementSnapshot {
  return {
    id: settlement.id,
    name: settlement.name,
    playerId: settlement.playerId,
    archetype: null,
    food: settlement.food,
    wood: settlement.wood,
    stone: settlement.stone,
    gold: settlement.gold,
    storageCap: settlement.storageCap,
    lastTickAt: settlement.lastTickAt,
    population: {
      count: settlement.population!.count,
      growthRate: settlement.population!.growthRate,
      happiness: settlement.population!.happiness,
    },
    buildings: settlement.buildings.map((b) => ({
      id: b.id,
      type: b.type as BuildingTypeId,
      workersAssigned: b.workersAssigned,
      level: b.level,
    })),
    techIds: settlement.techs.map((t) => t.techId),
  };
}

gameRouter.get("/state", async (req: AuthedRequest, res) => {
  const settlement = await loadOwnedSettlement(req.playerId!);
  if (!settlement) {
    res.status(404).json({ error: "No settlement found for this player" });
    return;
  }
  // Every player is meant to hold real land on the continent, not just have
  // the option to claim some — see territory.ts's ensurePlayerTerritory.
  // This is the one place every session bootstraps through, so it's also
  // what backfills every pre-existing player.
  await ensurePlayerTerritory(req.playerId!);
  const config = getConfig();
  const snapshot = toSnapshot(settlement);

  const offlineSummary = await computeOfflineSummaryAndAdvance(req.playerId!, settlement.id, {
    food: settlement.food,
    wood: settlement.wood,
    stone: settlement.stone,
    gold: settlement.gold,
    population: settlement.population!.count,
  });

  // "Available" is the same pool /game/workers and /companies/:id/workers
  // both draw from and enforce a hard cap against — buildings and every
  // company this player founded share one population, not separate ones.
  const buildingWorkers = settlement.buildings.reduce((sum, b) => sum + b.workersAssigned, 0);
  const companies = await prisma.company.findMany({
    where: { ownerId: req.playerId!, closedAt: null },
    select: { workersAssigned: true },
  });
  const companyWorkers = companies.reduce((sum, c) => sum + c.workersAssigned, 0);
  const available = computeUnemployment(settlement.population!.count, buildingWorkers + companyWorkers);

  res.json({
    settlement: {
      id: settlement.id,
      name: settlement.name,
      era: settlement.era,
      food: settlement.food,
      wood: settlement.wood,
      stone: settlement.stone,
      gold: settlement.gold,
      storageCap: settlement.storageCap,
      foundedAt: settlement.foundedAt,
    },
    population: {
      count: settlement.population!.count,
      happiness: settlement.population!.happiness,
      capacity: housingCapacity(snapshot),
      available,
    },
    buildings: settlement.buildings.map((b) => ({
      id: b.id,
      type: b.type,
      level: b.level,
      workersAssigned: b.workersAssigned,
      upgradeCost: computeBuildingUpgradeCost(
        config.BUILDING_TYPES[b.type as BuildingTypeId],
        b.level,
        config.BUILDING_UPGRADE_TUNING,
      ),
    })),
    techIds: settlement.techs.map((t) => t.techId),
    offlineSummary,
  });
});

const buildSchema = z.object({ type: z.enum(BUILDING_TYPE_IDS) });

gameRouter.post("/buildings", async (req: AuthedRequest, res) => {
  const parsed = buildSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid building type" });
    return;
  }

  const settlement = await loadOwnedSettlement(req.playerId!);
  if (!settlement) {
    res.status(404).json({ error: "No settlement found for this player" });
    return;
  }

  const def = getConfig().BUILDING_TYPES[parsed.data.type];
  if (def.retiredForConstruction) {
    res.status(400).json({
      error: `${def.name} is no longer buildable directly — found a company in that industry instead. Any ${def.name} you already have keeps working.`,
    });
    return;
  }
  if (def.requiredTech && !settlement.techs.some((t) => t.techId === def.requiredTech)) {
    res.status(400).json({ error: `Requires the ${TECHS[def.requiredTech].name} technology` });
    return;
  }

  for (const resourceType of RESOURCE_TYPES) {
    const cost = def.cost[resourceType] ?? 0;
    if (settlement[resourceType] < cost) {
      res.status(400).json({ error: `Not enough ${resourceType} to build ${def.name}` });
      return;
    }
  }

  const resourceUpdate: Partial<Record<ResourceType, number>> = {};
  for (const resourceType of RESOURCE_TYPES) {
    const cost = def.cost[resourceType] ?? 0;
    if (cost > 0) resourceUpdate[resourceType] = settlement[resourceType] - cost;
  }

  await prisma.$transaction([
    prisma.settlement.update({ where: { id: settlement.id }, data: resourceUpdate }),
    prisma.building.create({ data: { settlementId: settlement.id, type: def.id } }),
  ]);

  res.status(201).json({ ok: true });
});

const workersSchema = z.object({
  buildingId: z.string(),
  workersAssigned: z.number().int().min(0),
});

gameRouter.post("/workers", async (req: AuthedRequest, res) => {
  const parsed = workersSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const settlement = await loadOwnedSettlement(req.playerId!);
  if (!settlement) {
    res.status(404).json({ error: "No settlement found for this player" });
    return;
  }

  const building = settlement.buildings.find((b) => b.id === parsed.data.buildingId);
  if (!building) {
    res.status(404).json({ error: "Building not found" });
    return;
  }

  const def = getConfig().BUILDING_TYPES[building.type as BuildingTypeId];
  const desired = Math.min(parsed.data.workersAssigned, def.maxWorkers);

  // Only the population cap for *increasing* workers on this building —
  // decreasing must always be allowed, even if population has since shrunk
  // (e.g. starvation) below the total already assigned elsewhere. Otherwise
  // a player can get stuck unable to unassign workers they no longer have.
  // Buildings and every company this player founded draw from the same
  // population pool (see /companies/:id/workers for the company side of
  // this same check), so this needs to count company workers too, not just
  // other buildings.
  if (desired > building.workersAssigned) {
    const workersElsewhere = settlement.buildings
      .filter((b) => b.id !== building.id)
      .reduce((sum, b) => sum + b.workersAssigned, 0);

    const companies = await prisma.company.findMany({
      where: { ownerId: req.playerId!, closedAt: null },
      select: { workersAssigned: true },
    });
    const companyWorkers = companies.reduce((sum, c) => sum + c.workersAssigned, 0);

    if (workersElsewhere + companyWorkers + desired > settlement.population!.count) {
      res.status(400).json({ error: "Not enough available population for that many workers" });
      return;
    }
  }

  await prisma.building.update({
    where: { id: building.id },
    data: { workersAssigned: desired },
  });

  res.json({ ok: true, workersAssigned: desired });
});

gameRouter.post("/buildings/:id/upgrade", async (req: AuthedRequest, res) => {
  const settlement = await loadOwnedSettlement(req.playerId!);
  if (!settlement) {
    res.status(404).json({ error: "No settlement found for this player" });
    return;
  }

  const building = settlement.buildings.find((b) => b.id === req.params.id);
  if (!building) {
    res.status(404).json({ error: "Building not found" });
    return;
  }

  const config = getConfig();
  const def = config.BUILDING_TYPES[building.type as BuildingTypeId];
  const cost = computeBuildingUpgradeCost(def, building.level, config.BUILDING_UPGRADE_TUNING);
  if (cost === null) {
    res.status(400).json({ error: "Already at max level" });
    return;
  }

  for (const resourceType of RESOURCE_TYPES) {
    const need = cost[resourceType] ?? 0;
    if (settlement[resourceType] < need) {
      res.status(400).json({ error: `Not enough ${resourceType} to upgrade ${def.name} (need ${need.toFixed(0)})` });
      return;
    }
  }

  const resourceUpdate: Partial<Record<ResourceType, number>> = {};
  for (const resourceType of RESOURCE_TYPES) {
    const need = cost[resourceType] ?? 0;
    if (need > 0) resourceUpdate[resourceType] = settlement[resourceType] - need;
  }

  const level = building.level + 1;
  await prisma.$transaction([
    prisma.settlement.update({ where: { id: settlement.id }, data: resourceUpdate }),
    prisma.building.update({ where: { id: building.id }, data: { level } }),
  ]);

  res.json({ ok: true, level });
});
