import { Router } from "express";
import { z } from "zod";
import { BOND_TERM_OPTIONS, computeBondRate, computeBondRedemptionValue } from "@dominion/shared";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/index.js";

export const bondsRouter = Router();
bondsRouter.use(requireAuth);

bondsRouter.get("/governments", async (req: AuthedRequest, res) => {
  const governments = await prisma.government.findMany({
    include: { player: { include: { settlement: true } } },
  });

  res.json({
    governments: governments
      .filter((g) => g.playerId !== req.playerId)
      .map((g) => ({
        id: g.id,
        name: g.player.settlement?.name ?? "A player's nation",
        treasury: g.treasury,
      })),
  });
});

const buySchema = z.object({
  governmentId: z.string(),
  amount: z.number().positive(),
  termHours: z.number().int().positive(),
});

// A player can't buy their own government's bonds — treasury funds the
// principal on issuance and pays back principal + interest at maturity, so a
// self-purchase would just be a free, riskless way to mint gold out of your
// own treasury (deposit gold in, get more gold back, at your own government's
// expense with no counterparty). "A company can't contract with itself" in
// contracts.ts is the same idea applied to a different self-dealing loop.
bondsRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = buySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid bond purchase request" });
    return;
  }
  const termOption = BOND_TERM_OPTIONS.find((t) => t.hours === parsed.data.termHours);
  if (!termOption) {
    res.status(400).json({ error: "Not a valid bond term" });
    return;
  }

  const government = await prisma.government.findUnique({ where: { id: parsed.data.governmentId } });
  if (!government) {
    res.status(404).json({ error: "Government not found" });
    return;
  }
  if (government.playerId === req.playerId) {
    res.status(400).json({ error: "Can't buy your own government's bonds" });
    return;
  }

  const settlement = await prisma.settlement.findUnique({ where: { playerId: req.playerId! } });
  if (!settlement) {
    res.status(404).json({ error: "No settlement found for this player" });
    return;
  }
  if (settlement.gold < parsed.data.amount) {
    res.status(400).json({ error: "Not enough settlement gold for that purchase" });
    return;
  }

  const interestRatePerHour = computeBondRate(termOption.hours);
  const now = new Date();
  const maturesAt = new Date(now.getTime() + termOption.hours * 60 * 60 * 1000);

  const [, bond] = await prisma.$transaction([
    prisma.settlement.update({ where: { id: settlement.id }, data: { gold: settlement.gold - parsed.data.amount } }),
    prisma.bond.create({
      data: {
        governmentId: government.id,
        holderId: req.playerId!,
        principal: parsed.data.amount,
        interestRatePerHour,
        termHours: termOption.hours,
        maturesAt,
      },
    }),
    prisma.government.update({ where: { id: government.id }, data: { treasury: { increment: parsed.data.amount } } }),
  ]);

  res.status(201).json({ ok: true, bondId: bond.id, interestRatePerHour, maturesAt });
});

bondsRouter.get("/mine", async (req: AuthedRequest, res) => {
  const bonds = await prisma.bond.findMany({
    where: { holderId: req.playerId! },
    include: { government: { include: { player: { include: { settlement: true } } } } },
    orderBy: { issuedAt: "desc" },
  });

  res.json({
    bonds: bonds.map((b) => ({
      id: b.id,
      governmentName: b.government.player.settlement?.name ?? "A player's nation",
      principal: b.principal,
      interestRatePerHour: b.interestRatePerHour,
      termHours: b.termHours,
      issuedAt: b.issuedAt,
      maturesAt: b.maturesAt,
      redeemedAt: b.redeemedAt,
      redemptionValue: computeBondRedemptionValue(b.principal, b.interestRatePerHour, b.termHours),
    })),
  });
});
