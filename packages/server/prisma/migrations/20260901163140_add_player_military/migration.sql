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
    "armyStrength" REAL NOT NULL DEFAULT 0,
    "lastAttackAt" DATETIME
);
INSERT INTO "new_Player" ("createdAt", "email", "id", "isAdmin", "lastSeenAt", "lastSeenSnapshot", "passwordHash", "tutorialStep") SELECT "createdAt", "email", "id", "isAdmin", "lastSeenAt", "lastSeenSnapshot", "passwordHash", "tutorialStep" FROM "Player";
DROP TABLE "Player";
ALTER TABLE "new_Player" RENAME TO "Player";
CREATE UNIQUE INDEX "Player_email_key" ON "Player"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
