import { Router } from "express";
import { z } from "zod";
import { TUTORIAL_STEPS, type TutorialStep } from "@dominion/shared";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/index.js";

export const tutorialRouter = Router();
tutorialRouter.use(requireAuth);

tutorialRouter.get("/", async (req: AuthedRequest, res) => {
  const player = await prisma.player.findUnique({ where: { id: req.playerId! }, select: { tutorialStep: true } });
  res.json({ step: (player?.tutorialStep ?? "completed") as TutorialStep });
});

const advanceSchema = z.object({ step: z.enum(TUTORIAL_STEPS) });

// Only advances if the requested step matches the player's CURRENT step —
// idempotent-safe against the client firing this more than once for the
// same observed condition (e.g. a duplicate query refetch), and impossible
// to skip ahead by replaying an old request out of order.
tutorialRouter.post("/advance", async (req: AuthedRequest, res) => {
  const parsed = advanceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid tutorial step" });
    return;
  }

  const player = await prisma.player.findUnique({ where: { id: req.playerId! }, select: { tutorialStep: true } });
  if (!player) {
    res.status(404).json({ error: "Player not found" });
    return;
  }
  if (player.tutorialStep !== parsed.data.step) {
    res.json({ ok: true, step: player.tutorialStep as TutorialStep }); // no-op, already past (or not yet at) this step
    return;
  }

  const currentIndex = TUTORIAL_STEPS.indexOf(parsed.data.step);
  const nextStep = TUTORIAL_STEPS[currentIndex + 1] ?? "completed";

  await prisma.player.update({ where: { id: req.playerId! }, data: { tutorialStep: nextStep } });
  res.json({ ok: true, step: nextStep });
});

tutorialRouter.post("/skip", async (req: AuthedRequest, res) => {
  await prisma.player.update({ where: { id: req.playerId! }, data: { tutorialStep: "completed" } });
  res.json({ ok: true, step: "completed" });
});
