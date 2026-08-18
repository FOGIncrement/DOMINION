import { prisma } from "./db.js";

export const OFFLINE_THRESHOLD_SECONDS = 90;

export interface ResourceSnapshot {
  food: number;
  wood: number;
  stone: number;
  gold: number;
  population: number;
}

export interface OfflineSummary {
  awaySeconds: number;
  resourceDeltas: { food: number; wood: number; stone: number; gold: number };
  populationDelta: number;
  events: { id: string; title: string; description: string; occurredAt: Date }[];
}

/**
 * Diffs the caller's current state against the snapshot taken at their last
 * visit and rolls the baseline forward. Only surfaces a summary when the gap
 * since the last visit exceeds OFFLINE_THRESHOLD_SECONDS, so routine polling
 * during an active session never pops the "while you were away" modal —
 * only genuinely returning to the game after a break does.
 */
export async function computeOfflineSummaryAndAdvance(
  playerId: string,
  settlementId: string,
  current: ResourceSnapshot,
): Promise<OfflineSummary | null> {
  const player = await prisma.player.findUniqueOrThrow({ where: { id: playerId } });
  const now = new Date();
  const gapSeconds = (now.getTime() - player.lastSeenAt.getTime()) / 1000;

  let summary: OfflineSummary | null = null;

  if (gapSeconds > OFFLINE_THRESHOLD_SECONDS && player.lastSeenSnapshot) {
    const prev = JSON.parse(player.lastSeenSnapshot) as ResourceSnapshot;
    const events = await prisma.event.findMany({
      where: {
        occurredAt: { gt: player.lastSeenAt },
        OR: [{ settlementId }, { settlementId: null }],
      },
      orderBy: { occurredAt: "asc" },
      take: 20,
    });

    summary = {
      awaySeconds: Math.round(gapSeconds),
      resourceDeltas: {
        food: current.food - prev.food,
        wood: current.wood - prev.wood,
        stone: current.stone - prev.stone,
        gold: current.gold - prev.gold,
      },
      populationDelta: current.population - prev.population,
      events: events.map((e) => ({
        id: e.id,
        title: e.title,
        description: e.description,
        occurredAt: e.occurredAt,
      })),
    };
  }

  await prisma.player.update({
    where: { id: playerId },
    data: { lastSeenAt: now, lastSeenSnapshot: JSON.stringify(current) },
  });

  return summary;
}
