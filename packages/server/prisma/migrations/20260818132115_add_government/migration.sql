-- CreateTable
CREATE TABLE "Government" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playerId" TEXT NOT NULL,
    "treasury" REAL NOT NULL DEFAULT 0,
    "incomeTaxRate" REAL NOT NULL DEFAULT 0,
    "corporateTaxRate" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Government_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Government_playerId_key" ON "Government"("playerId");
