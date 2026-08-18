import { Router } from "express";
import { z } from "zod";
import { RESOURCE_TYPES, TECHS, TECH_IDS, type ResourceType } from "@dominion/shared";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/index.js";

export const techRouter = Router();
techRouter.use(requireAuth);

techRouter.get("/", async (req: AuthedRequest, res) => {
  const settlement = await prisma.settlement.findUnique({
    where: { playerId: req.playerId! },
    include: { techs: true },
  });
  if (!settlement) {
    res.status(404).json({ error: "No settlement found for this player" });
    return;
  }

  const researched = new Set(settlement.techs.map((t) => t.techId));

  res.json({
    techs: Object.values(TECHS).map((tech) => ({
      ...tech,
      researched: researched.has(tech.id),
      available: !tech.requiredTech || researched.has(tech.requiredTech),
    })),
  });
});

const researchSchema = z.object({ techId: z.enum(TECH_IDS) });

techRouter.post("/research", async (req: AuthedRequest, res) => {
  const parsed = researchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid technology" });
    return;
  }

  const settlement = await prisma.settlement.findUnique({
    where: { playerId: req.playerId! },
    include: { techs: true },
  });
  if (!settlement) {
    res.status(404).json({ error: "No settlement found for this player" });
    return;
  }

  const tech = TECHS[parsed.data.techId];
  if (settlement.techs.some((t) => t.techId === tech.id)) {
    res.status(400).json({ error: "Already researched" });
    return;
  }
  if (tech.requiredTech && !settlement.techs.some((t) => t.techId === tech.requiredTech)) {
    res.status(400).json({ error: `Requires ${TECHS[tech.requiredTech].name} first` });
    return;
  }

  for (const resourceType of RESOURCE_TYPES) {
    const cost = tech.cost[resourceType] ?? 0;
    if (settlement[resourceType] < cost) {
      res.status(400).json({ error: `Not enough ${resourceType} to research ${tech.name}` });
      return;
    }
  }

  const resourceUpdate: Partial<Record<ResourceType, number>> = {};
  for (const resourceType of RESOURCE_TYPES) {
    const cost = tech.cost[resourceType] ?? 0;
    if (cost > 0) resourceUpdate[resourceType] = settlement[resourceType] - cost;
  }

  await prisma.$transaction([
    prisma.settlement.update({ where: { id: settlement.id }, data: resourceUpdate }),
    prisma.settlementTech.create({ data: { settlementId: settlement.id, techId: tech.id } }),
  ]);

  res.status(201).json({ ok: true });
});
