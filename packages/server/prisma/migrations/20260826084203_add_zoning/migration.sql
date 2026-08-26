-- CreateTable
CREATE TABLE "SettlementZone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "settlementId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "slotsGranted" INTEGER NOT NULL,
    "completedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SettlementZone_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ZoneProject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "governmentId" TEXT NOT NULL,
    "constructionCompanyId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "zoneType" TEXT NOT NULL,
    "goodsCost" REAL NOT NULL,
    "treasuryCost" REAL NOT NULL,
    "buildTimeHours" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" DATETIME,
    "completesAt" DATETIME,
    "completedAt" DATETIME,
    "cancelledAt" DATETIME,
    CONSTRAINT "ZoneProject_governmentId_fkey" FOREIGN KEY ("governmentId") REFERENCES "Government" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ZoneProject_constructionCompanyId_fkey" FOREIGN KEY ("constructionCompanyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ZoneProject_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SettlementZone_settlementId_idx" ON "SettlementZone"("settlementId");

-- CreateIndex
CREATE INDEX "ZoneProject_governmentId_idx" ON "ZoneProject"("governmentId");

-- CreateIndex
CREATE INDEX "ZoneProject_constructionCompanyId_idx" ON "ZoneProject"("constructionCompanyId");

-- CreateIndex
CREATE INDEX "ZoneProject_settlementId_idx" ON "ZoneProject"("settlementId");
