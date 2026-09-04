-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT,
    "name" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "cash" REAL NOT NULL,
    "workersAssigned" INTEGER NOT NULL DEFAULT 0,
    "autoStaff" BOOLEAN NOT NULL DEFAULT false,
    "level" INTEGER NOT NULL DEFAULT 1,
    "facilityCount" INTEGER NOT NULL DEFAULT 1,
    "totalRevenue" REAL NOT NULL DEFAULT 0,
    "totalExpenses" REAL NOT NULL DEFAULT 0,
    "lastTickAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "foundedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "sharesOutstanding" REAL NOT NULL DEFAULT 0,
    "sharePrice" REAL NOT NULL DEFAULT 0,
    "ipoAt" DATETIME,
    "closedAt" DATETIME,
    "territorySeedIndex" INTEGER,
    "zoneId" TEXT,
    "cellX" INTEGER,
    "cellY" INTEGER,
    CONSTRAINT "Company_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Player" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Company_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "SettlementZone" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Company" ("autoStaff", "cash", "closedAt", "facilityCount", "foundedAt", "id", "industry", "ipoAt", "isPublic", "lastTickAt", "level", "name", "ownerId", "sharePrice", "sharesOutstanding", "territorySeedIndex", "totalExpenses", "totalRevenue", "workersAssigned") SELECT "autoStaff", "cash", "closedAt", "facilityCount", "foundedAt", "id", "industry", "ipoAt", "isPublic", "lastTickAt", "level", "name", "ownerId", "sharePrice", "sharesOutstanding", "territorySeedIndex", "totalExpenses", "totalRevenue", "workersAssigned" FROM "Company";
DROP TABLE "Company";
ALTER TABLE "new_Company" RENAME TO "Company";
CREATE INDEX "Company_ownerId_idx" ON "Company"("ownerId");
CREATE INDEX "Company_zoneId_idx" ON "Company"("zoneId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
