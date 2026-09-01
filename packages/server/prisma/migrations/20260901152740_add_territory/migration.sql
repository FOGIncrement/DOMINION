-- CreateTable
CREATE TABLE "Territory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seedIndex" INTEGER NOT NULL,
    "ownerId" TEXT NOT NULL,
    "claimedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Territory_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Territory_seedIndex_key" ON "Territory"("seedIndex");

-- CreateIndex
CREATE INDEX "Territory_ownerId_idx" ON "Territory"("ownerId");
