-- CreateTable
CREATE TABLE "Bond" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "governmentId" TEXT NOT NULL,
    "holderId" TEXT NOT NULL,
    "principal" REAL NOT NULL,
    "interestRatePerHour" REAL NOT NULL,
    "termHours" INTEGER NOT NULL,
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "maturesAt" DATETIME NOT NULL,
    "redeemedAt" DATETIME,
    CONSTRAINT "Bond_governmentId_fkey" FOREIGN KEY ("governmentId") REFERENCES "Government" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Bond_holderId_fkey" FOREIGN KEY ("holderId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Bond_governmentId_idx" ON "Bond"("governmentId");

-- CreateIndex
CREATE INDEX "Bond_holderId_idx" ON "Bond"("holderId");
