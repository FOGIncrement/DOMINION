import { COMPANY_FAILURE_TUNING, type CompanyIndustryDef } from "@dominion/shared";
import { prisma } from "../db.js";
import { buildCorporateBondClosureOps } from "./corporateBonds.js";

/**
 * Deliberately simple — no proportional formula, no severity score. A
 * company that can't cover its own wages loses exactly one worker per tick
 * evaluation, mirroring how reconcileWorkersWithPopulation handles a
 * structurally similar problem with a plain, direct rule. Capped at one per
 * tick regardless of elapsedHours so a single large catch-up tick can't
 * zero out a workforce in one shot.
 */
export function shouldForceLayoff(cash: number, workersAssigned: number): boolean {
  return cash < 0 && workersAssigned > 0;
}

/**
 * A multiple of a baseline (foundingCost), same idiom as BANK_TUNING's loan
 * default threshold being a multiple of principal. Public companies are
 * exempt — same unresolved shareholder-fairness question that already
 * scopes the manual /close route away from public companies.
 */
export function shouldAutoClose(
  industry: CompanyIndustryDef,
  cash: number,
  isPublic: boolean,
  failureTuning: typeof COMPANY_FAILURE_TUNING = COMPANY_FAILURE_TUNING,
): boolean {
  if (isPublic) return false;
  return -cash > industry.foundingCost * failureTuning.autoCloseDebtMultiplier;
}

/**
 * Same terminal state as the voluntary /close route, minus the
 * settlement-credit/HTTP-response concerns that don't apply to an
 * automatic, engine-driven closure — including the harsher outcome:
 * whatever cash is left over after bondholders are paid is simply
 * forfeited, not returned to the founder the way voluntary closure's
 * recoveredCash works. That asymmetry is deliberate and pre-existing
 * (auto-close is the punitive path), not something this bond-payout
 * addition should soften.
 *
 * `cash` must be the tick's freshly computed balance (state.cash in
 * engine.ts), not a stale read of company.cash — the caller's tick loop
 * `continue`s here before its normal cash-persisting update runs, so this
 * is the only place that balance ever reaches the database.
 */
export async function autoCloseCompany(companyId: string, cash: number): Promise<void> {
  const now = new Date();
  const { ops: bondOps, remainingCash } = await buildCorporateBondClosureOps(companyId, Math.max(0, cash));

  await prisma.$transaction([
    prisma.company.update({
      where: { id: companyId },
      data: { closedAt: now, workersAssigned: 0, cash: remainingCash },
    }),
    prisma.loan.updateMany({
      where: { companyId, defaultedAt: null },
      data: { defaultedAt: now },
    }),
    ...bondOps,
  ]);
}
