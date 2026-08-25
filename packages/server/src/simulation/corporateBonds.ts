import { computeBondRedemptionValue } from "@dominion/shared";
import { prisma } from "../db.js";

/**
 * A company can close (voluntarily or via auto-close) before any of its
 * outstanding corporate bonds mature. Bondholders are creditors and get
 * priority over whatever cash the founder recovers on closure — mirrors
 * real bankruptcy priority. If available cash can't cover every bond's full
 * redemption value, each bondholder gets a pro-rata share of what's
 * actually there instead of a first-come-first-served race through bond
 * IDs. Every outstanding bond closes out (redeemedAt set) regardless of
 * whether the payout was full or partial — the same "closes anyway, holder
 * eats the shortfall" idiom a bond's normal tick-driven maturity redemption
 * already uses.
 *
 * Returns the Prisma operations to fold into the caller's own closure
 * transaction (so bond payout, the company's closedAt update, and any loan
 * default all commit atomically together) plus the cash left over for the
 * caller to treat as recoveredCash.
 */
export async function buildCorporateBondClosureOps(companyId: string, availableCash: number) {
  const bonds = await prisma.corporateBond.findMany({ where: { companyId, redeemedAt: null } });
  if (bonds.length === 0) {
    return { ops: [], remainingCash: availableCash };
  }

  const now = new Date();
  const owed = bonds.map((bond) => ({
    bond,
    value: computeBondRedemptionValue(bond.principal, bond.interestRatePerHour, bond.termHours),
  }));
  const totalOwed = owed.reduce((sum, o) => sum + o.value, 0);
  const payoutRatio = totalOwed > 0 ? Math.min(1, availableCash / totalOwed) : 0;

  const ops = owed.flatMap(({ bond, value }) => {
    const payout = value * payoutRatio;
    return [
      prisma.corporateBond.update({ where: { id: bond.id }, data: { redeemedAt: now } }),
      prisma.settlement.update({ where: { playerId: bond.holderId }, data: { gold: { increment: payout } } }),
    ];
  });

  return { ops, remainingCash: Math.max(0, availableCash - totalOwed) };
}
