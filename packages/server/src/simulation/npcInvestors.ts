import { NPC_INVESTOR_TUNING, computeProfitRatePerHour } from "@dominion/shared";
import { prisma } from "../db.js";
import { announceControlChangeIfAny, getControllingPlayerId } from "./control.js";
import { applyShareTradeImpact, availableShareFloat } from "./stocks.js";

export interface PublicCompanyForInvesting {
  id: string;
  name: string;
  ownerId: string | null;
  isPublic: true;
  cash: number;
  sharePrice: number;
  priceDeltaThisTick: number; // for speculator momentum — avoids a history query per company
  sharesOutstanding: number;
  totalRevenue: number;
  totalExpenses: number;
  foundedAt: Date;
}

interface InvestorLike {
  id: string;
  cash: number;
}

async function investorHolding(investorId: string, companyId: string) {
  return prisma.shareholding.findUnique({
    where: { companyId_npcInvestorId: { companyId, npcInvestorId: investorId } },
  });
}

async function buyShares(investor: InvestorLike, company: PublicCompanyForInvesting): Promise<void> {
  const budget = investor.cash * NPC_INVESTOR_TUNING.buySpendFraction;
  if (budget < 1 || company.sharePrice <= 0) return;

  const float = await availableShareFloat(company.id, company.sharesOutstanding);
  if (float < 0.01) return;
  const shares = Math.min(budget / company.sharePrice, float);

  const beforeControllerId = await getControllingPlayerId(company);

  const existing = await investorHolding(investor.id, company.id);
  if (existing) {
    await prisma.shareholding.update({ where: { id: existing.id }, data: { shares: existing.shares + shares } });
  } else {
    await prisma.shareholding.create({ data: { companyId: company.id, npcInvestorId: investor.id, shares } });
  }
  await prisma.npcInvestor.update({ where: { id: investor.id }, data: { cash: { decrement: budget } } });
  await applyShareTradeImpact(company.id, "buy", shares, company.sharePrice);
  await announceControlChangeIfAny(company, beforeControllerId);
}

async function sellShares(investorId: string, company: PublicCompanyForInvesting): Promise<void> {
  const holding = await investorHolding(investorId, company.id);
  if (!holding || holding.shares <= 0) return;
  const sharesToSell = holding.shares * NPC_INVESTOR_TUNING.sellFraction;
  const proceeds = sharesToSell * company.sharePrice;

  const beforeControllerId = await getControllingPlayerId(company);

  await prisma.shareholding.update({ where: { id: holding.id }, data: { shares: holding.shares - sharesToSell } });
  await prisma.npcInvestor.update({ where: { id: investorId }, data: { cash: { increment: proceeds } } });
  await applyShareTradeImpact(company.id, "sell", sharesToSell, company.sharePrice);
  await announceControlChangeIfAny(company, beforeControllerId);
}

/** Buys the company with the biggest cash reserves among the non-loss-making ones; rarely sells. */
async function actConservative(investor: InvestorLike, companies: PublicCompanyForInvesting[]): Promise<void> {
  const now = new Date();
  const best = [...companies]
    .filter((c) => computeProfitRatePerHour(c, now) >= 0)
    .sort((a, b) => b.cash - a.cash)[0];

  if (best && investor.cash > NPC_INVESTOR_TUNING.minCashToAct) {
    await buyShares(investor, best);
    return;
  }
  for (const company of companies) {
    if (computeProfitRatePerHour(company, now) < 0) {
      await sellShares(investor.id, company);
    }
  }
}

/** Chases the single highest profit-rate company; sells out of anything that's gone unprofitable. */
async function actGrowth(investor: InvestorLike, companies: PublicCompanyForInvesting[]): Promise<void> {
  const now = new Date();
  const ranked = [...companies].sort(
    (a, b) => computeProfitRatePerHour(b, now) - computeProfitRatePerHour(a, now),
  );
  const best = ranked[0];

  if (best && investor.cash > NPC_INVESTOR_TUNING.minCashToAct) {
    await buyShares(investor, best);
  }
  for (const company of companies) {
    if (company.id !== best?.id && computeProfitRatePerHour(company, now) < 0) {
      await sellShares(investor.id, company);
    }
  }
}

/** Momentum chaser: buys whatever just moved up the most this tick, sells whatever just dropped. */
async function actSpeculator(investor: InvestorLike, companies: PublicCompanyForInvesting[]): Promise<void> {
  const ranked = [...companies].sort((a, b) => b.priceDeltaThisTick - a.priceDeltaThisTick);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];

  if (best && best.priceDeltaThisTick > 0 && investor.cash > NPC_INVESTOR_TUNING.minCashToAct) {
    await buyShares(investor, best);
  }
  if (worst && worst.priceDeltaThisTick < 0) {
    await sellShares(investor.id, worst);
  }
}

export async function runNpcInvestorTick(companies: PublicCompanyForInvesting[]): Promise<void> {
  if (companies.length === 0) return;

  const investors = await prisma.npcInvestor.findMany();
  for (const investor of investors) {
    if (Math.random() > NPC_INVESTOR_TUNING.actChancePerTick) continue;

    if (investor.archetype === "conservative") await actConservative(investor, companies);
    else if (investor.archetype === "growth") await actGrowth(investor, companies);
    else await actSpeculator(investor, companies);
  }
}
