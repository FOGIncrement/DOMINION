import { Router } from "express";
import { z } from "zod";
import { BANK_TUNING } from "@dominion/shared";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/index.js";
import { getControllingPlayerId } from "../simulation/control.js";

export const banksRouter = Router();

banksRouter.get("/", async (_req, res) => {
  const banks = await prisma.bank.findMany({ orderBy: { foundedAt: "asc" } });
  res.json({
    banks: banks.map((b) => ({
      id: b.id,
      name: b.name,
      cash: Math.round(b.cash),
      interestRatePerHour: b.interestRatePerHour,
      isPlayerOwned: b.ownerId !== null,
      foundedAt: b.foundedAt,
    })),
  });
});

banksRouter.use(requireAuth);

const foundSchema = z.object({ name: z.string().min(2).max(60) });

banksRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = foundSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const settlement = await prisma.settlement.findUnique({ where: { playerId: req.playerId! } });
  if (!settlement) {
    res.status(404).json({ error: "No settlement found for this player" });
    return;
  }
  if (settlement.gold < BANK_TUNING.foundingCost) {
    res.status(400).json({ error: `Need ${BANK_TUNING.foundingCost} gold to found a bank` });
    return;
  }

  const [, bank] = await prisma.$transaction([
    prisma.settlement.update({
      where: { id: settlement.id },
      data: { gold: settlement.gold - BANK_TUNING.foundingCost },
    }),
    prisma.bank.create({
      data: {
        ownerId: req.playerId!,
        name: parsed.data.name,
        cash: BANK_TUNING.foundingCost,
        interestRatePerHour: 0.002,
      },
    }),
  ]);

  res.status(201).json({ ok: true, bankId: bank.id });
});

banksRouter.get("/mine", async (req: AuthedRequest, res) => {
  const banks = await prisma.bank.findMany({
    where: { ownerId: req.playerId! },
    include: { loans: { where: { defaultedAt: null }, include: { company: true } } },
  });
  res.json({
    banks: banks.map((b) => ({
      id: b.id,
      name: b.name,
      cash: b.cash,
      interestRatePerHour: b.interestRatePerHour,
      foundedAt: b.foundedAt,
      loansIssued: b.loans.map((l) => ({
        id: l.id,
        companyName: l.company.name,
        principal: l.principal,
        outstandingBalance: l.outstandingBalance,
        interestRatePerHour: l.interestRatePerHour,
      })),
    })),
  });
});

const requestLoanSchema = z.object({ companyId: z.string(), amount: z.number().positive() });

banksRouter.post("/:bankId/loans", async (req: AuthedRequest, res) => {
  const parsed = requestLoanSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid loan request" });
    return;
  }

  const bank = await prisma.bank.findUnique({ where: { id: req.params.bankId } });
  if (!bank) {
    res.status(404).json({ error: "Bank not found" });
    return;
  }

  const company = await prisma.company.findUnique({ where: { id: parsed.data.companyId } });
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }
  if ((await getControllingPlayerId(company)) !== req.playerId) {
    res.status(403).json({ error: "You don't control this company" });
    return;
  }

  const { amount } = parsed.data;
  if (amount > bank.cash) {
    res.status(400).json({ error: "This bank doesn't have enough reserve cash for that loan" });
    return;
  }
  const maxLoan = company.cash * BANK_TUNING.maxLoanToCashRatio;
  if (amount > maxLoan) {
    res.status(400).json({
      error: `Credit check failed — this company can borrow at most ${maxLoan.toFixed(0)} gold (${BANK_TUNING.maxLoanToCashRatio}x its cash)`,
    });
    return;
  }

  const [, loan] = await prisma.$transaction([
    prisma.bank.update({ where: { id: bank.id }, data: { cash: bank.cash - amount } }),
    prisma.loan.create({
      data: {
        bankId: bank.id,
        companyId: company.id,
        principal: amount,
        outstandingBalance: amount,
        interestRatePerHour: bank.interestRatePerHour,
      },
    }),
    prisma.company.update({ where: { id: company.id }, data: { cash: company.cash + amount } }),
  ]);

  res.status(201).json({ ok: true, loanId: loan.id });
});
