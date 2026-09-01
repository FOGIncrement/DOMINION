import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/index.js";
import { getConfig } from "../gameConfigStore.js";
import { getMapPreview } from "../worldgen/loadedMapPreview.js";
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

// Every player is meant to hold real land, not just have the *option* to
// claim some via /continent — this backfills anyone with zero territories
// (both brand-new registrations and every pre-existing player, the first
// time they load their dashboard after this shipped) with one random
// claimable seed. Called from GET /game/state; see that route for why.
// Not wrapped in a transaction — same TOCTOU tolerance
// settlementFactory.ts's assignSettlementPlot already accepts for its own
// count-then-create gap. seedIndex is @unique, so a lost race just throws
// on the losing create; swallowed below as benign rather than surfaced,
// since the player picks up land on their next /game/state poll instead.
export async function ensurePlayerTerritory(playerId: string): Promise<void> {
  const owned = await prisma.territory.count({ where: { ownerId: playerId } });
  if (owned > 0) return;

  const unavailable = await getUnavailableSeedIndexes();
  const candidates = getTerritorySeeds().filter((s) => !unavailable.has(s.seedIndex));
  if (candidates.length === 0) return; // no land left — extremely unlikely at ~2000 seeds, don't hard-fail

  const seedIndex = candidates[Math.floor(Math.random() * candidates.length)].seedIndex;
  try {
    await prisma.territory.create({ data: { seedIndex, ownerId: playerId } });
  } catch {
    // Benign race — see comment above.
  }
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

// Claims an unclaimed seed, or transfers an abandoned one — the same path
// either way (see the Phase 2 plan: no separate "purchase" flow for v1).
// Rejects a still-active/dormant seed under someone else, and claiming a
// seed the requester already owns (that's just... already true).
territoryRouter.post("/:seedIndex/claim", async (req: AuthedRequest, res) => {
  const seedIndex = Number(req.params.seedIndex);
  const seed = getSeedByIndex(seedIndex);
  if (!seed) {
    res.status(404).json({ error: "No such territory" });
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
      res.status(400).json({ error: `This territory is still ${status} under its current owner` });
      return;
    }
    const updated = await prisma.territory.update({
      where: { seedIndex },
      data: { ownerId: req.playerId!, claimedAt: new Date() },
    });
    res.json({ ok: true, seedIndex, claimedAt: updated.claimedAt });
    return;
  }

  const created = await prisma.territory.create({ data: { seedIndex, ownerId: req.playerId! } });
  res.status(201).json({ ok: true, seedIndex, claimedAt: created.claimedAt });
});
