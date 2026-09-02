import type { BuildingTypeId, CompanyIndustryId, NpcArchetype } from "@dominion/shared";

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

export interface CompanySnapshot {
  id: string;
  name: string;
  ownerId: string | null;
  industry: CompanyIndustryId;
  cash: number;
  inputStock: number;
  goodsStock: number;
  workersAssigned: number;
  autoStaff: boolean;
  level: number;
  facilityCount: number;
  isPublic: boolean;
  sharesOutstanding: number;
  lastTickAt: Date;
  // Set only for an extraction company founded via the territory-gated path
  // (routes/territory.ts's found-extraction) — see engine.ts's tick loop
  // for how this scales goodsPerWorkerPerHour by the territory's own
  // deposit richness for that resource.
  territorySeedIndex: number | null;
}
