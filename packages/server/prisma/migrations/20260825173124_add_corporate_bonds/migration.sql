-- CreateTable
CREATE TABLE "CorporateBond" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "holderId" TEXT NOT NULL,
    "principal" REAL NOT NULL,
    "interestRatePerHour" REAL NOT NULL,
    "termHours" INTEGER NOT NULL,
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "maturesAt" DATETIME NOT NULL,
    "redeemedAt" DATETIME,
    CONSTRAINT "CorporateBond_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CorporateBond_holderId_fkey" FOREIGN KEY ("holderId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CorporateBond_companyId_idx" ON "CorporateBond"("companyId");

-- CreateIndex
CREATE INDEX "CorporateBond_holderId_idx" ON "CorporateBond"("holderId");
