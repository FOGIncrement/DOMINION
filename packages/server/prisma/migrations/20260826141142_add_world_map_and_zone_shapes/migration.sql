-- AlterTable
ALTER TABLE "Settlement" ADD COLUMN "worldCol" INTEGER;
ALTER TABLE "Settlement" ADD COLUMN "worldRow" INTEGER;

-- AlterTable
ALTER TABLE "SettlementZone" ADD COLUMN "zoneHeight" INTEGER;
ALTER TABLE "SettlementZone" ADD COLUMN "zoneWidth" INTEGER;
ALTER TABLE "SettlementZone" ADD COLUMN "zoneX" INTEGER;
ALTER TABLE "SettlementZone" ADD COLUMN "zoneY" INTEGER;

-- AlterTable
ALTER TABLE "ZoneProject" ADD COLUMN "zoneHeight" INTEGER;
ALTER TABLE "ZoneProject" ADD COLUMN "zoneWidth" INTEGER;
ALTER TABLE "ZoneProject" ADD COLUMN "zoneX" INTEGER;
ALTER TABLE "ZoneProject" ADD COLUMN "zoneY" INTEGER;
