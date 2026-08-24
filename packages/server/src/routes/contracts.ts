import { Router } from "express";
import { z } from "zod";
import { COMPANY_INDUSTRIES, CONTRACT_TERM_HOURS_OPTIONS, type CompanyIndustryId } from "@dominion/shared";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/index.js";

export const contractsRouter = Router();
contractsRouter.use(requireAuth);

function statusOf(contract: { cancelledAt: Date | null; acceptedAt: Date | null; expiresAt: Date | null }) {
  if (contract.cancelledAt) return "cancelled";
  if (!contract.acceptedAt) return "pending";
  if (contract.expiresAt && contract.expiresAt <= new Date()) return "expired";
  return "active";
}

contractsRouter.get("/mine", async (req: AuthedRequest, res) => {
  const companies = await prisma.company.findMany({ where: { ownerId: req.playerId! }, select: { id: true } });
  const companyIds = companies.map((c) => c.id);

  const contracts = await prisma.contract.findMany({
    where: { OR: [{ sellerCompanyId: { in: companyIds } }, { buyerCompanyId: { in: companyIds } }] },
    include: { seller: true, buyer: true },
    orderBy: { createdAt: "desc" },
  });

  res.json({
    contracts: contracts.map((c) => ({
      id: c.id,
      sellerCompanyId: c.sellerCompanyId,
      sellerCompanyName: c.seller.name,
      sellerIsMine: c.seller.ownerId === req.playerId,
      buyerCompanyId: c.buyerCompanyId,
      buyerCompanyName: c.buyer.name,
      buyerIsMine: c.buyer.ownerId === req.playerId,
      resourceType: c.resourceType,
      quantityPerHour: c.quantityPerHour,
      pricePerUnit: c.pricePerUnit,
      termHours: c.termHours,
      createdAt: c.createdAt,
      acceptedAt: c.acceptedAt,
      expiresAt: c.expiresAt,
      cancelledAt: c.cancelledAt,
      status: statusOf(c),
    })),
  });
});

const createSchema = z.object({
  sellerCompanyId: z.string(),
  buyerCompanyId: z.string(),
  quantityPerHour: z.number().positive(),
  pricePerUnit: z.number().min(0),
  termHours: z.number().int().positive(),
});

// The proposer must control at least one of the two companies. If the
// counterparty is an NPC or another company the same player controls, the
// contract activates immediately (no negotiation needed — there's nobody
// else to ask, or it's the same economic actor). If the counterparty is
// another player's company, it starts as a pending offer that player must
// accept via POST /:id/accept before it settles.
contractsRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid contract request" });
    return;
  }
  if (!CONTRACT_TERM_HOURS_OPTIONS.includes(parsed.data.termHours)) {
    res.status(400).json({ error: "Not a valid contract term" });
    return;
  }

  const { sellerCompanyId, buyerCompanyId, quantityPerHour, pricePerUnit, termHours } = parsed.data;
  if (sellerCompanyId === buyerCompanyId) {
    res.status(400).json({ error: "A company can't contract with itself" });
    return;
  }

  const [seller, buyer] = await Promise.all([
    prisma.company.findUnique({ where: { id: sellerCompanyId } }),
    prisma.company.findUnique({ where: { id: buyerCompanyId } }),
  ]);
  if (!seller || seller.closedAt) {
    res.status(404).json({ error: "Seller company not found" });
    return;
  }
  if (!buyer || buyer.closedAt) {
    res.status(404).json({ error: "Buyer company not found" });
    return;
  }
  if (seller.ownerId !== req.playerId && buyer.ownerId !== req.playerId) {
    res.status(403).json({ error: "You don't control either company in this proposal" });
    return;
  }

  const sellerIndustry = COMPANY_INDUSTRIES[seller.industry as CompanyIndustryId];
  const buyerIndustry = COMPANY_INDUSTRIES[buyer.industry as CompanyIndustryId];
  if (buyerIndustry.inputResource !== sellerIndustry.outputResource) {
    res.status(400).json({
      error: `${buyerIndustry.name} doesn't use ${sellerIndustry.outputResource} as input — can't contract these two`,
    });
    return;
  }

  const counterparty = seller.ownerId === req.playerId ? buyer : seller;

  // An NPC has nobody to negotiate on its behalf, so it reviews the deal
  // itself instead of auto-accepting whatever's proposed. The bar is
  // deliberately low — can it cover even the first hour from cash on hand —
  // not a full affordability model; it exists to catch "priced miles above
  // what this company could ever pay" (e.g. 25x market rate), not to
  // second-guess every borderline deal. Settlement's own scarcity cap (see
  // settleContract) still applies afterward if the NPC's cash situation
  // changes once the contract is running.
  if (counterparty.ownerId === null && counterparty.id === buyerCompanyId) {
    const firstHourCost = quantityPerHour * pricePerUnit;
    if (firstHourCost > counterparty.cash) {
      res.status(400).json({
        error: `${counterparty.name} rejected the offer — ${quantityPerHour} ${sellerIndustry.outputResource}/hr at ${pricePerUnit}g would cost ${firstHourCost.toFixed(1)}g/hr, but they only have ${Math.max(0, counterparty.cash).toFixed(1)}g on hand. Try a lower price or quantity.`,
      });
      return;
    }
  }

  const needsOffer = counterparty.ownerId !== null && counterparty.ownerId !== req.playerId;
  const now = new Date();

  const contract = await prisma.contract.create({
    data: {
      sellerCompanyId,
      buyerCompanyId,
      resourceType: sellerIndustry.outputResource,
      quantityPerHour,
      pricePerUnit,
      termHours,
      acceptedAt: needsOffer ? null : now,
      expiresAt: needsOffer ? null : new Date(now.getTime() + termHours * 60 * 60 * 1000),
    },
  });

  res.status(201).json({ ok: true, contractId: contract.id, pending: needsOffer });
});

contractsRouter.post("/:id/accept", async (req: AuthedRequest, res) => {
  const contract = await prisma.contract.findUnique({ where: { id: req.params.id }, include: { seller: true, buyer: true } });
  if (!contract) {
    res.status(404).json({ error: "Contract not found" });
    return;
  }
  if (contract.seller.ownerId !== req.playerId && contract.buyer.ownerId !== req.playerId) {
    res.status(403).json({ error: "You don't control either company on this contract" });
    return;
  }
  if (contract.cancelledAt) {
    res.status(400).json({ error: "This offer was cancelled" });
    return;
  }
  if (contract.acceptedAt) {
    res.status(400).json({ error: "Already accepted" });
    return;
  }

  const now = new Date();
  await prisma.contract.update({
    where: { id: contract.id },
    data: { acceptedAt: now, expiresAt: new Date(now.getTime() + contract.termHours * 60 * 60 * 1000), lastSettledAt: now },
  });
  res.json({ ok: true });
});

// Cancels a pending offer (a rejection) or terminates an active contract
// early. Either party can do either — no asymmetry once a relationship exists.
contractsRouter.post("/:id/cancel", async (req: AuthedRequest, res) => {
  const contract = await prisma.contract.findUnique({ where: { id: req.params.id }, include: { seller: true, buyer: true } });
  if (!contract) {
    res.status(404).json({ error: "Contract not found" });
    return;
  }
  if (contract.seller.ownerId !== req.playerId && contract.buyer.ownerId !== req.playerId) {
    res.status(403).json({ error: "You don't control either company on this contract" });
    return;
  }
  if (contract.cancelledAt) {
    res.status(400).json({ error: "Already cancelled" });
    return;
  }

  await prisma.contract.update({ where: { id: contract.id }, data: { cancelledAt: new Date() } });
  res.json({ ok: true });
});
