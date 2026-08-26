export const RESOURCE_TYPES = ["food", "wood", "stone", "gold"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export type ResourceBundle = Partial<Record<ResourceType, number>>;

// Everything the world market prices and trades. A superset of settlement
// resources (minus gold, the numeraire) plus company-produced goods.
export const MARKET_RESOURCE_TYPES = ["food", "wood", "stone", "goods"] as const;
export type MarketResourceType = (typeof MARKET_RESOURCE_TYPES)[number];

export const BUILDING_TYPE_IDS = [
  "house",
  "farm",
  "lumberCamp",
  "quarry",
  "marketplace",
] as const;
export type BuildingTypeId = (typeof BUILDING_TYPE_IDS)[number];

export const TECH_IDS = [
  "masonry",
  "currency",
  "ironTools",
  "animalHusbandry",
] as const;
export type TechId = (typeof TECH_IDS)[number];

export const NPC_ARCHETYPES = ["agrarian", "mining", "trade"] as const;
export type NpcArchetype = (typeof NPC_ARCHETYPES)[number];

export const MARKET_SIDES = ["buy", "sell"] as const;
export type MarketSide = (typeof MARKET_SIDES)[number];

export const COMPANY_INDUSTRY_IDS = [
  "bakery",
  "sawmill",
  "stoneworks",
  "farming",
  "logging",
  "quarrying",
  "retail",
  "construction",
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

export interface BuildingTypeDef {
  id: BuildingTypeId;
  name: string;
  description: string;
  cost: ResourceBundle;
  maxWorkers: number;
  producesResource?: ResourceType;
  productionPerWorkerPerHour?: number;
  populationCapacity?: number;
  requiredTech?: TechId;
  // Set once a building's role is fully covered by an equivalent company
  // industry (see COMPANY_INDUSTRIES) — players can no longer construct new
  // ones, but any they already have keep working exactly as before. No data
  // migration: this only gates the "build new" path.
  retiredForConstruction?: boolean;
}

export interface TechDef {
  id: TechId;
  name: string;
  description: string;
  cost: ResourceBundle;
  requiredTech?: TechId;
  unlocksBuilding?: BuildingTypeId;
  productionBonus?: {
    buildingType: BuildingTypeId;
    multiplier: number;
  };
}

export interface NpcArchetypeDef {
  id: NpcArchetype;
  name: string;
  description: string;
  startingBuildings: Partial<Record<BuildingTypeId, number>>;
}

export interface EventTemplateDef {
  id: EventTypeId;
  title: string;
  description: string;
  weight: number;
  scope: "settlement" | "world";
  resourceEffect?: ResourceBundle;
}

export interface CompanyIndustryDef {
  id: CompanyIndustryId;
  name: string;
  description: string;
  // Absent for an extraction industry (farming/logging/quarrying) — it
  // produces its output from labor alone, nothing to buy.
  inputResource?: "food" | "wood" | "stone";
  inputPerWorkerPerHour: number;
  // What gets sold, and how much of it — "goods" for a processing industry,
  // otherwise whichever raw resource this industry extracts. The field name
  // stays goodsPerWorkerPerHour even for extraction industries to avoid a
  // wider rename; it always means "output rate," not literally goods.
  outputResource: MarketResourceType;
  goodsPerWorkerPerHour: number;
  wagePerWorkerPerHour: number;
  maxWorkers: number;
  foundingCost: number;
  // NPC_COMPANY_TUNING.goodsSellBuffer (15) is too low for a company whose
  // real customer is a one-off zone commission rather than steady market
  // demand — an NPC-run construction company would sell down to 15 every
  // tick and never accumulate enough to fulfill one. Only construction sets
  // this today; every other industry falls back to the flat constant.
  goodsSellBuffer?: number;
}

export interface ZoneDef {
  id: ZoneTypeId;
  name: string;
  description: string;
  industries: CompanyIndustryId[];
  goodsCost: number;
  treasuryCost: number;
  buildTimeHours: number;
  slotsGranted: number;
}
