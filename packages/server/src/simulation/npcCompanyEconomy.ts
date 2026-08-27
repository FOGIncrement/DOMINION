import {
  COMPANY_INDUSTRY_IDS,
  computeCompanyFacilityCost,
  computeCompanyMaxWorkers,
  computeCompanyUpgradeCost,
  type CompanyIndustryId,
} from "@dominion/shared";
import { prisma } from "../db.js";
import { getConfig } from "../gameConfigStore.js";
import { applyTradeImpact, type TradeableResource } from "./market.js";
import type { CompanySnapshot } from "./types.js";

export interface MutableCompanyState {
  cash: number;
  inputStock: number;
  goodsStock: number;
}

/**
 * NPC-owned companies auto-trade every tick: top up input stock when low,
 * sell off goods held above a working buffer. Directly parallel to
 * settleNpcSurplus for NPC settlements. Returns revenue earned this tick so
 * the caller can credit totalRevenue — without this, NPC company P&L (and
 * therefore stock valuation) never reflects their actual goods sales.
 */
export async function settleNpcCompanyTrading(
  company: CompanySnapshot,
  state: MutableCompanyState,
  prices: Record<TradeableResource, number>,
): Promise<number> {
  const config = getConfig();
  const industry = config.COMPANY_INDUSTRIES[company.industry];
  let revenue = 0;

  if (industry.inputResource && state.inputStock < config.NPC_COMPANY_TUNING.inputBuffer && state.cash > 0) {
    const inputPrice = prices[industry.inputResource];
    const need = config.NPC_COMPANY_TUNING.inputBuffer - state.inputStock;
    const affordable = state.cash / inputPrice;
    const toBuy = Math.max(0, Math.min(need, affordable));
    if (toBuy > 0.01) {
      state.inputStock += toBuy;
      state.cash -= toBuy * inputPrice;
      await applyTradeImpact(industry.inputResource, "buy", toBuy);
    }
  }

  // contractOnly (Construction) never produces goods, so this whole
  // sell-off never applies — its revenue is one-off government zone
  // commissions instead of market sales.
  const goodsSellBuffer = industry.goodsSellBuffer ?? config.NPC_COMPANY_TUNING.goodsSellBuffer;
  if (!industry.contractOnly && state.goodsStock > goodsSellBuffer) {
    const excess = state.goodsStock - goodsSellBuffer;
    state.goodsStock -= excess;
    revenue = excess * prices[industry.outputResource];
    state.cash += revenue;
    await applyTradeImpact(industry.outputResource, "sell", excess);
  }

  return revenue;
}

/** Small chance for a cash-rich NPC company to hire another worker, mirroring maybeExpand for settlements. */
export async function maybeHire(company: CompanySnapshot, state: MutableCompanyState): Promise<void> {
  const config = getConfig();
  const industry = config.COMPANY_INDUSTRIES[company.industry];
  if (
    company.workersAssigned >=
    computeCompanyMaxWorkers(industry, company.level, config.COMPANY_UPGRADE_TUNING, company.facilityCount)
  )
    return;
  if (state.cash < config.NPC_COMPANY_TUNING.minCashToHire) return;
  if (Math.random() > config.NPC_COMPANY_TUNING.hireChancePerTick) return;

  await prisma.company.update({
    where: { id: company.id },
    data: { workersAssigned: company.workersAssigned + 1 },
  });
}

/**
 * Small chance for a cash-rich NPC company to reinvest in itself, mirroring
 * maybeHire. Without this, only player companies could ever grow past their
 * starting shape, which would let a player trivially out-scale all NPC
 * competition — NPCs need the same reinvestment lever.
 */
export async function maybeUpgradeCompany(company: CompanySnapshot, state: MutableCompanyState): Promise<void> {
  const config = getConfig();
  const industry = config.COMPANY_INDUSTRIES[company.industry];
  const cost = computeCompanyUpgradeCost(industry, company.level, config.COMPANY_UPGRADE_TUNING);
  if (cost === null) return; // already at maxLevel
  if (state.cash < config.NPC_COMPANY_TUNING.minCashToUpgrade) return;
  if (state.cash < cost) return;
  if (Math.random() > config.NPC_COMPANY_TUNING.upgradeChancePerTick) return;

  state.cash -= cost;
  await prisma.company.update({
    where: { id: company.id },
    data: { level: company.level + 1 },
  });
}

/**
 * Small chance for a cash-rich NPC company to open another facility,
 * mirroring maybeUpgradeCompany — not gated by zone capacity the way a
 * player-owned company's expansion is (see routes/companies.ts), since NPC
 * companies have no settlement/Government to commission a zone through,
 * same bypass NPC founding already has.
 */
export async function maybeExpandCompany(company: CompanySnapshot, state: MutableCompanyState): Promise<void> {
  const config = getConfig();
  const industry = config.COMPANY_INDUSTRIES[company.industry];
  const cost = computeCompanyFacilityCost(industry, company.facilityCount, config.COMPANY_FACILITY_TUNING);
  if (cost === null) return; // already at maxFacilities
  if (state.cash < config.NPC_COMPANY_TUNING.minCashToExpand) return;
  if (state.cash < cost) return;
  if (Math.random() > config.NPC_COMPANY_TUNING.expandChancePerTick) return;

  state.cash -= cost;
  await prisma.company.update({
    where: { id: company.id },
    data: { facilityCount: company.facilityCount + 1 },
  });
}

const NPC_COMPANY_NAME_PREFIXES = [
  "Northgate",
  "Silverline",
  "Cedarbrook",
  "Ironhollow",
  "Fairwind",
  "Redstone",
  "Millbrook",
  "Ashford",
  "Blackpine",
  "Golden Vale",
  "Stonebridge",
  "Wren's Hollow",
];

const NPC_COMPANY_NAME_SUFFIXES: Record<CompanyIndustryId, string[]> = {
  bakery: ["Bakery", "Bread Co.", "Baking House"],
  sawmill: ["Sawmill", "Timber Co.", "Lumber Works"],
  stoneworks: ["Stoneworks", "Masonry Co.", "Quarry Works"],
  farming: ["Farm", "Farmstead", "Growers"],
  logging: ["Logging Camp", "Timber Camp", "Woodcutters"],
  quarrying: ["Quarry", "Stone Pit", "Extraction Co."],
  retail: ["Retail Co.", "General Store", "Trading Post"],
  construction: ["Construction Co.", "Builders Guild", "Masonry Works"],
};

function generateNpcCompanyName(industry: CompanyIndustryId): string {
  const prefix = NPC_COMPANY_NAME_PREFIXES[Math.floor(Math.random() * NPC_COMPANY_NAME_PREFIXES.length)];
  const suffixOptions = NPC_COMPANY_NAME_SUFFIXES[industry];
  const suffix = suffixOptions[Math.floor(Math.random() * suffixOptions.length)];
  return `${prefix} ${suffix}`;
}

/**
 * The NPC company roster could previously only shrink (auto-close on deep
 * debt) — nothing ever replaced a closed company, or grew the roster as the
 * world's settlement count grew. Rolls once per tick, world-wide, subject to
 * a cap relative to the current settlement count so the roster doesn't grow
 * unboundedly forever.
 */
export async function maybeFoundNpcCompany(settlementCount: number): Promise<void> {
  const config = getConfig();
  if (Math.random() > config.NPC_COMPANY_TUNING.foundChancePerTick) return;

  const openNpcCompanyCount = await prisma.company.count({ where: { ownerId: null, closedAt: null } });
  if (openNpcCompanyCount >= settlementCount * config.NPC_COMPANY_TUNING.maxCompaniesPerSettlement) return;

  const industryId = COMPANY_INDUSTRY_IDS[Math.floor(Math.random() * COMPANY_INDUSTRY_IDS.length)];
  const industry = config.COMPANY_INDUSTRIES[industryId];

  await prisma.company.create({
    data: {
      name: generateNpcCompanyName(industryId),
      industry: industryId,
      cash: industry.foundingCost,
      workersAssigned: 0,
    },
  });
}
