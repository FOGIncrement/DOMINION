import { Router } from "express";
import { z } from "zod";
import { COMPANY_INDUSTRIES, CONTRACT_TERM_HOURS_OPTIONS, type CompanyIndustryId } from "@dominion/shared";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/index.js";

export const contractsRouter = Router();
contractsRouter.use(requireAuth);

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
      buyerCompanyId: c.buyerCompanyId,
      buyerCompanyName: c.buyer.name,
      resourceType: c.resourceType,
      quantityPerHour: c.quantityPerHour,
      pricePerUnit: c.pricePerUnit,
      createdAt: c.createdAt,
      expiresAt: c.expiresAt,
      cancelledAt: c.cancelledAt,
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

// v1 scope: both companies must be controlled by the requesting player — a
// player setting up vertical integration within their own portfolio, not a
// cross-player negotiation. See the Contract model's doc comment for why.
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
  if (!seller || seller.closedAt || seller.ownerId !== req.playerId) {
    res.status(404).json({ error: "Seller company not found or not controlled by you" });
    return;
  }
  if (!buyer || buyer.closedAt || buyer.ownerId !== req.playerId) {
    res.status(404).json({ error: "Buyer company not found or not controlled by you" });
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

  const contract = await prisma.contract.create({
    data: {
      sellerCompanyId,
      buyerCompanyId,
      resourceType: sellerIndustry.outputResource,
      quantityPerHour,
      pricePerUnit,
      expiresAt: new Date(Date.now() + termHours * 60 * 60 * 1000),
    },
  });

  res.status(201).json({ ok: true, contractId: contract.id });
});

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
