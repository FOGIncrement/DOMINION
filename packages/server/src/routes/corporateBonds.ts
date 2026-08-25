import { Router } from "express";
import { z } from "zod";
import { BOND_TERM_OPTIONS, computeBondRedemptionValue, computeCorporateBondRate, computeMaxLoanAmount } from "@dominion/shared";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/index.js";
import { getControllingPlayerId } from "../simulation/control.js";

export const corporateBondsRouter = Router();
corporateBondsRouter.use(requireAuth);

corporateBondsRouter.get("/companies", async (req: AuthedRequest, res) => {
  const companies = await prisma.company.findMany({ where: { closedAt: null } });
  const withControl = await Promise.all(
    companies.map(async (c) => ({
      id: c.id,
      name: c.name,
      industry: c.industry,
      cash: c.cash,
      maxIssuance: computeMaxLoanAmount(c.cash),
      controlledByMe: (await getControllingPlayerId(c)) === req.playerId,
    })),
  );

  res.json({
    companies: withControl
      .filter((c) => !c.controlledByMe)
      .map((c) => ({ id: c.id, name: c.name, industry: c.industry, cash: c.cash, maxIssuance: c.maxIssuance })),
  });
});

const buySchema = z.object({
  companyId: z.string(),
  amount: z.number().positive(),
  termHours: z.number().int().positive(),
});

// A player can't buy their own company's bonds — same self-dealing guard as
// government bonds. Without it, a player could move gold from their own
// settlement into their own company as bond principal and redeem it back
// with interest funded by nothing, since both sides are the same economic
// actor.
corporateBondsRouter.post("/", async (req: AuthedRequest, res) => {
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

  const company = await prisma.company.findUnique({ where: { id: parsed.data.companyId } });
  if (!company || company.closedAt) {
    res.status(404).json({ error: "Company not found" });
    return;
  }
  if ((await getControllingPlayerId(company)) === req.playerId) {
    res.status(400).json({ error: "Can't buy your own company's bonds" });
    return;
  }

  // Same credit-limit idiom as a bank loan (computeMaxLoanAmount, 5x cash) —
  // a company can't raise arbitrarily large debt regardless of size. Like
  // loans, this doesn't account for other debt already outstanding on the
  // company (existing loans or bonds) — matching that existing simplification
  // rather than introducing a stricter, inconsistent cap just for bonds.
  const maxIssuance = computeMaxLoanAmount(company.cash);
  if (parsed.data.amount > maxIssuance) {
    res.status(400).json({
      error: `This company can only raise up to ${maxIssuance.toFixed(0)} gold in bonds right now (5x its cash)`,
    });
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

  const interestRatePerHour = computeCorporateBondRate(termOption.hours, parsed.data.amount, company.cash);
  const now = new Date();
  const maturesAt = new Date(now.getTime() + termOption.hours * 60 * 60 * 1000);

  const [, bond] = await prisma.$transaction([
    prisma.settlement.update({ where: { id: settlement.id }, data: { gold: settlement.gold - parsed.data.amount } }),
    prisma.corporateBond.create({
      data: {
        companyId: company.id,
        holderId: req.playerId!,
        principal: parsed.data.amount,
        interestRatePerHour,
        termHours: termOption.hours,
        maturesAt,
      },
    }),
    prisma.company.update({ where: { id: company.id }, data: { cash: { increment: parsed.data.amount } } }),
  ]);

  res.status(201).json({ ok: true, bondId: bond.id, interestRatePerHour, maturesAt });
});

corporateBondsRouter.get("/mine", async (req: AuthedRequest, res) => {
  const bonds = await prisma.corporateBond.findMany({
    where: { holderId: req.playerId! },
    include: { company: true },
    orderBy: { issuedAt: "desc" },
  });

  res.json({
    bonds: bonds.map((b) => ({
      id: b.id,
      companyId: b.companyId,
      companyName: b.company.name,
      companyClosed: b.company.closedAt !== null,
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
