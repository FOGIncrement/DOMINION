-- DropIndex
DROP INDEX "Building_settlementId_idx";

-- DropIndex
DROP INDEX "SettlementTech_settlementId_techId_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Building";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "SettlementTech";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Player" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenSnapshot" TEXT,
    "tutorialStep" TEXT NOT NULL DEFAULT 'found_company',
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "currencyCode" TEXT NOT NULL DEFAULT 'EUR',
    "armyStrength" REAL NOT NULL DEFAULT 0,
    "lastAttackAt" DATETIME
);
INSERT INTO "new_Player" ("armyStrength", "createdAt", "email", "id", "isAdmin", "lastAttackAt", "lastSeenAt", "lastSeenSnapshot", "passwordHash", "tutorialStep") SELECT "armyStrength", "createdAt", "email", "id", "isAdmin", "lastAttackAt", "lastSeenAt", "lastSeenSnapshot", "passwordHash", "tutorialStep" FROM "Player";
DROP TABLE "Player";
ALTER TABLE "new_Player" RENAME TO "Player";
CREATE UNIQUE INDEX "Player_email_key" ON "Player"("email");
CREATE TABLE "new_Settlement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playerId" TEXT,
    "name" TEXT NOT NULL,
    "archetype" TEXT,
    "era" INTEGER NOT NULL DEFAULT 1,
    "food" REAL NOT NULL,
    "gold" REAL NOT NULL,
    "storageCap" REAL NOT NULL,
    "lastTickAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "foundedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "worldCol" INTEGER,
    "worldRow" INTEGER,
    CONSTRAINT "Settlement_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Settlement" ("archetype", "era", "food", "foundedAt", "gold", "id", "lastTickAt", "name", "playerId", "storageCap", "worldCol", "worldRow") SELECT "archetype", "era", "food", "foundedAt", "gold", "id", "lastTickAt", "name", "playerId", "storageCap", "worldCol", "worldRow" FROM "Settlement";
DROP TABLE "Settlement";
ALTER TABLE "new_Settlement" RENAME TO "Settlement";
CREATE UNIQUE INDEX "Settlement_playerId_key" ON "Settlement"("playerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
