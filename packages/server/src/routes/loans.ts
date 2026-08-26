import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/index.js";
import { getConfig } from "../gameConfigStore.js";

export const loansRouter = Router();
loansRouter.use(requireAuth);

// A term loan's real risk signal is proximity to its deadline, not balance
// growth — it defaults the instant maturity passes regardless of how close
// the balance is to the revolving default threshold.
function defaultRisk(
  outstandingBalance: number,
  principal: number,
  maturityAt: Date | null,
  termHours: number | null,
): "low" | "medium" | "high" {
  if (outstandingBalance <= 0) return "low";
  if (maturityAt && termHours) {
    const remainingFraction = (maturityAt.getTime() - Date.now()) / (termHours * 60 * 60 * 1000);
    if (remainingFraction < 0.1) return "high";
    if (remainingFraction < 0.3) return "medium";
    return "low";
  }
  const ratio = outstandingBalance / principal;
  const defaultMultiplier = getConfig().BANK_TUNING.defaultMultiplier;
  if (ratio > defaultMultiplier * 0.8) return "high";
  if (ratio > defaultMultiplier * 0.5) return "medium";
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
      termHours: l.termHours,
      maturityAt: l.maturityAt,
      defaultedAt: l.defaultedAt,
      risk: l.defaultedAt ? "defaulted" : defaultRisk(l.outstandingBalance, l.principal, l.maturityAt, l.termHours),
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
