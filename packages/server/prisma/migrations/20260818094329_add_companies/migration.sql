-- CreateTable
CREATE TABLE "Company" (
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
    CONSTRAINT "Company_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Player" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MarketTrade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "settlementId" TEXT,
    "companyId" TEXT,
    "resourceType" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "price" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketTrade_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MarketTrade_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_MarketTrade" ("createdAt", "id", "price", "quantity", "resourceType", "settlementId", "side") SELECT "createdAt", "id", "price", "quantity", "resourceType", "settlementId", "side" FROM "MarketTrade";
DROP TABLE "MarketTrade";
ALTER TABLE "new_MarketTrade" RENAME TO "MarketTrade";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Company_ownerId_idx" ON "Company"("ownerId");
