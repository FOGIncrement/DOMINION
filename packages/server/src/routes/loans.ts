import { Router } from "express";
import { z } from "zod";
import { BANK_TUNING } from "@dominion/shared";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/index.js";

export const loansRouter = Router();
loansRouter.use(requireAuth);

function defaultRisk(outstandingBalance: number, principal: number): "low" | "medium" | "high" {
  const ratio = outstandingBalance / principal;
  if (ratio > BANK_TUNING.defaultMultiplier * 0.8) return "high";
  if (ratio > BANK_TUNING.defaultMultiplier * 0.5) return "medium";
  return "low";
}

loansRouter.get("/mine", async (req: AuthedRequest, res) => {
  const companies = await prisma.company.findMany({ where: { ownerId: req.playerId! }, select: { id: true } });
  const companyIds = companies.map((c) => c.id);

  const loans = await prisma.loan.findMany({
    where: { companyId: { in: companyIds } },
    include: { bank: true, company: true },
    orderBy: { createdAt: "desc" },
  });

  res.json({
    loans: loans.map((l) => ({
      id: l.id,
      bankName: l.bank.name,
      companyId: l.companyId,
      companyName: l.company.name,
      principal: l.principal,
      outstandingBalance: l.outstandingBalance,
      interestRatePerHour: l.interestRatePerHour,
      defaultedAt: l.defaultedAt,
      risk: l.defaultedAt ? "defaulted" : defaultRisk(l.outstandingBalance, l.principal),
      createdAt: l.createdAt,
    })),
  });
});

const repaySchema = z.object({ amount: z.number().positive() });

loansRouter.post("/:id/repay", async (req: AuthedRequest, res) => {
  const parsed = repaySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid amount" });
    return;
  }

  const loan = await prisma.loan.findUnique({ where: { id: req.params.id }, include: { company: true } });
  if (!loan || loan.company.ownerId !== req.playerId) {
    res.status(404).json({ error: "Loan not found" });
    return;
  }
  if (loan.defaultedAt) {
    res.status(400).json({ error: "This loan has already defaulted" });
    return;
  }

  const payment = Math.min(parsed.data.amount, loan.outstandingBalance);
  if (loan.company.cash < payment) {
    res.status(400).json({ error: "Not enough company cash to make that payment" });
    return;
  }

  await prisma.$transaction([
    prisma.company.update({ where: { id: loan.companyId }, data: { cash: loan.company.cash - payment } }),
    prisma.loan.update({ where: { id: loan.id }, data: { outstandingBalance: loan.outstandingBalance - payment } }),
    prisma.bank.update({ where: { id: loan.bankId }, data: { cash: { increment: payment } } }),
  ]);

  res.json({ ok: true, remainingBalance: loan.outstandingBalance - payment });
});
