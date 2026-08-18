import "dotenv/config";
import { prisma } from "../src/db.js";
import { createNpcSettlement } from "../src/settlementFactory.js";
import { ensureMarketSeeded } from "../src/simulation/market.js";
import type { NpcArchetype } from "@dominion/shared";

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
