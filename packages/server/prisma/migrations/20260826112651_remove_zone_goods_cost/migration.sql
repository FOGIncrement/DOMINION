-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ZoneProject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "governmentId" TEXT NOT NULL,
    "constructionCompanyId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "zoneType" TEXT NOT NULL,
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
INSERT INTO "new_ZoneProject" ("acceptedAt", "buildTimeHours", "cancelledAt", "completedAt", "completesAt", "constructionCompanyId", "createdAt", "governmentId", "id", "settlementId", "treasuryCost", "zoneType") SELECT "acceptedAt", "buildTimeHours", "cancelledAt", "completedAt", "completesAt", "constructionCompanyId", "createdAt", "governmentId", "id", "settlementId", "treasuryCost", "zoneType" FROM "ZoneProject";
DROP TABLE "ZoneProject";
ALTER TABLE "new_ZoneProject" RENAME TO "ZoneProject";
CREATE INDEX "ZoneProject_governmentId_idx" ON "ZoneProject"("governmentId");
CREATE INDEX "ZoneProject_constructionCompanyId_idx" ON "ZoneProject"("constructionCompanyId");
CREATE INDEX "ZoneProject_settlementId_idx" ON "ZoneProject"("settlementId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Construction is now a contractOnly industry (see CompanyIndustryDef) —
-- it no longer buys input or produces/sells goods at all, so any stock a
-- construction company had already accumulated under the old model is
-- dead data going forward (the sell route now rejects it outright). Reset
-- it rather than leave it stranded, for both existing local dev companies
-- and whatever's already accumulated in production since zoning shipped.
UPDATE "Company" SET "inputStock" = 0, "goodsStock" = 0 WHERE "industry" = 'construction';
