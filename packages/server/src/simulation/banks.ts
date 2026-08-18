import { BANK_TUNING, NPC_BANKING_TUNING } from "@dominion/shared";
import { prisma } from "../db.js";

export interface LoanLike {
  principal: number;
  outstandingBalance: number;
  interestRatePerHour: number;
}

/** Interest compounds on the outstanding balance — same rate×elapsedHours idiom as everywhere else. */
export function accrueLoanInterest(loan: LoanLike, elapsedHours: number): number {
  return loan.outstandingBalance * (1 + loan.interestRatePerHour * elapsedHours);
}

export function isLoanDefaulted(loan: LoanLike): boolean {
  return loan.outstandingBalance > loan.principal * BANK_TUNING.defaultMultiplier;
}

interface MutableCash {
  cash: number;
}

/** Cash-poor NPC company borrows a modest amount from whichever bank has capacity. */
export async function maybeBorrow(companyId: string, state: MutableCash): Promise<void> {
  if (state.cash > NPC_BANKING_TUNING.minCashToConsiderBorrow) return;
  if (Math.random() > NPC_BANKING_TUNING.borrowChancePerTick) return;

  const banks = await prisma.bank.findMany({ orderBy: { cash: "desc" } });
  const bank = banks.find((b) => b.cash > 20);
  if (!bank) return;

  const maxLoan = Math.max(10, state.cash * BANK_TUNING.maxLoanToCashRatio);
  const amount = Math.min(bank.cash, maxLoan) * NPC_BANKING_TUNING.borrowAmountFraction;
  if (amount < 5) return;

  state.cash += amount;
  await prisma.bank.update({ where: { id: bank.id }, data: { cash: { decrement: amount } } });
  await prisma.loan.create({
    data: {
      bankId: bank.id,
      companyId,
      principal: amount,
      outstandingBalance: amount,
      interestRatePerHour: bank.interestRatePerHour,
    },
  });
}

/** Cash-healthy NPC company pays down its largest outstanding loan. */
export async function maybeRepayLoan(companyId: string, state: MutableCash): Promise<void> {
  if (state.cash < 50) return;
  if (Math.random() > NPC_BANKING_TUNING.repayChancePerTick) return;

  const loan = await prisma.loan.findFirst({
    where: { companyId, defaultedAt: null },
    orderBy: { outstandingBalance: "desc" },
  });
  if (!loan) return;

  const payment = Math.min(state.cash * 0.5, loan.outstandingBalance * NPC_BANKING_TUNING.repayFraction);
  if (payment < 1) return;

  state.cash -= payment;
  await prisma.loan.update({ where: { id: loan.id }, data: { outstandingBalance: { decrement: payment } } });
  await prisma.bank.update({ where: { id: loan.bankId }, data: { cash: { increment: payment } } });
}
