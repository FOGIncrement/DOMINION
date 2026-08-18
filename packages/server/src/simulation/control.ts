import { prisma } from "../db.js";

export interface ControllableCompany {
  id: string;
  ownerId: string | null;
  isPublic: boolean;
  sharesOutstanding: number;
}

/**
 * Control is computed, never stored: whoever holds a strict majority (>50%)
 * of a public company's shares controls it; otherwise (fragmented
 * ownership, or the company isn't public at all) the founder retains
 * control. Returns null when no player controls it — an NPC investor holds
 * the majority, a real and intended outcome, not an edge case to special-case
 * away.
 */
export async function getControllingPlayerId(company: ControllableCompany): Promise<string | null> {
  if (!company.isPublic || company.sharesOutstanding <= 0) {
    return company.ownerId;
  }

  const topHolding = await prisma.shareholding.findFirst({
    where: { companyId: company.id },
    orderBy: { shares: "desc" },
  });

  if (topHolding && topHolding.shares > company.sharesOutstanding * 0.5) {
    return topHolding.playerId ?? null;
  }

  return company.ownerId;
}

/** Human-readable label for whoever currently controls a company, for display and for news events. */
export async function getControllerLabel(company: ControllableCompany): Promise<string> {
  if (!company.isPublic || company.sharesOutstanding <= 0) {
    return "Founder";
  }

  const topHolding = await prisma.shareholding.findFirst({
    where: { companyId: company.id },
    orderBy: { shares: "desc" },
    include: { player: { include: { settlement: true } }, npcInvestor: true },
  });

  if (topHolding && topHolding.shares > company.sharesOutstanding * 0.5) {
    if (topHolding.playerId) return topHolding.player?.settlement?.name ?? "A player";
    if (topHolding.npcInvestorId) return topHolding.npcInvestor?.name ?? "An investor";
  }

  return "Founder (no majority holder)";
}

/**
 * Writes a news event when a share trade just crossed the 50% control
 * threshold — either direction (a takeover, or a reversion to fragmented/
 * founder control after a controlling stake is sold down). Shared by the
 * player trade route and the NPC investor tick so both paths announce
 * takeovers the same way.
 */
export async function announceControlChangeIfAny(
  company: ControllableCompany & { name: string },
  beforeControllerId: string | null,
): Promise<void> {
  const afterControllerId = await getControllingPlayerId(company);
  if (afterControllerId === beforeControllerId) return;

  const controllerLabel = await getControllerLabel(company);
  await prisma.event.create({
    data: {
      type: "ownership_change",
      title: "Ownership Change",
      description: `${controllerLabel} now controls ${company.name}.`,
    },
  });
}
