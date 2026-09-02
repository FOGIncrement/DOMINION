import type { CompanyIndustryId, MarketResourceType, NpcArchetype } from "@dominion/shared";

export interface SettlementSnapshot {
  id: string;
  name: string;
  playerId: string | null;
  archetype: NpcArchetype | null;
  food: number;
  gold: number;
  storageCap: number;
  lastTickAt: Date;
  population: { count: number; growthRate: number; happiness: number };
}

export interface CompanySnapshot {
  id: string;
  name: string;
  ownerId: string | null;
  industry: CompanyIndustryId;
  cash: number;
  // One entry per resource this company currently holds any stock of
  // (every input it's stockpiled, every output it hasn't sold yet) —
  // replaces the old single inputStock/goodsStock scalars, which could
  // only ever represent one resource each. Missing key == 0.
  stocks: Partial<Record<MarketResourceType, number>>;
  workersAssigned: number;
  autoStaff: boolean;
  level: number;
  facilityCount: number;
  isPublic: boolean;
  sharesOutstanding: number;
  lastTickAt: Date;
  // Set only for a land-gated company founded via routes/territory.ts's
  // POST /:seedIndex/found — which territory it's founded on.
  territorySeedIndex: number | null;
}
