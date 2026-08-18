-- CreateTable
CREATE TABLE "NpcInvestor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "archetype" TEXT NOT NULL,
    "cash" REAL NOT NULL
);

-- CreateTable
CREATE TABLE "Shareholding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "playerId" TEXT,
    "npcInvestorId" TEXT,
    "shares" REAL NOT NULL,
    CONSTRAINT "Shareholding_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Shareholding_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Shareholding_npcInvestorId_fkey" FOREIGN KEY ("npcInvestorId") REFERENCES "NpcInvestor" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SharePriceHistoryPoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SharePriceHistoryPoint_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT,
    "name" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "cash" REAL NOT NULL,
    "inputStock" REAL NOT NULL DEFAULT 0,
    "goodsStock" REAL NOT NULL DEFAULT 0,
    "workersAssigned" INTEGER NOT NULL DEFAULT 0,
    "totalRevenue" REAL NOT NULL DEFAULT 0,
    "totalExpenses" REAL NOT NULL DEFAULT 0,
    "lastTickAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "foundedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "sharesOutstanding" REAL NOT NULL DEFAULT 0,
    "sharePrice" REAL NOT NULL DEFAULT 0,
    "ipoAt" DATETIME,
    CONSTRAINT "Company_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Player" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Company" ("cash", "foundedAt", "goodsStock", "id", "industry", "inputStock", "lastTickAt", "name", "ownerId", "totalExpenses", "totalRevenue", "workersAssigned") SELECT "cash", "foundedAt", "goodsStock", "id", "industry", "inputStock", "lastTickAt", "name", "ownerId", "totalExpenses", "totalRevenue", "workersAssigned" FROM "Company";
DROP TABLE "Company";
ALTER TABLE "new_Company" RENAME TO "Company";
CREATE INDEX "Company_ownerId_idx" ON "Company"("ownerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Shareholding_companyId_playerId_key" ON "Shareholding"("companyId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "Shareholding_companyId_npcInvestorId_key" ON "Shareholding"("companyId", "npcInvestorId");

-- CreateIndex
CREATE INDEX "SharePriceHistoryPoint_companyId_recordedAt_idx" ON "SharePriceHistoryPoint"("companyId", "recordedAt");
