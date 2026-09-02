import "dotenv/config";
import { computeTargetSharePrice, STOCK_TUNING } from "@dominion/shared";
import { prisma } from "../src/db.js";
import { createNpcSettlement } from "../src/settlementFactory.js";
import { ensureMarketSeeded } from "../src/simulation/market.js";
import type { CompanyIndustryId, InvestorArchetype, NpcArchetype } from "@dominion/shared";

const NPC_SETTLEMENTS: { name: string; archetype: NpcArchetype; population: number }[] = [
  { name: "Oakridge", archetype: "agrarian", population: 60 },
  { name: "Millhaven", archetype: "agrarian", population: 45 },
  { name: "Greenford", archetype: "agrarian", population: 38 },
  { name: "Ashfield", archetype: "agrarian", population: 52 },
  { name: "Stonebrook", archetype: "mining", population: 55 },
  { name: "Ironhollow", archetype: "mining", population: 48 },
  { name: "Copperreach", archetype: "mining", population: 41 },
  { name: "Graniteford", archetype: "mining", population: 36 },
  { name: "Portsmere", archetype: "trade", population: 70 },
  { name: "Westland Crossing", archetype: "trade", population: 63 },
  { name: "Amber Docks", archetype: "trade", population: 58 },
  { name: "Silverkeep", archetype: "trade", population: 44 },
  { name: "Fallowmere", archetype: "agrarian", population: 30 },
  { name: "Deepvale", archetype: "mining", population: 33 },
  { name: "Harborlight", archetype: "trade", population: 39 },
  { name: "Wrenfield", archetype: "agrarian", population: 27 },
];

const NPC_COMPANIES: {
  name: string;
  industry: CompanyIndustryId;
  cash: number;
  // Starting resource stock per resource type — omit entries a company has
  // no input for (a land-gated pure-extraction industry has none).
  stocks?: Record<string, number>;
  workersAssigned: number;
  ipo?: boolean;
}[] = [
  { name: "Sunfield Power Plant", industry: "powerPlant", cash: 400, workersAssigned: 3, ipo: true },
  { name: "Ridgeline Power Co.", industry: "powerPlant", cash: 200, workersAssigned: 2 },
  { name: "Greenfields Fertilizer", industry: "fertilizerPlant", cash: 350, workersAssigned: 2 },
  { name: "Golden Acres Wheat Farm", industry: "wheatFarm", cash: 300, stocks: { fertilizer: 20 }, workersAssigned: 3, ipo: true },
  { name: "Harvest Row Farms", industry: "wheatFarm", cash: 180, stocks: { fertilizer: 10 }, workersAssigned: 2 },
  { name: "Crestpoint Packaging", industry: "packagingPlant", cash: 250, workersAssigned: 2 },
  { name: "Millstone Flour Mill", industry: "flourMill", cash: 420, stocks: { wheat: 20, electricity: 15 }, workersAssigned: 3, ipo: true },
  { name: "Golden Crust Bakery", industry: "bakery", cash: 380, stocks: { flour: 15, electricity: 10, packaging: 10 }, workersAssigned: 3, ipo: true },
  { name: "Hearth & Home Bakery", industry: "bakery", cash: 260, stocks: { flour: 10, electricity: 5, packaging: 5 }, workersAssigned: 2 },
];

const NPC_INVESTORS: { name: string; archetype: InvestorArchetype; cash: number }[] = [
  { name: "Granite Trust", archetype: "conservative", cash: 600 },
  { name: "Kestrel Pension Fund", archetype: "conservative", cash: 800 },
  { name: "Northbridge Growth Partners", archetype: "growth", cash: 500 },
  { name: "Fairwind Capital", archetype: "growth", cash: 450 },
  { name: "Ashby & Vane", archetype: "speculator", cash: 350 },
  { name: "Wren Speculative Holdings", archetype: "speculator", cash: 300 },
];

const NPC_BANKS: { name: string; cash: number; interestRatePerHour: number }[] = [
  { name: "Westland Trust Bank", cash: 1500, interestRatePerHour: 0.0018 },
  { name: "Ironbridge Credit Union", cash: 900, interestRatePerHour: 0.0025 },
  { name: "Highmark Lending House", cash: 600, interestRatePerHour: 0.0032 },
];

async function main() {
  const existingCount = await prisma.settlement.count({ where: { playerId: null } });
  if (existingCount > 0) {
    console.log(`[seed] ${existingCount} NPC settlements already exist, skipping settlement seed.`);
  } else {
    for (const npc of NPC_SETTLEMENTS) {
      await createNpcSettlement(npc.name, npc.archetype, npc.population);
      console.log(`[seed] created NPC settlement ${npc.name} (${npc.archetype})`);
    }
  }

  const existingCompanyCount = await prisma.company.count({ where: { ownerId: null } });
  if (existingCompanyCount > 0) {
    console.log(`[seed] ${existingCompanyCount} NPC companies already exist, skipping company seed.`);
  } else {
    for (const npc of NPC_COMPANIES) {
      const sharesOutstanding = npc.ipo ? STOCK_TUNING.sharesOutstandingAtIPO : 0;
      const sharePrice = npc.ipo
        ? computeTargetSharePrice({
            totalRevenue: 0,
            totalExpenses: 0,
            foundedAt: new Date(),
            cash: npc.cash,
            sharesOutstanding,
          })
        : 0;

      await prisma.company.create({
        data: {
          name: npc.name,
          industry: npc.industry,
          cash: npc.cash,
          workersAssigned: npc.workersAssigned,
          isPublic: !!npc.ipo,
          sharesOutstanding,
          sharePrice,
          ipoAt: npc.ipo ? new Date() : null,
          resourceStocks: npc.stocks
            ? { create: Object.entries(npc.stocks).map(([resourceType, amount]) => ({ resourceType, amount })) }
            : undefined,
        },
      });
      console.log(`[seed] created NPC company ${npc.name} (${npc.industry})${npc.ipo ? " [public]" : ""}`);
    }
  }

  const existingInvestorCount = await prisma.npcInvestor.count();
  if (existingInvestorCount > 0) {
    console.log(`[seed] ${existingInvestorCount} NPC investors already exist, skipping investor seed.`);
  } else {
    for (const investor of NPC_INVESTORS) {
      await prisma.npcInvestor.create({ data: investor });
      console.log(`[seed] created NPC investor ${investor.name} (${investor.archetype})`);
    }
  }

  const existingBankCount = await prisma.bank.count({ where: { ownerId: null } });
  if (existingBankCount > 0) {
    console.log(`[seed] ${existingBankCount} NPC banks already exist, skipping bank seed.`);
  } else {
    for (const bank of NPC_BANKS) {
      await prisma.bank.create({ data: bank });
      console.log(`[seed] created NPC bank ${bank.name}`);
    }
  }

  await ensureMarketSeeded();
  await prisma.worldState.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });

  console.log("[seed] done");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
