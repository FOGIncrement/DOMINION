import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/index.js";

export const depositsRouter = Router();
depositsRouter.use(requireAuth);

depositsRouter.get("/mine", async (req: AuthedRequest, res) => {
  const deposits = await prisma.deposit.findMany({
    where: { playerId: req.playerId! },
    include: { bank: true },
    orderBy: { createdAt: "desc" },
  });

  res.json({
    deposits: deposits.map((d) => ({
      id: d.id,
      bankId: d.bankId,
      bankName: d.bank.name,
      bankCash: d.bank.cash,
      amount: d.amount,
      interestRatePerHour: d.interestRatePerHour,
      createdAt: d.createdAt,
    })),
  });
});

const withdrawSchema = z.object({ amount: z.number().positive() });

depositsRouter.post("/:id/withdraw", async (req: AuthedRequest, res) => {
  const parsed = withdrawSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid amount" });
    return;
  }

  const deposit = await prisma.deposit.findUnique({ where: { id: req.params.id }, include: { bank: true } });
  if (!deposit || deposit.playerId !== req.playerId) {
    res.status(404).json({ error: "Deposit not found" });
    return;
  }

  const settlement = await prisma.settlement.findUnique({ where: { playerId: req.playerId! } });
  if (!settlement) {
    res.status(404).json({ error: "No settlement found for this player" });
    return;
  }

  // Capped at the deposit's own balance — but also at the bank's actual
  // liquid cash, which may be lower if the bank has lent heavily against
  // its deposits. A real liquidity constraint, not a special case.
  const withdrawAmount = Math.min(parsed.data.amount, deposit.amount);
  if (withdrawAmount > deposit.bank.cash) {
    res.status(400).json({
      error: `This bank only has ${deposit.bank.cash.toFixed(0)}g of liquid cash right now — try a smaller withdrawal`,
    });
    return;
  }

  await prisma.$transaction([
    prisma.settlement.update({ where: { id: settlement.id }, data: { gold: settlement.gold + withdrawAmount } }),
    prisma.deposit.update({ where: { id: deposit.id }, data: { amount: deposit.amount - withdrawAmount } }),
    prisma.bank.update({ where: { id: deposit.bankId }, data: { cash: { decrement: withdrawAmount } } }),
  ]);

  res.json({ ok: true, withdrawn: withdrawAmount, remainingBalance: deposit.amount - withdrawAmount });
});
