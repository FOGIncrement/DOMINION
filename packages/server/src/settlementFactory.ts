import { prisma } from "./db.js";
import {
  BUILDING_TYPES,
  NPC_ARCHETYPE_DEFS,
  STARTING_SETTLEMENT,
  WORLD_PLOT_COLS,
  WORLD_PLOT_ROWS,
  type BuildingTypeId,
  type NpcArchetype,
} from "@dominion/shared";

// First unclaimed slot on the shared world-plot grid, scanned row-major.
// Not race-safe against two settlements being created at the exact same
// instant (a real TOCTOU gap between this read and the create() below) —
// acceptable for this prototype's scale (sequential NPC seeding, a small
// real player base); a production version would need a transaction or
// advisory lock here. Returns null if the grid is full rather than
// throwing — a settlement without a plot just doesn't render on the map.
async function assignSettlementPlot(): Promise<{ worldCol: number; worldRow: number } | null> {
  const claimed = await prisma.settlement.findMany({
    where: { worldCol: { not: null }, worldRow: { not: null } },
    select: { worldCol: true, worldRow: true },
  });
  const claimedSet = new Set(claimed.map((s) => `${s.worldCol}:${s.worldRow}`));

  for (let row = 0; row < WORLD_PLOT_ROWS; row++) {
    for (let col = 0; col < WORLD_PLOT_COLS; col++) {
      if (!claimedSet.has(`${col}:${row}`)) {
        return { worldCol: col, worldRow: row };
      }
    }
  }
  return null;
}

export async function createPlayerSettlement(playerId: string, name: string) {
  const plot = await assignSettlementPlot();
  return prisma.settlement.create({
    data: {
      playerId,
      name,
      food: STARTING_SETTLEMENT.food,
      wood: STARTING_SETTLEMENT.wood,
      stone: STARTING_SETTLEMENT.stone,
      gold: STARTING_SETTLEMENT.gold,
      storageCap: STARTING_SETTLEMENT.storageCap,
      worldCol: plot?.worldCol,
      worldRow: plot?.worldRow,
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

  const plot = await assignSettlementPlot();
  return prisma.settlement.create({
    data: {
      name,
      archetype,
      food: STARTING_SETTLEMENT.food * 1.5,
      wood: STARTING_SETTLEMENT.wood,
      stone: STARTING_SETTLEMENT.stone,
      gold: STARTING_SETTLEMENT.gold * 2,
      storageCap: STARTING_SETTLEMENT.storageCap * 2,
      worldCol: plot?.worldCol,
      worldRow: plot?.worldRow,
      population: { create: { count: startingPopulation } },
      buildings: { create: buildings },
    },
  });
}
