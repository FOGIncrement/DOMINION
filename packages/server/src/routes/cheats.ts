import { Router } from "express";
import { z } from "zod";
import { RESOURCE_TYPES, type ResourceType } from "@dominion/shared";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/index.js";
import { runTickSafely } from "../scheduler.js";

const CHEATS_ENABLED = process.env.ENABLE_CHEATS === "true";

// runTickSafely no-ops if the background scheduler is mid-tick (avoids the
// two racing and clobbering each other's writes) — retry briefly rather
// than silently doing nothing when a cheat button is clicked.
async function forceTick() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const result = await runTickSafely();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("Could not force a tick — the scheduler stayed busy");
}

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
  const result = await forceTick();
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

// Rewinds this player's lastSeenAt, and every settlement/company/loan/
// deposit/contract/the shared world clock, by N hours, then forces one tick
// — simulating the whole world having been asleep for N hours, not just
// this player's own settlement. That's required, not optional: the shared
// market/stock pricing reacts to aggregate flows across everyone, so if only
// this player's settlement were backdated, the price-step would scale as if
// N hours passed while the supply/demand data behind it still only
// reflected one normal tick's worth of everyone else's activity.
//
// NOTE: any new tick-accrued entity (its own "lastXAt" timestamp checked
// against `now` in engine.ts) needs a matching backdate here, or this cheat
// will silently under-simulate it — bit twice already (deposits, then
// contracts) before this comment existed.
cheatsRouter.post("/simulate-offline", async (req: AuthedRequest, res) => {
  const parsed = offlineSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const shiftMs = parsed.data.hours * 60 * 60 * 1000;
  const player = await prisma.player.findUnique({ where: { id: req.playerId! } });
  if (!player) {
    res.status(404).json({ error: "Player not found" });
    return;
  }

  const [settlements, companies, loans, deposits, contracts, worldState] = await Promise.all([
    prisma.settlement.findMany({ select: { id: true, lastTickAt: true } }),
    prisma.company.findMany({ select: { id: true, lastTickAt: true } }),
    prisma.loan.findMany({ where: { defaultedAt: null }, select: { id: true, lastAccrualAt: true } }),
    prisma.deposit.findMany({ select: { id: true, lastAccrualAt: true } }),
    prisma.contract.findMany({ where: { cancelledAt: null }, select: { id: true, lastSettledAt: true } }),
    prisma.worldState.findUnique({ where: { id: 1 } }),
  ]);

  await Promise.all([
    prisma.player.update({
      where: { id: player.id },
      data: { lastSeenAt: new Date(player.lastSeenAt.getTime() - shiftMs) },
    }),
    ...settlements.map((s) =>
      prisma.settlement.update({
        where: { id: s.id },
        data: { lastTickAt: new Date(s.lastTickAt.getTime() - shiftMs) },
      }),
    ),
    ...companies.map((c) =>
      prisma.company.update({
        where: { id: c.id },
        data: { lastTickAt: new Date(c.lastTickAt.getTime() - shiftMs) },
      }),
    ),
    ...loans.map((l) =>
      prisma.loan.update({
        where: { id: l.id },
        data: { lastAccrualAt: new Date(l.lastAccrualAt.getTime() - shiftMs) },
      }),
    ),
    ...deposits.map((d) =>
      prisma.deposit.update({
        where: { id: d.id },
        data: { lastAccrualAt: new Date(d.lastAccrualAt.getTime() - shiftMs) },
      }),
    ),
    ...contracts.map((c) =>
      prisma.contract.update({
        where: { id: c.id },
        data: { lastSettledAt: new Date(c.lastSettledAt.getTime() - shiftMs) },
      }),
    ),
    prisma.worldState.upsert({
      where: { id: 1 },
      update: { lastTickAt: new Date((worldState?.lastTickAt ?? new Date()).getTime() - shiftMs) },
      create: { id: 1, lastTickAt: new Date(Date.now() - shiftMs) },
    }),
  ]);

  await forceTick();
  res.json({ ok: true });
});
