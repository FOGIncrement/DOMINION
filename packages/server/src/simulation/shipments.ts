// Delivers matured contract shipments (see companyPosition.ts for how a
// shipment's dueAt is computed at dispatch, in engine.ts's Contracts
// block). Each matured row gets its own $transaction — unlike the
// Contracts block's per-tick ledger-Map idiom, a plain atomic `increment`
// per row is sufficient here: nothing about one shipment's delivery
// depends on another's within the same sweep, so there's no stale-
// snapshot risk to guard against.
import { prisma } from "../db.js";

export async function deliverMaturedShipments(now: Date): Promise<{ delivered: number; skippedClosedBuyer: number }> {
  const matured = await prisma.shipment.findMany({
    where: { deliveredAt: null, dueAt: { lte: now } },
    include: { buyer: { select: { closedAt: true } } },
  });

  let delivered = 0;
  let skippedClosedBuyer = 0;
  for (const shipment of matured) {
    // The buyer closed sometime between dispatch and arrival — the goods
    // are simply not credited (no reconciliation system, no error); the
    // row still gets marked delivered so it stops being swept every tick.
    if (shipment.buyer.closedAt) {
      await prisma.shipment.update({ where: { id: shipment.id }, data: { deliveredAt: now } });
      skippedClosedBuyer++;
      continue;
    }

    await prisma.$transaction([
      prisma.companyResourceStock.upsert({
        where: { companyId_resourceType: { companyId: shipment.buyerCompanyId, resourceType: shipment.resourceType } },
        create: { companyId: shipment.buyerCompanyId, resourceType: shipment.resourceType, amount: shipment.quantity },
        update: { amount: { increment: shipment.quantity } },
      }),
      prisma.shipment.update({ where: { id: shipment.id }, data: { deliveredAt: now } }),
    ]);
    delivered++;
  }

  return { delivered, skippedClosedBuyer };
}
