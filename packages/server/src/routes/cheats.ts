import { Router } from "express";
import { z } from "zod";
import { RESOURCE_TYPES, type ResourceType } from "@dominion/shared";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/index.js";
import { runTick } from "../simulation/engine.js";

const CHEATS_ENABLED = process.env.ENABLE_CHEATS === "true";

export const cheatsRouter = Router();

// Always reachable (even with cheats off) so the client can check without
// auth and simply not render the menu — but every other route below 404s
// outright when disabled, so it's indistinguishable from not existing.
cheatsRouter.get("/status", (_req, res) => {
  res.json({ enabled: CHEATS_ENABLED });
});

cheatsRouter.use((_req, res, next) => {
  if (!CHEATS_ENABLED) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
});

cheatsRouter.use(requireAuth);

const resourceSchema = z.object({
  food: z.number().optional(),
  wood: z.number().optional(),
  stone: z.number().optional(),
  gold: z.number().optional(),
});

cheatsRouter.post("/resources", async (req: AuthedRequest, res) => {
  const parsed = resourceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const settlement = await prisma.settlement.findUnique({ where: { playerId: req.playerId! } });
  if (!settlement) {
    res.status(404).json({ error: "No settlement found" });
    return;
  }

  const data: Partial<Record<ResourceType, number>> = {};
  for (const r of RESOURCE_TYPES) {
    const delta = parsed.data[r];
    if (delta) data[r] = Math.max(0, settlement[r] + delta);
  }

  await prisma.settlement.update({ where: { id: settlement.id }, data });
  res.json({ ok: true });
});

const populationSchema = z.object({ amount: z.number() });

cheatsRouter.post("/population", async (req: AuthedRequest, res) => {
  const parsed = populationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const settlement = await prisma.settlement.findUnique({ where: { playerId: req.playerId! } });
  if (!settlement) {
    res.status(404).json({ error: "No settlement found" });
    return;
  }
  const population = await prisma.population.findUnique({ where: { settlementId: settlement.id } });
  if (!population) {
    res.status(404).json({ error: "No population record found" });
    return;
  }

  await prisma.population.update({
    where: { settlementId: settlement.id },
    data: { count: Math.max(1, population.count + parsed.data.amount) },
  });
  res.json({ ok: true });
});

cheatsRouter.post("/tick", async (_req, res) => {
  const result = await runTick();
  res.json({ ok: true, ...result });
});

const companyCashSchema = z.object({ companyId: z.string(), amount: z.number() });

cheatsRouter.post("/company-cash", async (req: AuthedRequest, res) => {
  const parsed = companyCashSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const company = await prisma.company.findUnique({ where: { id: parsed.data.companyId } });
  if (!company || company.ownerId !== req.playerId) {
    res.status(404).json({ error: "Company not found" });
    return;
  }

  await prisma.company.update({
    where: { id: company.id },
    data: { cash: Math.max(0, company.cash + parsed.data.amount) },
  });
  res.json({ ok: true });
});

const offlineSchema = z.object({ hours: z.number().positive() });

// Rewinds this player's lastSeenAt/settlement lastTickAt by N hours, then
// forces an immediate tick — so the settlement genuinely accrues that time
// (real production/consumption over the window, not a fabricated summary)
// and the next /game/state fetch shows a real "welcome back" modal.
cheatsRouter.post("/simulate-offline", async (req: AuthedRequest, res) => {
  const parsed = offlineSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const shiftMs = parsed.data.hours * 60 * 60 * 1000;
  const player = await prisma.player.findUnique({ where: { id: req.playerId! } });
  const settlement = await prisma.settlement.findUnique({ where: { playerId: req.playerId! } });
  if (!player || !settlement) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  await prisma.player.update({
    where: { id: player.id },
    data: { lastSeenAt: new Date(player.lastSeenAt.getTime() - shiftMs) },
  });
  await prisma.settlement.update({
    where: { id: settlement.id },
    data: { lastTickAt: new Date(settlement.lastTickAt.getTime() - shiftMs) },
  });

  await runTick();
  res.json({ ok: true });
});
