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
    "tutorialStep" TEXT NOT NULL DEFAULT 'found_company'
);
INSERT INTO "new_Player" ("createdAt", "email", "id", "lastSeenAt", "lastSeenSnapshot", "passwordHash") SELECT "createdAt", "email", "id", "lastSeenAt", "lastSeenSnapshot", "passwordHash" FROM "Player";
DROP TABLE "Player";
ALTER TABLE "new_Player" RENAME TO "Player";
CREATE UNIQUE INDEX "Player_email_key" ON "Player"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Every player that exists at the moment this migration runs is, by
-- definition, not a brand-new registration going through the tutorial —
-- backfill them all to "completed" so the Government tab isn't retroactively
-- locked for anyone already playing. Anyone registered AFTER this migration
-- has run gets the column's real default ("found_company") via the normal
-- insert path in routes/auth.ts, untouched by this statement.
UPDATE "Player" SET "tutorialStep" = 'completed';
