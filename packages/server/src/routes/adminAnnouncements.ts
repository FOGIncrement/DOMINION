import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/index.js";
import { requireAdmin } from "../auth/requireAdmin.js";

// Same gating idiom as adminConfigRouter — a standing admin tool, not a
// disposable cheat, so it's requireAuth+requireAdmin only, not ENABLE_CHEATS.
export const adminAnnouncementsRouter = Router();
adminAnnouncementsRouter.use(requireAuth, requireAdmin);

const createSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(2000),
});

adminAnnouncementsRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const announcement = await prisma.announcement.create({
    data: { title: parsed.data.title, body: parsed.data.body, authorId: req.playerId! },
  });

  res.status(201).json({ ok: true, id: announcement.id });
});

adminAnnouncementsRouter.delete("/:id", async (req, res) => {
  const announcement = await prisma.announcement.findUnique({ where: { id: req.params.id } });
  if (!announcement) {
    res.status(404).json({ error: "Announcement not found" });
    return;
  }
  await prisma.announcement.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});
