import { Router } from "express";
import { z } from "zod";
import { RESOURCE_TYPES, type ResourceType } from "@dominion/shared";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/index.js";
import { requireAdmin } from "../auth/requireAdmin.js";
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

// Both this AND ENABLE_CHEATS are required — closes the previous gap where
// any authenticated player could use these once the env flag was on.
cheatsRouter.use(requireAuth);
cheatsRouter.use(requireAdmin);

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

// Chunked (not one giant shift) so per-tick PROBABILITY mechanics
// (NPC hiring/founding/upgrading, dividends, NPC investor actions, random
// events) get re-rolled once per simulated hour instead of once for the
// whole request, and per-tick-CAPPED mechanics (market/share price drift,
// force layoffs) get to take multiple steps toward a moving target instead
// of one. 1 hour (not the scheduler's real 1-minute cadence) trades some
// statistical precision for keeping the total number of full-DB tick
// passes bounded — MAX_SIMULATE_OFFLINE_HOURS keeps worst-case request
// latency reasonable at that granularity.
const SIMULATE_CHUNK_HOURS = 1;
const MAX_SIMULATE_OFFLINE_HOURS = 168; // 7 days

const offlineSchema = z.object({ hours: z.number().positive().max(MAX_SIMULATE_OFFLINE_HOURS) });

// Rewinds every settlement/company/loan/deposit/contract/the shared world
// clock by shiftMs — simulating the whole world having been asleep for
// that long, not just one player's own settlement. That's required, not
// optional: the shared market/stock pricing reacts to aggregate flows
// across everyone, so if only one settlement were backdated, the
// price-step would scale as if real time passed while the supply/demand
// data behind it still only reflected one normal tick's worth of
// everyone else's activity. Called once per chunk with that chunk's own
// (smaller) shiftMs, not once with the whole request's total.
//
// NOTE: any new ROLLING "lastXAt" tick-accrued field (checked as an
// elapsed-time gap against `now` in engine.ts) needs a matching backdate
// here, or this cheat will silently under-simulate it — bit twice already
// (deposits, then contracts) before this comment existed. A field that's
// instead an ABSOLUTE FUTURE deadline (compared directly against `now`,
// not as an elapsed gap) belongs in shiftAbsoluteMaturityTimestamps below,
// not here — backdating a rolling tracker does nothing for those, since
// `now` itself never changes.
async function backdateAccrualTimestamps(shiftMs: number) {
  const [settlements, companies, loans, deposits, contracts, worldState] = await Promise.all([
    prisma.settlement.findMany({ select: { id: true, lastTickAt: true } }),
    prisma.company.findMany({ select: { id: true, lastTickAt: true } }),
    prisma.loan.findMany({ where: { defaultedAt: null }, select: { id: true, lastAccrualAt: true } }),
    prisma.deposit.findMany({ select: { id: true, lastAccrualAt: true } }),
    prisma.contract.findMany({
      where: { cancelledAt: null, acceptedAt: { not: null } },
      select: { id: true, lastSettledAt: true },
    }),
    prisma.worldState.findUnique({ where: { id: 1 } }),
  ]);

  await Promise.all([
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
}

// Absolute future deadlines — Bond/CorporateBond maturity, ZoneProject
// completion, Loan maturity — are compared directly against `now` in
// engine.ts, not measured as an elapsed gap from a rolling tracker, so
// backdating a "lastXAt" field does nothing for them: `now` never changes
// regardless of how the cheat runs. The correct analogy for "N hours have
// passed" is that a deadline N hours in the future is now N hours closer —
// shift the deadline itself backward. Runs ONCE with the TOTAL requested
// shift, never per-chunk (unlike backdateAccrualTimestamps above) — these
// aren't reset to "now" by a tick the way rolling trackers are, so
// shifting them once per chunk would over-shift by chunkCount x the
// intended amount.
async function shiftAbsoluteMaturityTimestamps(totalShiftMs: number) {
  const [bonds, corporateBonds, zoneProjects, loans] = await Promise.all([
    prisma.bond.findMany({ where: { redeemedAt: null }, select: { id: true, maturesAt: true } }),
    prisma.corporateBond.findMany({ where: { redeemedAt: null }, select: { id: true, maturesAt: true } }),
    prisma.zoneProject.findMany({
      where: { completedAt: null, cancelledAt: null, completesAt: { not: null } },
      select: { id: true, completesAt: true },
    }),
    prisma.loan.findMany({
      where: { defaultedAt: null, maturityAt: { not: null } },
      select: { id: true, maturityAt: true },
    }),
  ]);

  await Promise.all([
    ...bonds.map((b) =>
      prisma.bond.update({
        where: { id: b.id },
        data: { maturesAt: new Date(b.maturesAt.getTime() - totalShiftMs) },
      }),
    ),
    ...corporateBonds.map((b) =>
      prisma.corporateBond.update({
        where: { id: b.id },
        data: { maturesAt: new Date(b.maturesAt.getTime() - totalShiftMs) },
      }),
    ),
    ...zoneProjects.map((z) =>
      prisma.zoneProject.update({
        where: { id: z.id },
        data: { completesAt: new Date(z.completesAt!.getTime() - totalShiftMs) },
      }),
    ),
    ...loans.map((l) =>
      prisma.loan.update({
        where: { id: l.id },
        data: { maturityAt: new Date(l.maturityAt!.getTime() - totalShiftMs) },
      }),
    ),
  ]);
}

cheatsRouter.post("/simulate-offline", async (req: AuthedRequest, res) => {
  const parsed = offlineSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const totalHours = parsed.data.hours;
  const totalShiftMs = totalHours * 60 * 60 * 1000;

  const player = await prisma.player.findUnique({ where: { id: req.playerId! } });
  if (!player) {
    res.status(404).json({ error: "Player not found" });
    return;
  }
  await prisma.player.update({
    where: { id: player.id },
    data: { lastSeenAt: new Date(player.lastSeenAt.getTime() - totalShiftMs) },
  });

  await shiftAbsoluteMaturityTimestamps(totalShiftMs);

  let remainingHours = totalHours;
  let chunksProcessed = 0;
  while (remainingHours > 0) {
    const chunkHours = Math.min(SIMULATE_CHUNK_HOURS, remainingHours);
    await backdateAccrualTimestamps(chunkHours * 60 * 60 * 1000);
    await forceTick();
    remainingHours -= chunkHours;
    chunksProcessed++;
  }

  res.json({ ok: true, chunksProcessed });
});
