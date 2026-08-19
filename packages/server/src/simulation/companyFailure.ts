import { COMPANY_FAILURE_TUNING, type CompanyIndustryDef } from "@dominion/shared";
import { prisma } from "../db.js";

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
export function shouldAutoClose(industry: CompanyIndustryDef, cash: number, isPublic: boolean): boolean {
  if (isPublic) return false;
  return -cash > industry.foundingCost * COMPANY_FAILURE_TUNING.autoCloseDebtMultiplier;
}

/** Same terminal state as the voluntary /close route, minus the settlement-credit/HTTP-response concerns that don't apply to an automatic, engine-driven closure. */
export async function autoCloseCompany(companyId: string): Promise<void> {
  const now = new Date();
  await prisma.company.update({
    where: { id: companyId },
    data: { closedAt: now, workersAssigned: 0 },
  });
  await prisma.loan.updateMany({
    where: { companyId, defaultedAt: null },
    data: { defaultedAt: now },
  });
}
