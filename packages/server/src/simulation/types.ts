import type { BuildingTypeId, NpcArchetype } from "@dominion/shared";

export interface SettlementSnapshot {
  id: string;
  name: string;
  playerId: string | null;
  archetype: NpcArchetype | null;
  food: number;
  wood: number;
  stone: number;
  gold: number;
  storageCap: number;
  lastTickAt: Date;
  population: { count: number; growthRate: number; happiness: number };
  buildings: { id: string; type: BuildingTypeId; workersAssigned: number; level: number }[];
  techIds: string[];
}

export interface TickResourceDelta {
  food: number;
  wood: number;
  stone: number;
  gold: number;
}
