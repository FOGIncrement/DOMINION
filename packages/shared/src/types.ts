// wood/stone removed with the legacy building economy — food is still a
// real settlement resource (population eats it), gold is the numeraire.
export const RESOURCE_TYPES = ["food", "gold"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export type ResourceBundle = Partial<Record<ResourceType, number>>;

// Everything the world market prices and trades. A superset of settlement
// resources (minus gold, the numeraire) plus company-produced goods.
// electricity/fertilizer/wheat/flour/packaging/bread are Slice 1 of the
// recipe-based production economy (see the Margin recipe-economy plan) —
// the rest of the user's ~33-company list adds more of these later.
export const MARKET_RESOURCE_TYPES = [
  "food",
  "goods",
  "electricity",
  "fertilizer",
  "wheat",
  "flour",
  "packaging",
  "bread",
] as const;
export type MarketResourceType = (typeof MARKET_RESOURCE_TYPES)[number];

export const NPC_ARCHETYPES = ["agrarian", "mining", "trade"] as const;
export type NpcArchetype = (typeof NPC_ARCHETYPES)[number];

export const MARKET_SIDES = ["buy", "sell"] as const;
export type MarketSide = (typeof MARKET_SIDES)[number];

// Slice 1 of the recipe-based production economy (see the Margin
// recipe-economy plan) — powerPlant/fertilizerPlant/wheatFarm/
// packagingPlant/farm are land-gated (requiresTerritory), flourMill/bakery
// are zoning-gated. The other ~27 industries from the user's full list
// follow in a later pass now that the recipe mechanism exists. farming/
// logging/quarrying/sawmill/stoneworks/construction are retired; retail is
// unchanged (it's the population-happiness bridge, not part of the
// production/recipe catalog). `farm` (added with the legacy-building
// removal pass) replaces the old Farm building as the settlement's food
// supply — Land -> Food, same shape as wheatFarm/fertilizerPlant.
export const COMPANY_INDUSTRY_IDS = [
  "powerPlant",
  "fertilizerPlant",
  "wheatFarm",
  "packagingPlant",
  "farm",
  "flourMill",
  "bakery",
  "retail",
] as const;
export type CompanyIndustryId = (typeof COMPANY_INDUSTRY_IDS)[number];

export const ZONE_TYPE_IDS = ["industrial", "retail"] as const;
export type ZoneTypeId = (typeof ZONE_TYPE_IDS)[number];

export const INVESTOR_ARCHETYPES = ["conservative", "growth", "speculator"] as const;
export type InvestorArchetype = (typeof INVESTOR_ARCHETYPES)[number];

export const EVENT_TYPE_IDS = [
  "bountiful_harvest",
  "harsh_storm",
  "tech_breakthrough",
  "trade_caravan",
  "market_shortage",
] as const;
export type EventTypeId = (typeof EVENT_TYPE_IDS)[number];

export interface NpcArchetypeDef {
  id: NpcArchetype;
  name: string;
  description: string;
}

export interface EventTemplateDef {
  id: EventTypeId;
  title: string;
  description: string;
  weight: number;
  scope: "settlement" | "world";
  resourceEffect?: ResourceBundle;
}

// One recipe ingredient or product — a company's full recipe is
// inputs[] -> outputs[], each entry consumed/produced at
// perWorkerPerHour * workersAssigned * levelMultiplier (see
// computeCompanyHourlyRates in companyProduction.ts).
export interface RecipeComponent {
  resource: MarketResourceType;
  perWorkerPerHour: number;
}

export interface CompanyIndustryDef {
  id: CompanyIndustryId;
  name: string;
  description: string;
  // Empty for a pure land-extraction industry (e.g. Forestry: nothing to
  // buy, produces straight from labor + land). tickCompany bottlenecks
  // production on whichever input has the least stock relative to what's
  // needed that tick — see simulation/companies.ts.
  inputs: RecipeComponent[];
  // Usually one entry; more than one for a industry with multiple real
  // products (e.g. an oil refinery producing both fuel and chemicals).
  outputs: RecipeComponent[];
  wagePerWorkerPerHour: number;
  maxWorkers: number;
  foundingCost: number;
  // NPC_COMPANY_TUNING.goodsSellBuffer (15) is too low for some industries'
  // real sell patterns — set per-industry to override the flat constant.
  goodsSellBuffer?: number;
  // "Land" in the user's recipe list — this industry can only be founded on
  // a territory the player owns (routes/territory.ts's POST
  // /:seedIndex/found), not through the ordinary zoning-gated
  // routes/companies.ts path. A founding-eligibility gate, not a resource:
  // any owned territory qualifies, nothing is consumed or tracked for it.
  requiresTerritory?: boolean;
}

export interface ZoneDef {
  id: ZoneTypeId;
  name: string;
  description: string;
  industries: CompanyIndustryId[];
  // Advisory only — the client pre-fills the commission form with this, but
  // the actual price is a negotiated term the commissioning government
  // proposes per-commission (see routes/infrastructure.ts), not an
  // enforced catalog value. Purely treasury-funded — a zone commission
  // never requires the construction company to have pre-accumulated goods.
  suggestedTreasuryCost: number;
  buildTimeHours: number;
  // Advisory only, same as suggestedTreasuryCost — a real commission's
  // capacity grant is computed from the dragged zone rectangle's actual
  // area (zoneWidth * zoneHeight / CELLS_PER_ZONE_SLOT), not this catalog
  // number. Kept here purely so the client can show "roughly what a zone
  // this size tends to grant" before the player has dragged anything.
  slotsGranted: number;
}

export const TUTORIAL_STEPS = ["found_company", "hiring", "government_unlock", "commission_zone", "completed"] as const;
export type TutorialStep = (typeof TUTORIAL_STEPS)[number];
