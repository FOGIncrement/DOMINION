import { Router } from "express";
import { z } from "zod";
import { STARTING_TREASURY } from "@dominion/shared";
import { prisma } from "../db.js";
import {
  clearSessionCookie,
  hashPassword,
  setSessionCookie,
  signSession,
  verifyPassword,
  type AuthedRequest,
  requireAuth,
} from "../auth/index.js";
import { createPlayerSettlement } from "../settlementFactory.js";

export const authRouter = Router();

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  settlementName: z.string().min(2).max(40).optional(),
});

authRouter.post("/register", async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const { email, password, settlementName } = parsed.data;

  const existing = await prisma.player.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ error: "An account with that email already exists" });
    return;
  }

  const passwordHash = await hashPassword(password);
  const player = await prisma.player.create({ data: { email, passwordHash } });
  await createPlayerSettlement(player.id, settlementName?.trim() || "New Settlement");
  await prisma.government.create({ data: { playerId: player.id, treasury: STARTING_TREASURY } });

  const token = signSession({ playerId: player.id });
  setSessionCookie(res, token);
  res.status(201).json({ playerId: player.id });
});

authRouter.post("/login", async (req, res) => {
  const parsed = credentialsSchema.pick({ email: true, password: true }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const { email, password } = parsed.data;

  const player = await prisma.player.findUnique({ where: { email } });
  if (!player || !(await verifyPassword(password, player.passwordHash))) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const token = signSession({ playerId: player.id });
  setSessionCookie(res, token);
  res.json({ playerId: player.id });
});

authRouter.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const player = await prisma.player.findUnique({ where: { id: req.playerId! } });
  if (!player) {
    res.status(404).json({ error: "Player not found" });
    return;
  }
  res.json({ playerId: player.id, email: player.email, isAdmin: player.isAdmin });
});
