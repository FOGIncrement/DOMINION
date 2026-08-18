import { prisma } from "./db.js";
import {
  BUILDING_TYPES,
  NPC_ARCHETYPE_DEFS,
  STARTING_SETTLEMENT,
  type BuildingTypeId,
  type NpcArchetype,
} from "@dominion/shared";

export async function createPlayerSettlement(playerId: string, name: string) {
  return prisma.settlement.create({
    data: {
      playerId,
      name,
      food: STARTING_SETTLEMENT.food,
      wood: STARTING_SETTLEMENT.wood,
      stone: STARTING_SETTLEMENT.stone,
      gold: STARTING_SETTLEMENT.gold,
      storageCap: STARTING_SETTLEMENT.storageCap,
      population: { create: { count: STARTING_SETTLEMENT.population } },
      buildings: {
        create: [{ type: "house" }, { type: "farm" }, { type: "lumberCamp" }],
      },
    },
  });
}

export async function createNpcSettlement(
  name: string,
  archetype: NpcArchetype,
  startingPopulation: number,
) {
  const def = NPC_ARCHETYPE_DEFS[archetype];
  const buildings: { type: BuildingTypeId; workersAssigned: number }[] = [];
  for (const [type, count] of Object.entries(def.startingBuildings)) {
    const typeId = type as BuildingTypeId;
    const maxWorkers = BUILDING_TYPES[typeId].maxWorkers;
    for (let i = 0; i < (count ?? 0); i++) {
      buildings.push({ type: typeId, workersAssigned: maxWorkers });
    }
  }

  return prisma.settlement.create({
    data: {
      name,
      archetype,
      food: STARTING_SETTLEMENT.food * 1.5,
      wood: STARTING_SETTLEMENT.wood,
      stone: STARTING_SETTLEMENT.stone,
      gold: STARTING_SETTLEMENT.gold * 2,
      storageCap: STARTING_SETTLEMENT.storageCap * 2,
      population: { create: { count: startingPopulation } },
      buildings: { create: buildings },
    },
  });
}
