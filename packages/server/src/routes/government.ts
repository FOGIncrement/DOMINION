import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/index.js";

export const governmentRouter = Router();
governmentRouter.use(requireAuth);

const MAX_RATE = 0.5;

governmentRouter.get("/mine", async (req: AuthedRequest, res) => {
  const government = await prisma.government.findUnique({ where: { playerId: req.playerId! } });
  if (!government) {
    res.status(404).json({ error: "No government found for this player" });
    return;
  }
  res.json({
    treasury: government.treasury,
    incomeTaxRate: government.incomeTaxRate,
    corporateTaxRate: government.corporateTaxRate,
    maxRate: MAX_RATE,
  });
});

const ratesSchema = z.object({
  incomeTaxRate: z.number().min(0).max(MAX_RATE).optional(),
  corporateTaxRate: z.number().min(0).max(MAX_RATE).optional(),
});

governmentRouter.post("/rates", async (req: AuthedRequest, res) => {
  const parsed = ratesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: `Tax rates must be between 0 and ${MAX_RATE}` });
    return;
  }

  const government = await prisma.government.findUnique({ where: { playerId: req.playerId! } });
  if (!government) {
    res.status(404).json({ error: "No government found for this player" });
    return;
  }

  await prisma.government.update({
    where: { id: government.id },
    data: {
      incomeTaxRate: parsed.data.incomeTaxRate ?? government.incomeTaxRate,
      corporateTaxRate: parsed.data.corporateTaxRate ?? government.corporateTaxRate,
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

  const government = await prisma.government.findUnique({ where: { playerId: req.playerId! } });
  if (!government) {
    res.status(404).json({ error: "No government found for this player" });
    return;
  }
  if (government.treasury < parsed.data.amount) {
    res.status(400).json({ error: "Not enough treasury funds" });
    return;
  }

  const company = await prisma.company.findUnique({ where: { id: parsed.data.companyId } });
  if (!company || company.ownerId !== req.playerId) {
    res.status(404).json({ error: "Company not found" });
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
