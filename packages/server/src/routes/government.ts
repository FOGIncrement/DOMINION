import { Router } from "express";
import { z } from "zod";
import { computeUnemployment, computeWelfareCostPerHour } from "@dominion/shared";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/index.js";
import { getControllingPlayerId } from "../simulation/control.js";

export const governmentRouter = Router();
governmentRouter.use(requireAuth);

const MAX_RATE = 0.5;
const MAX_WELFARE_RATE = 5;

/**
 * Government rows are normally created at registration (routes/auth.ts), but
 * any account created before that code existed has no row at all and would
 * otherwise 404 forever with no way to recover — upsert makes every route
 * here self-healing instead of relying on a one-time migration script.
 */
function getOrCreateGovernment(playerId: string) {
  return prisma.government.upsert({ where: { playerId }, update: {}, create: { playerId } });
}

governmentRouter.get("/mine", async (req: AuthedRequest, res) => {
  const playerId = req.playerId!;
  const government = await getOrCreateGovernment(playerId);

  const settlement = await prisma.settlement.findUnique({
    where: { playerId },
    include: { population: true, buildings: true },
  });
  const companies = await prisma.company.findMany({ where: { ownerId: playerId, closedAt: null } });

  const buildingWorkers = settlement?.buildings.reduce((sum, b) => sum + b.workersAssigned, 0) ?? 0;
  const companyWorkers = companies.reduce((sum, c) => sum + c.workersAssigned, 0);
  const populationCount = settlement?.population?.count ?? 0;
  const employedCount = buildingWorkers + companyWorkers;
  const unemployedCount = computeUnemployment(populationCount, employedCount);

  res.json({
    treasury: government.treasury,
    incomeTaxRate: government.incomeTaxRate,
    corporateTaxRate: government.corporateTaxRate,
    welfareRatePerUnemployedPerHour: government.welfareRatePerUnemployedPerHour,
    maxRate: MAX_RATE,
    maxWelfareRate: MAX_WELFARE_RATE,
    populationCount,
    employedCount,
    unemployedCount,
    welfareCostPerHour: computeWelfareCostPerHour(unemployedCount, government.welfareRatePerUnemployedPerHour),
  });
});

const ratesSchema = z.object({
  incomeTaxRate: z.number().min(0).max(MAX_RATE).optional(),
  corporateTaxRate: z.number().min(0).max(MAX_RATE).optional(),
  welfareRatePerUnemployedPerHour: z.number().min(0).max(MAX_WELFARE_RATE).optional(),
});

governmentRouter.post("/rates", async (req: AuthedRequest, res) => {
  const parsed = ratesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: `Tax rates must be between 0 and ${MAX_RATE}, welfare rate between 0 and ${MAX_WELFARE_RATE}` });
    return;
  }

  const government = await getOrCreateGovernment(req.playerId!);

  await prisma.government.update({
    where: { id: government.id },
    data: {
      incomeTaxRate: parsed.data.incomeTaxRate ?? government.incomeTaxRate,
      corporateTaxRate: parsed.data.corporateTaxRate ?? government.corporateTaxRate,
      welfareRatePerUnemployedPerHour:
        parsed.data.welfareRatePerUnemployedPerHour ?? government.welfareRatePerUnemployedPerHour,
    },
  });
  res.json({ ok: true });
});

const subsidizeSchema = z.object({ companyId: z.string(), amount: z.number().positive() });

governmentRouter.post("/subsidize", async (req: AuthedRequest, res) => {
  const parsed = subsidizeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid subsidy request" });
    return;
  }

  const government = await getOrCreateGovernment(req.playerId!);
  if (government.treasury < parsed.data.amount) {
    res.status(400).json({ error: "Not enough treasury funds" });
    return;
  }

  const company = await prisma.company.findUnique({ where: { id: parsed.data.companyId } });
  if (!company || company.closedAt) {
    res.status(404).json({ error: "Company not found" });
    return;
  }
  if ((await getControllingPlayerId(company)) !== req.playerId) {
    res.status(403).json({ error: "You don't control this company" });
    return;
  }

  await prisma.$transaction([
    prisma.government.update({
      where: { id: government.id },
      data: { treasury: government.treasury - parsed.data.amount },
    }),
    prisma.company.update({ where: { id: company.id }, data: { cash: company.cash + parsed.data.amount } }),
  ]);

  res.json({ ok: true });
});
