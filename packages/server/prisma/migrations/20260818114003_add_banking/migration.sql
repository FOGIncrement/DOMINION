-- CreateTable
CREATE TABLE "Bank" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT,
    "name" TEXT NOT NULL,
    "cash" REAL NOT NULL,
    "interestRatePerHour" REAL NOT NULL,
    "foundedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Bank_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Player" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bankId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "principal" REAL NOT NULL,
    "outstandingBalance" REAL NOT NULL,
    "interestRatePerHour" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAccrualAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "defaultedAt" DATETIME,
    CONSTRAINT "Loan_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "Bank" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Loan_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Bank_ownerId_idx" ON "Bank"("ownerId");

-- CreateIndex
CREATE INDEX "Loan_bankId_idx" ON "Loan"("bankId");

-- CreateIndex
CREATE INDEX "Loan_companyId_idx" ON "Loan"("companyId");
