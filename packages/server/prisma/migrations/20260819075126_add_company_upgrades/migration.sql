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
    "level" INTEGER NOT NULL DEFAULT 1,
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
INSERT INTO "new_Company" ("cash", "foundedAt", "goodsStock", "id", "industry", "inputStock", "ipoAt", "isPublic", "lastTickAt", "name", "ownerId", "sharePrice", "sharesOutstanding", "totalExpenses", "totalRevenue", "workersAssigned") SELECT "cash", "foundedAt", "goodsStock", "id", "industry", "inputStock", "ipoAt", "isPublic", "lastTickAt", "name", "ownerId", "sharePrice", "sharesOutstanding", "totalExpenses", "totalRevenue", "workersAssigned" FROM "Company";
DROP TABLE "Company";
ALTER TABLE "new_Company" RENAME TO "Company";
CREATE INDEX "Company_ownerId_idx" ON "Company"("ownerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
