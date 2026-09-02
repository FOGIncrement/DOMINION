-- CreateTable
CREATE TABLE "CompanyResourceStock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "amount" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "CompanyResourceStock_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
    CONSTRAINT "Company_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Player" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Company" ("autoStaff", "cash", "closedAt", "facilityCount", "foundedAt", "id", "industry", "ipoAt", "isPublic", "lastTickAt", "level", "name", "ownerId", "sharePrice", "sharesOutstanding", "territorySeedIndex", "totalExpenses", "totalRevenue", "workersAssigned") SELECT "autoStaff", "cash", "closedAt", "facilityCount", "foundedAt", "id", "industry", "ipoAt", "isPublic", "lastTickAt", "level", "name", "ownerId", "sharePrice", "sharesOutstanding", "territorySeedIndex", "totalExpenses", "totalRevenue", "workersAssigned" FROM "Company";
DROP TABLE "Company";
ALTER TABLE "new_Company" RENAME TO "Company";
CREATE INDEX "Company_ownerId_idx" ON "Company"("ownerId");
CREATE TABLE "new_ZoneProject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "governmentId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "zoneType" TEXT NOT NULL,
    "treasuryCost" REAL NOT NULL,
    "buildTimeHours" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" DATETIME,
    "completesAt" DATETIME,
    "completedAt" DATETIME,
    "cancelledAt" DATETIME,
    "zoneX" INTEGER,
    "zoneY" INTEGER,
    "zoneWidth" INTEGER,
    "zoneHeight" INTEGER,
    CONSTRAINT "ZoneProject_governmentId_fkey" FOREIGN KEY ("governmentId") REFERENCES "Government" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ZoneProject_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ZoneProject" ("acceptedAt", "buildTimeHours", "cancelledAt", "completedAt", "completesAt", "createdAt", "governmentId", "id", "settlementId", "treasuryCost", "zoneHeight", "zoneType", "zoneWidth", "zoneX", "zoneY") SELECT "acceptedAt", "buildTimeHours", "cancelledAt", "completedAt", "completesAt", "createdAt", "governmentId", "id", "settlementId", "treasuryCost", "zoneHeight", "zoneType", "zoneWidth", "zoneX", "zoneY" FROM "ZoneProject";
DROP TABLE "ZoneProject";
ALTER TABLE "new_ZoneProject" RENAME TO "ZoneProject";
CREATE INDEX "ZoneProject_governmentId_idx" ON "ZoneProject"("governmentId");
CREATE INDEX "ZoneProject_settlementId_idx" ON "ZoneProject"("settlementId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "CompanyResourceStock_companyId_resourceType_key" ON "CompanyResourceStock"("companyId", "resourceType");
