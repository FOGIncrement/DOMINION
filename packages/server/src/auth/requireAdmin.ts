import type { NextFunction, Response } from "express";
import { prisma } from "../db.js";
import type { AuthedRequest } from "./index.js";

// Separate file (not auth/index.ts) so that module stays pure crypto/JWT
// with no DB dependency. Must run after requireAuth (needs req.playerId).
// isAdmin is DB-backed rather than baked into the JWT payload, so revoking
// it takes effect immediately rather than waiting out a 30-day cookie.
export async function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.playerId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const player = await prisma.player.findUnique({ where: { id: req.playerId }, select: { isAdmin: true } });
  if (!player?.isAdmin) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}
