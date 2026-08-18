import { EVENT_TEMPLATES, RESOURCE_TYPES, type EventTemplateDef, type ResourceType } from "@dominion/shared";
import { prisma } from "../db.js";
import type { SettlementSnapshot } from "./types.js";

const EVENT_CHANCE_PER_TICK = 0.15;

function weightedPick(items: EventTemplateDef[]): EventTemplateDef {
  const total = items.reduce((sum, i) => sum + i.weight, 0);
  let roll = Math.random() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

export async function maybeRollEvent(settlements: SettlementSnapshot[]): Promise<void> {
  if (settlements.length === 0 || Math.random() > EVENT_CHANCE_PER_TICK) return;

  const template = weightedPick(EVENT_TEMPLATES);

  if (template.scope === "world") {
    await prisma.event.create({
      data: {
        settlementId: null,
        type: template.id,
        title: template.title,
        description: template.description,
      },
    });
    return;
  }

  const target = settlements[Math.floor(Math.random() * settlements.length)];

  await prisma.event.create({
    data: {
      settlementId: target.id,
      type: template.id,
      title: template.title,
      description: `${template.description} — ${target.name}`,
    },
  });

  if (template.resourceEffect) {
    const current = await prisma.settlement.findUniqueOrThrow({ where: { id: target.id } });
    const data: Partial<Record<ResourceType, number>> = {};
    for (const resourceType of RESOURCE_TYPES) {
      const effect = template.resourceEffect[resourceType];
      if (effect) {
        data[resourceType] = Math.max(0, Math.min(current.storageCap, current[resourceType] + effect));
      }
    }
    await prisma.settlement.update({ where: { id: target.id }, data });
  }
}
