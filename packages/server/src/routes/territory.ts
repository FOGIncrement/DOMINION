import { Router } from "express";
import { z } from "zod";
import { COMPANY_INDUSTRY_IDS } from "@dominion/shared";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/index.js";
import { getConfig } from "../gameConfigStore.js";
import { getMapPreview } from "../worldgen/loadedMapPreview.js";
import { getTerritoryCrop } from "../worldgen/loadedTerritoryCrop.js";
import { getSeedByIndex, getTerritorySeeds } from "../worldgen/loadedTerritoryData.js";

export const territoryRouter = Router();
territoryRouter.use(requireAuth);

export type TerritoryStatus = "active" | "dormant" | "abandoned";

// No stored status column on Territory — this is computed from the owning
// Player's lastSeenAt (already the authoritative "last time this player
// actually played" signal, see offlineSummary.ts) against two tunable day
// thresholds. That's also what makes reclaim automatic: a returning
// player's lastSeenAt refreshes the moment they play again, with zero
// extra code here — their territory's computed status just flips back.
// Exported for routes/military.ts, which needs the same status definition
// to decide whether a target is fair game for a peaceful claim vs. combat.
export function computeStatus(lastSeenAt: Date, now: Date): TerritoryStatus {
  const tuning = getConfig().TERRITORY_TUNING;
  const daysSince = (now.getTime() - lastSeenAt.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince >= tuning.abandonedAfterDays) return "abandoned";
  if (daysSince >= tuning.dormantAfterDays) return "dormant";
  return "active";
}

const PAGE_SIZE = 50;

// Every seed with a Territory row that's still active/dormant under its
// current owner — abandoned ones are excluded from this set (they're
// available again, same as never-claimed seeds), no separate "purchase"
// path (see the Phase 2 plan). Shared by /available (below) and
// ensurePlayerTerritory (below) so both agree on what "claimable" means
// without duplicating the query.
export async function getUnavailableSeedIndexes(): Promise<Set<number>> {
  const claimed = await prisma.territory.findMany({ include: { owner: { select: { lastSeenAt: true } } } });
  const now = new Date();
  return new Set(
    claimed.filter((t) => computeStatus(t.owner.lastSeenAt, now) !== "abandoned").map((t) => t.seedIndex),
  );
}

// A new territory is a blank slate — no passive income, just a one-time
// gold grant sized to found exactly one land-gated company on it (see
// POST /:seedIndex/found below). Called once per territory gained, from
// every path that gives a player one: this claim route (both branches),
// ensurePlayerTerritory, and military.ts's won-attack branch. Additive
// (Settlement.gold += grant), not "top up to," so it's a real bundle every
// time, not a one-off floor.
export async function grantExtractionStarterBundle(playerId: string): Promise<void> {
  const grant = getConfig().TERRITORY_TUNING.extractionStarterGrant;
  await prisma.settlement.update({ where: { playerId }, data: { gold: { increment: grant } } });
}

// "Available" = every baked seed except ones with a Territory row that's
// still active/dormant under its current owner — abandoned ones are
// available again, same as never-claimed ones, no separate "purchase" path
// (see the Phase 2 plan).
territoryRouter.get("/available", async (req: AuthedRequest, res) => {
  const page = Math.max(0, Math.floor(Number(req.query.page)) || 0);
  const allSeeds = getTerritorySeeds();

  const unavailable = await getUnavailableSeedIndexes();

  const available = allSeeds.filter((s) => !unavailable.has(s.seedIndex));
  const pageItems = available.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  res.json({ total: available.length, page, pageSize: PAGE_SIZE, territories: pageItems });
});

territoryRouter.get("/mine", async (req: AuthedRequest, res) => {
  const territories = await prisma.territory.findMany({
    where: { ownerId: req.playerId! },
    include: { owner: { select: { lastSeenAt: true } } },
    orderBy: { claimedAt: "asc" },
  });
  const now = new Date();
  res.json({
    territories: territories.map((t) => ({
      ...getSeedByIndex(t.seedIndex),
      status: computeStatus(t.owner.lastSeenAt, now),
      claimedAt: t.claimedAt,
    })),
  });
});

// Native-resolution (no downsampling, unlike /preview) crop of just the
// requesting player's own owned territory — powers the "My Territory" page.
// Small payload despite full resolution since it's cropped tightly to the
// player's own land, not the whole continent.
territoryRouter.get("/mine/detail", async (req: AuthedRequest, res) => {
  const territories = await prisma.territory.findMany({
    where: { ownerId: req.playerId! },
    select: { seedIndex: true },
  });
  const crop = getTerritoryCrop(territories.map((t) => t.seedIndex));
  if (!crop) {
    res.status(404).json({ error: "You don't hold any territory yet" });
    return;
  }
  res.json({
    cols: crop.cols,
    rows: crop.rows,
    cellSizeKm: crop.cellSizeKm,
    biomeIds: crop.biomeIds,
    biome: Buffer.from(crop.biome).toString("base64"),
    seed: Buffer.from(crop.seed.buffer, crop.seed.byteOffset, crop.seed.byteLength).toString("base64"),
    noSeedSentinel: crop.noSeedSentinel,
    offsetWorldX: crop.offsetWorldX,
    offsetWorldY: crop.offsetWorldY,
  });
});

// Static geometry only (biome + which seed owns each cell) — cached forever
// server-side (see loadedMapPreview.ts), so this response never changes
// without a worldgen rerun + restart. Deliberately separate from /claims
// (which does change constantly) so the client can fetch this megabyte-ish
// payload exactly once and poll only the small claims list afterward,
// instead of re-downloading the whole raster on every poll tick.
territoryRouter.get("/preview", (_req: AuthedRequest, res) => {
  const preview = getMapPreview();
  res.json({
    cols: preview.cols,
    rows: preview.rows,
    cellSizeKm: preview.cellSizeKm,
    biomeIds: preview.biomeIds,
    biome: Buffer.from(preview.biome).toString("base64"),
    seed: Buffer.from(preview.seed.buffer, preview.seed.byteOffset, preview.seed.byteLength).toString("base64"),
    noSeedSentinel: preview.noSeedSentinel,
  });
});

// Every currently-claimed seed with its owning player's status — small (one
// row per claimed territory, not per seed), so this is safe to poll on the
// normal interval unlike /preview above.
territoryRouter.get("/claims", async (req: AuthedRequest, res) => {
  const claimed = await prisma.territory.findMany({
    include: { owner: { select: { lastSeenAt: true, settlement: { select: { name: true } } } } },
  });
  const now = new Date();
  res.json({
    claims: claimed.map((t) => ({
      seedIndex: t.seedIndex,
      ownerId: t.ownerId,
      ownerLabel: t.owner.settlement?.name ?? "Unknown",
      status: computeStatus(t.owner.lastSeenAt, now),
      isMine: t.ownerId === req.playerId,
    })),
  });
});

territoryRouter.get("/:seedIndex", async (req: AuthedRequest, res) => {
  const seedIndex = Number(req.params.seedIndex);
  const seed = getSeedByIndex(seedIndex);
  if (!seed) {
    res.status(404).json({ error: "No such territory" });
    return;
  }

  const territory = await prisma.territory.findUnique({
    where: { seedIndex },
    include: { owner: { select: { lastSeenAt: true } } },
  });
  if (!territory) {
    res.json({ ...seed, status: "unclaimed", ownerId: null, isMine: false });
    return;
  }
  res.json({
    ...seed,
    status: computeStatus(territory.owner.lastSeenAt, new Date()),
    ownerId: territory.ownerId,
    isMine: territory.ownerId === req.playerId,
    claimedAt: territory.claimedAt,
  });
});

// Free, but only for a player's very first territory — the "choose your
// starting land" onboarding flow (see Continent.tsx's picking mode). Claims
// an unclaimed seed, or transfers an abandoned one, the same path either
// way. Once a player already owns land, this route is closed off entirely —
// POST /:seedIndex/buy (below) is the paid path for everything after that,
// and POST /military/attack is the path for taking active/dormant land by
// force.
territoryRouter.post("/:seedIndex/claim", async (req: AuthedRequest, res) => {
  const seedIndex = Number(req.params.seedIndex);
  const seed = getSeedByIndex(seedIndex);
  if (!seed) {
    res.status(404).json({ error: "No such territory" });
    return;
  }

  const owned = await prisma.territory.count({ where: { ownerId: req.playerId! } });
  if (owned > 0) {
    res.status(400).json({ error: "You already hold territory — buy unclaimed land or conquer it instead" });
    return;
  }

  const existing = await prisma.territory.findUnique({
    where: { seedIndex },
    include: { owner: { select: { lastSeenAt: true } } },
  });

  if (existing) {
    const status = computeStatus(existing.owner.lastSeenAt, new Date());
    if (status !== "abandoned") {
      res.status(400).json({ error: `This territory is still ${status} under its current owner` });
      return;
    }
    const updated = await prisma.territory.update({
      where: { seedIndex },
      data: { ownerId: req.playerId!, claimedAt: new Date() },
    });
    await grantExtractionStarterBundle(req.playerId!);
    res.json({ ok: true, seedIndex, claimedAt: updated.claimedAt });
    return;
  }

  const created = await prisma.territory.create({ data: { seedIndex, ownerId: req.playerId! } });
  await grantExtractionStarterBundle(req.playerId!);
  res.status(201).json({ ok: true, seedIndex, claimedAt: created.claimedAt });
});

// The paid counterpart to /claim, for every territory after a player's
// first — same unclaimed/abandoned eligibility, but requires the requester
// to already own land (the inverse guard from /claim, so the two error
// messages point players to the right verb) and charges Government.treasury
// rather than granting for free. Mirrors the debit-then-transfer
// $transaction pattern bonds.ts's POST /buy already uses.
territoryRouter.post("/:seedIndex/buy", async (req: AuthedRequest, res) => {
  const seedIndex = Number(req.params.seedIndex);
  const seed = getSeedByIndex(seedIndex);
  if (!seed) {
    res.status(404).json({ error: "No such territory" });
    return;
  }

  const owned = await prisma.territory.count({ where: { ownerId: req.playerId! } });
  if (owned === 0) {
    res.status(400).json({ error: "Claim your first territory for free before buying more" });
    return;
  }

  const government = await prisma.government.findUnique({ where: { playerId: req.playerId! } });
  if (!government) {
    res.status(404).json({ error: "No government found for this player" });
    return;
  }

  const price = Math.round(seed.areaKm2 * getConfig().TERRITORY_TUNING.buyPricePerKm2);
  if (government.treasury < price) {
    res.status(400).json({ error: `Buying this territory costs ${price}g from your government treasury` });
    return;
  }

  const existing = await prisma.territory.findUnique({
    where: { seedIndex },
    include: { owner: { select: { lastSeenAt: true } } },
  });

  if (existing) {
    if (existing.ownerId === req.playerId!) {
      res.status(400).json({ error: "You already own this territory" });
      return;
    }
    const status = computeStatus(existing.owner.lastSeenAt, new Date());
    if (status !== "abandoned") {
      res.status(400).json({ error: `This territory is still ${status} under its current owner — attack it instead` });
      return;
    }
    const [, updated] = await prisma.$transaction([
      prisma.government.update({ where: { id: government.id }, data: { treasury: { decrement: price } } }),
      prisma.territory.update({ where: { seedIndex }, data: { ownerId: req.playerId!, claimedAt: new Date() } }),
    ]);
    res.json({ ok: true, seedIndex, claimedAt: updated.claimedAt, price });
    return;
  }

  const [, created] = await prisma.$transaction([
    prisma.government.update({ where: { id: government.id }, data: { treasury: { decrement: price } } }),
    prisma.territory.create({ data: { seedIndex, ownerId: req.playerId! } }),
  ]);
  res.status(201).json({ ok: true, seedIndex, claimedAt: created.claimedAt, price });
});

const foundOnTerritorySchema = z.object({
  industry: z.enum(COMPANY_INDUSTRY_IDS),
  name: z.string().min(1).max(60),
});

// A second founding path alongside routes/companies.ts's zoning-gated one —
// deliberately does NOT call computeZoneCategoryUsage at all. Territory
// ownership is this path's whole gate: you must own the land and the
// industry must actually be land-gated (requiresTerritory) — any owned
// territory qualifies for any such industry, no per-resource deposit check
// (see the recipe-economy plan's "Land = ownership gate" decision).
territoryRouter.post("/:seedIndex/found", async (req: AuthedRequest, res) => {
  const seedIndex = Number(req.params.seedIndex);
  const parsed = foundOnTerritorySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
    return;
  }

  const seed = getSeedByIndex(seedIndex);
  if (!seed) {
    res.status(404).json({ error: "No such territory" });
    return;
  }

  const territory = await prisma.territory.findUnique({ where: { seedIndex } });
  if (!territory || territory.ownerId !== req.playerId!) {
    res.status(403).json({ error: "You don't own this territory" });
    return;
  }

  const { industry: industryId, name } = parsed.data;
  const industry = getConfig().COMPANY_INDUSTRIES[industryId];
  if (!industry.requiresTerritory) {
    res.status(400).json({ error: `${industry.name} isn't a land-gated industry — found it through Companies instead` });
    return;
  }

  const existing = await prisma.company.findFirst({
    where: { territorySeedIndex: seedIndex, industry: industryId, closedAt: null },
  });
  if (existing) {
    res.status(400).json({ error: `You've already founded a ${industry.name} on this territory` });
    return;
  }

  const settlement = await prisma.settlement.findUnique({ where: { playerId: req.playerId! } });
  if (!settlement) {
    res.status(404).json({ error: "No settlement found for this player" });
    return;
  }
  if (settlement.gold < industry.foundingCost) {
    res.status(400).json({ error: `Founding a ${industry.name} costs ${industry.foundingCost}g` });
    return;
  }

  const [, company] = await prisma.$transaction([
    prisma.settlement.update({ where: { id: settlement.id }, data: { gold: { decrement: industry.foundingCost } } }),
    prisma.company.create({
      data: {
        ownerId: req.playerId!,
        name,
        industry: industryId,
        cash: industry.foundingCost,
        territorySeedIndex: seedIndex,
      },
    }),
  ]);
  res.status(201).json({ ok: true, companyId: company.id });
});
