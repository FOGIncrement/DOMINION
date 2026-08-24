/*
  Warnings:

  - Added the required column `termHours` to the `Contract` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Contract" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sellerCompanyId" TEXT NOT NULL,
    "buyerCompanyId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "quantityPerHour" REAL NOT NULL,
    "pricePerUnit" REAL NOT NULL,
    "termHours" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" DATETIME,
    "expiresAt" DATETIME,
    "lastSettledAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" DATETIME,
    CONSTRAINT "Contract_sellerCompanyId_fkey" FOREIGN KEY ("sellerCompanyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Contract_buyerCompanyId_fkey" FOREIGN KEY ("buyerCompanyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Contract" ("buyerCompanyId", "cancelledAt", "createdAt", "expiresAt", "id", "lastSettledAt", "pricePerUnit", "quantityPerHour", "resourceType", "sellerCompanyId") SELECT "buyerCompanyId", "cancelledAt", "createdAt", "expiresAt", "id", "lastSettledAt", "pricePerUnit", "quantityPerHour", "resourceType", "sellerCompanyId" FROM "Contract";
DROP TABLE "Contract";
ALTER TABLE "new_Contract" RENAME TO "Contract";
CREATE INDEX "Contract_sellerCompanyId_idx" ON "Contract"("sellerCompanyId");
CREATE INDEX "Contract_buyerCompanyId_idx" ON "Contract"("buyerCompanyId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
