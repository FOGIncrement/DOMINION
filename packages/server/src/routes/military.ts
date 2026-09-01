import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/index.js";
import { getConfig } from "../gameConfigStore.js";
import { getAdjacentSeeds } from "../worldgen/loadedAdjacency.js";
import { getOrCreateGovernment } from "./government.js";
import { computeStatus } from "./territory.js";

export const militaryRouter = Router();
militaryRouter.use(requireAuth);

militaryRouter.get("/mine", async (req: AuthedRequest, res) => {
  const player = await prisma.player.findUnique({
    where: { id: req.playerId! },
    select: { armyStrength: true, lastAttackAt: true },
  });
  const tuning = getConfig().MILITARY_TUNING;
  let cooldownRemainingSeconds = 0;
  if (player!.lastAttackAt) {
    const elapsedMs = Date.now() - player!.lastAttackAt.getTime();
    const cooldownMs = tuning.attackCooldownHours * 60 * 60 * 1000;
    cooldownRemainingSeconds = Math.max(0, Math.ceil((cooldownMs - elapsedMs) / 1000));
  }
  res.json({ armyStrength: player!.armyStrength, lastAttackAt: player!.lastAttackAt, cooldownRemainingSeconds });
});

const raiseSchema = z.object({ goldAmount: z.number().positive() });

militaryRouter.post("/raise", async (req: AuthedRequest, res) => {
  const parsed = raiseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid amount" });
    return;
  }

  const government = await getOrCreateGovernment(req.playerId!);
  if (government.treasury < parsed.data.goldAmount) {
    res.status(400).json({ error: "Not enough treasury funds" });
    return;
  }

  const tuning = getConfig().MILITARY_TUNING;
  const strengthGained = parsed.data.goldAmount * tuning.strengthPerGold;
  const [, player] = await prisma.$transaction([
    prisma.government.update({
      where: { id: government.id },
      data: { treasury: government.treasury - parsed.data.goldAmount },
    }),
    prisma.player.update({ where: { id: req.playerId! }, data: { armyStrength: { increment: strengthGained } } }),
  ]);
  res.json({ ok: true, armyStrength: player.armyStrength });
});

const attackSchema = z.object({ targetSeedIndex: z.number().int() });

// Only contests actively-held land — a target with no Territory row
// (unclaimed) or whose computed status is "abandoned" is rejected here and
// pointed at the peaceful claim endpoint instead (territory.ts's
// POST /:seedIndex/claim), which already handles both of those cases.
// Combat is specifically for taking land out from under an active/dormant
// owner. See the Phase 4 plan for the full combat design.
militaryRouter.post("/attack", async (req: AuthedRequest, res) => {
  const parsed = attackSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid target" });
    return;
  }
  const targetSeedIndex = parsed.data.targetSeedIndex;

  const target = await prisma.territory.findUnique({
    where: { seedIndex: targetSeedIndex },
    include: { owner: { select: { id: true, lastSeenAt: true, armyStrength: true } } },
  });
  if (!target) {
    res.status(400).json({ error: "That territory is unclaimed — claim it peacefully instead" });
    return;
  }
  if (target.ownerId === req.playerId!) {
    res.status(400).json({ error: "You already own this territory" });
    return;
  }

  const now = new Date();
  const targetStatus = computeStatus(target.owner.lastSeenAt, now);
  if (targetStatus === "abandoned") {
    res.status(400).json({ error: "This territory is abandoned — claim it peacefully instead" });
    return;
  }

  const attacker = await prisma.player.findUnique({
    where: { id: req.playerId! },
    select: { armyStrength: true, lastAttackAt: true },
  });
  const tuning = getConfig().MILITARY_TUNING;
  if (attacker!.lastAttackAt) {
    const elapsedHours = (now.getTime() - attacker!.lastAttackAt.getTime()) / (1000 * 60 * 60);
    if (elapsedHours < tuning.attackCooldownHours) {
      const remainingHours = tuning.attackCooldownHours - elapsedHours;
      res.status(400).json({ error: `Your army needs to recover — ${remainingHours.toFixed(1)}h left on cooldown` });
      return;
    }
  }
  if (attacker!.armyStrength <= 0) {
    res.status(400).json({ error: "You have no army to attack with — raise one first" });
    return;
  }

  const attackerTerritories = await prisma.territory.findMany({
    where: { ownerId: req.playerId! },
    select: { seedIndex: true },
  });
  const isAdjacent = attackerTerritories.some((t) => getAdjacentSeeds(t.seedIndex).includes(targetSeedIndex));
  if (!isAdjacent) {
    res.status(400).json({ error: "That territory isn't adjacent to any land you own" });
    return;
  }

  // One all-in roll — attacking commits 100% of current armyStrength, no
  // partial commitment. Jitter applied to both sides; defenderBonusMultiplier
  // makes attacking meaningfully harder than defending.
  const jitter = tuning.attackRandomJitter;
  const attackerPower = attacker!.armyStrength * (1 + (Math.random() * 2 - 1) * jitter);
  const defenderPower = target.owner.armyStrength * tuning.defenderBonusMultiplier * (1 + (Math.random() * 2 - 1) * jitter);
  const won = attackerPower > defenderPower;

  // Attacker's strength always drops to 0 and starts the cooldown, win or
  // lose. On a win, the territory transfers and the defender's strength
  // drops to 0 too. On a loss, the defender keeps the territory and keeps a
  // majority of their strength — a successful defense still costs something.
  await prisma.$transaction([
    prisma.player.update({ where: { id: req.playerId! }, data: { armyStrength: 0, lastAttackAt: now } }),
    won
      ? prisma.territory.update({ where: { seedIndex: targetSeedIndex }, data: { ownerId: req.playerId!, claimedAt: now } })
      : prisma.player.update({
          where: { id: target.ownerId },
          data: { armyStrength: target.owner.armyStrength * (1 - tuning.defenderStrengthLossFractionOnWin) },
        }),
    ...(won ? [prisma.player.update({ where: { id: target.ownerId }, data: { armyStrength: 0 } })] : []),
  ]);

  res.json({ ok: true, won, attackerPower, defenderPower, territorySeedIndex: targetSeedIndex });
});
