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

// Square-spiral-from-center slot order: right, down, left x2, up x2,
// right x3, ... expanding ring by ring, clamped to grid bounds. Replaces a
// row-major scan that only ever filled left-to-right-then-down ("expands
// sideways" — the user's exact complaint). Computed once at module load;
// 96 entries for today's 12x8 grid, negligible cost either way. Handles a
// non-square grid with no special-casing — the walk just keeps expanding
// until every in-bounds cell has been collected, skipping out-of-bounds
// candidates via the bounds check in tryAdd.
function computeSpiralSlotOrder(): { worldCol: number; worldRow: number }[] {
  const centerCol = Math.floor(WORLD_PLOT_COLS / 2);
  const centerRow = Math.floor(WORLD_PLOT_ROWS / 2);
  const total = WORLD_PLOT_COLS * WORLD_PLOT_ROWS;
  const order: { worldCol: number; worldRow: number }[] = [];
  const seen = new Set<string>();

  function tryAdd(col: number, row: number) {
    if (col < 0 || col >= WORLD_PLOT_COLS || row < 0 || row >= WORLD_PLOT_ROWS) return;
    const key = `${col}:${row}`;
    if (seen.has(key)) return;
    seen.add(key);
    order.push({ worldCol: col, worldRow: row });
  }

  let col = centerCol;
  let row = centerRow;
  tryAdd(col, row);

  const DIRS = [
    { dc: 1, dr: 0 }, // right
    { dc: 0, dr: 1 }, // down
    { dc: -1, dr: 0 }, // left
    { dc: 0, dr: -1 }, // up
  ];
  let legLength = 1;
  let dirIndex = 0;
  while (order.length < total && legLength <= WORLD_PLOT_COLS + WORLD_PLOT_ROWS) {
    for (let repeat = 0; repeat < 2; repeat++) {
      const { dc, dr } = DIRS[dirIndex % 4];
      for (let step = 0; step < legLength; step++) {
        col += dc;
        row += dr;
        tryAdd(col, row);
      }
      dirIndex++;
    }
    legLength++;
  }
  return order;
}

const SPIRAL_SLOT_ORDER = computeSpiralSlotOrder();

// First unclaimed slot in spiral order, so new settlements radiate outward
// from the center in every direction instead of filling row by row. Not
// race-safe against two settlements being created at the exact same
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

  for (const slot of SPIRAL_SLOT_ORDER) {
    if (!claimedSet.has(`${slot.worldCol}:${slot.worldRow}`)) {
      return slot;
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
