import { DIVIDEND_TUNING, STOCK_TUNING } from "@dominion/shared";
import { prisma } from "../db.js";

/** Bounded-step drift toward a target price — same shape as tickMarket's price-step logic. */
export function driftSharePrice(currentPrice: number, targetPrice: number): number {
  const base = Math.max(currentPrice, STOCK_TUNING.minSharePrice);
  const maxStep = base * STOCK_TUNING.maxPriceStepPerTick;
  const direction = Math.sign(targetPrice - currentPrice);
  const step = Math.min(Math.abs(targetPrice - currentPrice), maxStep);
  return Math.max(STOCK_TUNING.minSharePrice, currentPrice + direction * step);
}

/**
 * Shares outstanding is a hard cap — buys draw from this "unissued float"
 * (shares authorized at IPO but not yet bought by anyone) rather than
 * minting new shares, and sells return to it. Without this check, every
 * buy call independently creates shares with nothing backing them.
 */
export async function availableShareFloat(companyId: string, sharesOutstanding: number): Promise<number> {
  const result = await prisma.shareholding.aggregate({
    where: { companyId },
    _sum: { shares: true },
  });
  const held = result._sum.shares ?? 0;
  return Math.max(0, sharesOutstanding - held);
}

export async function applyShareTradeImpact(
  companyId: string,
  side: "buy" | "sell",
  shares: number,
  currentPrice: number,
): Promise<number> {
  const direction = side === "buy" ? 1 : -1;
  const impact = currentPrice * STOCK_TUNING.tradeImpact * shares * direction;
  const newPrice = Math.max(STOCK_TUNING.minSharePrice, currentPrice + impact);
  await prisma.company.update({ where: { id: companyId }, data: { sharePrice: newPrice } });
  return newPrice;
}

/**
 * Small chance per tick for a cash-rich public company to pay a dividend,
 * split pro-rata across every shareholder (player settlement gold or NPC
 * investor cash, whichever applies).
 */
export async function maybeDividend(company: { id: string; cash: number; sharesOutstanding: number }): Promise<void> {
  if (company.cash < DIVIDEND_TUNING.cashThreshold) return;
  if (company.sharesOutstanding <= 0) return;
  if (Math.random() > DIVIDEND_TUNING.chancePerTick) return;

  const payout = company.cash * DIVIDEND_TUNING.payoutFraction;
  if (payout <= 0) return;

  const holdings = await prisma.shareholding.findMany({ where: { companyId: company.id } });
  if (holdings.length === 0) return;

  const perShare = payout / company.sharesOutstanding;

  await prisma.company.update({ where: { id: company.id }, data: { cash: { decrement: payout } } });

  for (const holding of holdings) {
    const amount = holding.shares * perShare;
    if (amount <= 0) continue;

    if (holding.playerId) {
      const settlement = await prisma.settlement.findUnique({ where: { playerId: holding.playerId } });
      if (settlement) {
        await prisma.settlement.update({ where: { id: settlement.id }, data: { gold: { increment: amount } } });
      }
    } else if (holding.npcInvestorId) {
      await prisma.npcInvestor.update({ where: { id: holding.npcInvestorId }, data: { cash: { increment: amount } } });
    }
  }
}
