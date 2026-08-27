import { Router } from "express";
import { prisma } from "../db.js";

export const announcementsRouter = Router();

// Public — launcher news isn't sensitive, and the launcher's Hub screen
// fetches this before the user necessarily has a live session (e.g. right
// after a fresh install, before first login).
announcementsRouter.get("/", async (_req, res) => {
  const announcements = await prisma.announcement.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { author: { select: { email: true } } },
  });

  res.json({
    announcements: announcements.map((a) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      authorEmail: a.author.email,
      createdAt: a.createdAt,
    })),
  });
});
