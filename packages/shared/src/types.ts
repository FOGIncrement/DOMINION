export const RESOURCE_TYPES = ["food", "wood", "stone", "gold"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export type ResourceBundle = Partial<Record<ResourceType, number>>;

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
