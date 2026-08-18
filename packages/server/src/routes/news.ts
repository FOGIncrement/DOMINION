import { Router } from "express";
import { prisma } from "../db.js";

export const newsRouter = Router();

newsRouter.get("/", async (_req, res) => {
  const events = await prisma.event.findMany({
    orderBy: { occurredAt: "desc" },
    take: 50,
    include: { settlement: { select: { name: true } } },
  });

  res.json({
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      title: e.title,
      description: e.description,
      settlementName: e.settlement?.name ?? null,
      occurredAt: e.occurredAt,
    })),
  });
});
