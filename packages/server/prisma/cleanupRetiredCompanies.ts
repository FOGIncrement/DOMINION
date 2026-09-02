// One-time cleanup script for the recipe-economy migration (see the Margin
// recipe-economy plan, Implementation item 7). Closes every Company whose
// `industry` is one of the retired/redefined industries from before the
// recipe rework — their stock/config shape no longer matches
// COMPANY_INDUSTRIES, and there are no real players yet (same precedent as
// the territory-partition wipe). `retail` is untouched — it's unchanged by
// the rework. Run once locally and once on the VPS as part of that deploy:
//   npx tsx prisma/cleanupRetiredCompanies.ts
import "dotenv/config";
import { prisma } from "../src/db.js";

const RETIRED_INDUSTRIES = [
  "bakery", // redefined recipe shape — old rows predate CompanyResourceStock
  "sawmill",
  "stoneworks",
  "farming",
  "logging",
  "quarrying",
  "construction",
  "mining",
];

async function main() {
  const distinct = await prisma.company.groupBy({ by: ["industry"], _count: { _all: true } });
  console.log("Current industry distribution:", distinct.map((d) => `${d.industry}=${d._count._all}`).join(", ") || "(no companies)");

  const toClose = await prisma.company.findMany({
    where: { industry: { in: RETIRED_INDUSTRIES }, closedAt: null },
    select: { id: true, name: true, industry: true },
  });

  if (toClose.length === 0) {
    console.log("No companies to close.");
    return;
  }

  console.log(`Closing ${toClose.length} companies:`, toClose.map((c) => `${c.name} (${c.industry})`).join(", "));

  const result = await prisma.company.updateMany({
    where: { id: { in: toClose.map((c) => c.id) } },
    data: { closedAt: new Date() },
  });

  console.log(`Closed ${result.count} companies.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
