import { PrismaClient } from "../generated/prisma/index.js";

const WORLD_PLOT_COLS = 12;
const WORLD_PLOT_ROWS = 8;

function computeSpiralSlotOrder() {
  const centerCol = Math.floor(WORLD_PLOT_COLS / 2);
  const centerRow = Math.floor(WORLD_PLOT_ROWS / 2);
  const total = WORLD_PLOT_COLS * WORLD_PLOT_ROWS;
  const order = [];
  const seen = new Set();

  function tryAdd(col, row) {
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
    { dc: 1, dr: 0 },
    { dc: 0, dr: 1 },
    { dc: -1, dr: 0 },
    { dc: 0, dr: -1 },
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

const prisma = new PrismaClient();
const order = computeSpiralSlotOrder();

const settlements = await prisma.settlement.findMany({
  orderBy: { foundedAt: "asc" },
  select: { id: true, name: true },
});

let reassigned = 0;
let unplaced = 0;
for (let i = 0; i < settlements.length; i++) {
  const slot = order[i] ?? null;
  await prisma.settlement.update({
    where: { id: settlements[i].id },
    data: { worldCol: slot?.worldCol ?? null, worldRow: slot?.worldRow ?? null },
  });
  if (slot) reassigned++;
  else unplaced++;
}

console.log(JSON.stringify({ totalSettlements: settlements.length, reassigned, unplaced }));
await prisma.$disconnect();
