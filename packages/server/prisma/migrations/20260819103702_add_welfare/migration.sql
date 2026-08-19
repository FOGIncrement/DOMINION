-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Government" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playerId" TEXT NOT NULL,
    "treasury" REAL NOT NULL DEFAULT 0,
    "incomeTaxRate" REAL NOT NULL DEFAULT 0,
    "corporateTaxRate" REAL NOT NULL DEFAULT 0,
    "welfareRatePerUnemployedPerHour" REAL NOT NULL DEFAULT 0.5,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Government_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Government" ("corporateTaxRate", "createdAt", "id", "incomeTaxRate", "playerId", "treasury") SELECT "corporateTaxRate", "createdAt", "id", "incomeTaxRate", "playerId", "treasury" FROM "Government";
DROP TABLE "Government";
ALTER TABLE "new_Government" RENAME TO "Government";
CREATE UNIQUE INDEX "Government_playerId_key" ON "Government"("playerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
