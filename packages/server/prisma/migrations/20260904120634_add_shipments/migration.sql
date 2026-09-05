-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contractId" TEXT NOT NULL,
    "sellerCompanyId" TEXT NOT NULL,
    "buyerCompanyId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "originWorldX" REAL NOT NULL,
    "originWorldY" REAL NOT NULL,
    "destWorldX" REAL NOT NULL,
    "destWorldY" REAL NOT NULL,
    "distanceKm" REAL NOT NULL,
    "dispatchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" DATETIME NOT NULL,
    "deliveredAt" DATETIME,
    CONSTRAINT "Shipment_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Shipment_sellerCompanyId_fkey" FOREIGN KEY ("sellerCompanyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Shipment_buyerCompanyId_fkey" FOREIGN KEY ("buyerCompanyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Shipment_deliveredAt_dueAt_idx" ON "Shipment"("deliveredAt", "dueAt");

-- CreateIndex
CREATE INDEX "Shipment_buyerCompanyId_idx" ON "Shipment"("buyerCompanyId");
