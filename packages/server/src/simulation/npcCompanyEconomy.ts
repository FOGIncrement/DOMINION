import {
  COMPANY_INDUSTRY_IDS,
  computeCompanyFacilityCost,
  computeCompanyMaxWorkers,
  computeCompanyUpgradeCost,
  type CompanyIndustryId,
  type MarketResourceType,
} from "@dominion/shared";
import { prisma } from "../db.js";
import { getConfig } from "../gameConfigStore.js";
import { applyTradeImpact, type TradeableResource } from "./market.js";
import type { CompanySnapshot } from "./types.js";

export interface MutableCompanyState {
  cash: number;
  // One entry per resource this company holds any stock of — replaces the
  // old single inputStock/goodsStock scalars, see the recipe-economy plan.
  stocks: Partial<Record<MarketResourceType, number>>;
}

/**
 * NPC-owned companies auto-trade every tick: top up every input resource
 * when low, sell off every output held above a working buffer. Directly
 * parallel to settleNpcSurplus for NPC settlements. Returns revenue earned
 * this tick so the caller can credit totalRevenue — without this, NPC
 * company P&L (and therefore stock valuation) never reflects their actual
 * sales.
 */
export async function settleNpcCompanyTrading(
  company: CompanySnapshot,
  state: MutableCompanyState,
  prices: Record<TradeableResource, number>,
): Promise<number> {
  const config = getConfig();
  const industry = config.COMPANY_INDUSTRIES[company.industry];
  let revenue = 0;

  for (const input of industry.inputs) {
    const stock = state.stocks[input.resource] ?? 0;
    if (stock >= config.NPC_COMPANY_TUNING.inputBuffer || state.cash <= 0) continue;
    const inputPrice = prices[input.resource];
    const need = config.NPC_COMPANY_TUNING.inputBuffer - stock;
    const affordable = state.cash / inputPrice;
    const toBuy = Math.max(0, Math.min(need, affordable));
    if (toBuy > 0.01) {
      state.stocks[input.resource] = stock + toBuy;
      state.cash -= toBuy * inputPrice;
      await applyTradeImpact(input.resource, "buy", toBuy);
    }
  }

  const goodsSellBuffer = industry.goodsSellBuffer ?? config.NPC_COMPANY_TUNING.goodsSellBuffer;
  for (const output of industry.outputs) {
    const stock = state.stocks[output.resource] ?? 0;
    if (stock <= goodsSellBuffer) continue;
    const excess = stock - goodsSellBuffer;
    state.stocks[output.resource] = stock - excess;
    const saleRevenue = excess * prices[output.resource];
    revenue += saleRevenue;
    state.cash += saleRevenue;
    await applyTradeImpact(output.resource, "sell", excess);
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
  powerPlant: ["Power Plant", "Energy Co.", "Power Station"],
  fertilizerPlant: ["Fertilizer Plant", "Soil Works", "AgroChem Co."],
  farm: ["Farm", "Farmstead", "Growers"],
  wheatFarm: ["Wheat Farm", "Farmstead", "Grain Growers"],
  packagingPlant: ["Packaging Plant", "Packing Co.", "Container Works"],
  flourMill: ["Flour Mill", "Milling Co.", "Grain Works"],
  bakery: ["Bakery", "Bread Co.", "Baking House"],
  retail: ["Retail Co.", "General Store", "Trading Post"],
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

  // NPC settlements have no Player/territory of their own — land-gated
  // industries (requiresTerritory) are excluded here, same as the existing
  // NPC bypass of zone capacity only applying to non-land-gated founding.
  const eligible = COMPANY_INDUSTRY_IDS.filter((id) => !config.COMPANY_INDUSTRIES[id].requiresTerritory);
  const industryId = eligible[Math.floor(Math.random() * eligible.length)];
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
