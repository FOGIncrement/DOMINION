import type {
  BuildingTypeDef,
  BuildingTypeId,
  EventTemplateDef,
  NpcArchetypeDef,
  NpcArchetype,
  ResourceType,
  TechDef,
  TechId,
} from "./types.js";

export const STARTING_SETTLEMENT = {
  population: 25,
  food: 140,
  wood: 80,
  stone: 40,
  gold: 25,
  storageCap: 500,
};

export const BUILDING_TYPES: Record<BuildingTypeId, BuildingTypeDef> = {
  house: {
    id: "house",
    name: "House",
    description: "Provides housing so your population can grow further.",
    cost: { wood: 20 },
    maxWorkers: 0,
    populationCapacity: 10,
  },
  farm: {
    id: "farm",
    name: "Farm",
    description: "Assign workers to grow food for your settlement.",
    cost: { wood: 30 },
    maxWorkers: 3,
    producesResource: "food",
    productionPerWorkerPerHour: 4,
  },
  lumberCamp: {
    id: "lumberCamp",
    name: "Lumber Camp",
    description: "Assign workers to harvest wood from nearby forest.",
    cost: { wood: 15, stone: 5 },
    maxWorkers: 3,
    producesResource: "wood",
    productionPerWorkerPerHour: 3,
  },
  quarry: {
    id: "quarry",
    name: "Quarry",
    description: "Assign workers to extract stone.",
    cost: { wood: 25, stone: 10 },
    maxWorkers: 3,
    producesResource: "stone",
    productionPerWorkerPerHour: 2,
    requiredTech: "masonry",
  },
  marketplace: {
    id: "marketplace",
    name: "Marketplace",
    description:
      "Reduces the fee you pay when trading on the world market. Trading itself never requires this building.",
    cost: { wood: 40, stone: 20 },
    maxWorkers: 2,
    requiredTech: "currency",
  },
};

export const TECHS: Record<TechId, TechDef> = {
  masonry: {
    id: "masonry",
    name: "Masonry",
    description: "Unlocks the Quarry, letting you extract stone efficiently.",
    cost: { gold: 50, stone: 20 },
    unlocksBuilding: "quarry",
  },
  currency: {
    id: "currency",
    name: "Currency",
    description:
      "Unlocks the Marketplace, lowering the fee on all your world market trades.",
    cost: { gold: 80 },
    unlocksBuilding: "marketplace",
  },
  ironTools: {
    id: "ironTools",
    name: "Iron Tools",
    description: "Stone and wood production increase by 20%.",
    cost: { gold: 120, stone: 30 },
    requiredTech: "masonry",
    productionBonus: { buildingType: "quarry", multiplier: 1.2 },
  },
  animalHusbandry: {
    id: "animalHusbandry",
    name: "Animal Husbandry",
    description: "Farm production increases by 15%.",
    cost: { gold: 60, food: 50 },
    productionBonus: { buildingType: "farm", multiplier: 1.15 },
  },
};

export const NPC_ARCHETYPE_DEFS: Record<NpcArchetype, NpcArchetypeDef> = {
  agrarian: {
    id: "agrarian",
    name: "Agrarian",
    description: "A farming community focused on feeding its people and neighbors.",
    startingBuildings: { house: 2, farm: 3, lumberCamp: 1 },
  },
  mining: {
    id: "mining",
    name: "Mining",
    description: "A settlement built around stone and timber extraction.",
    startingBuildings: { house: 2, quarry: 2, lumberCamp: 2, farm: 1 },
  },
  trade: {
    id: "trade",
    name: "Trade",
    description: "A mercantile settlement that thrives on buying low and selling high.",
    startingBuildings: { house: 2, marketplace: 2, farm: 1, lumberCamp: 1 },
  },
};

export const EVENT_TEMPLATES: EventTemplateDef[] = [
  {
    id: "bountiful_harvest",
    title: "Bountiful Harvest",
    description: "Favorable weather has boosted food stores.",
    weight: 3,
    scope: "settlement",
    resourceEffect: { food: 40 },
  },
  {
    id: "harsh_storm",
    title: "Harsh Storm",
    description: "A storm damaged stockpiles, spoiling some food and timber.",
    weight: 2,
    scope: "settlement",
    resourceEffect: { food: -25, wood: -10 },
  },
  {
    id: "tech_breakthrough",
    title: "Tech Breakthrough",
    description: "Scholars across the world report a new technique spreading between settlements.",
    weight: 1,
    scope: "world",
  },
  {
    id: "trade_caravan",
    title: "Trade Caravan Arrives",
    description: "A traveling caravan brought a modest windfall of gold.",
    weight: 2,
    scope: "settlement",
    resourceEffect: { gold: 15 },
  },
  {
    id: "market_shortage",
    title: "Market Shortage",
    description: "Reports of shortages are rippling through the world market.",
    weight: 1,
    scope: "world",
  },
];

export const TRADE_FEE = {
  base: 0.05,
  withMarketplace: 0.02,
};

export const BASE_HOUSING_CAPACITY = 20;

export const POPULATION_TUNING = {
  foodConsumptionPerCapitaPerHour: 0.08,
  growthRatePerHourWhenFed: 0.004,
  starvationShrinkPerHourWhenHungry: 0.01,
  happinessRecoveryPerHour: 0.01,
  happinessDeclinePerHourWhenHungry: 0.03,
};

// Wood/stone have no direct population upkeep in this MVP model (no building
// decay yet), so a small per-capita "world economic activity" demand keeps
// their markets from collapsing to the price floor for lack of any buyer.
export const WORLD_DEMAND_TUNING = {
  woodDemandPerCapitaPerHour: 0.02,
  stoneDemandPerCapitaPerHour: 0.015,
};

export const BASE_PRICES: Record<"food" | "wood" | "stone", number> = {
  food: 2,
  wood: 3,
  stone: 4,
};

export const MARKET_TUNING = {
  smoothing: 0.3, // weight given to this tick's fresh flow vs. prior smoothed value
  maxPriceStepPerTick: 0.03, // max fractional price move toward target per tick
  minPriceRatio: 0.4, // price floor as a fraction of base price
  maxPriceRatio: 2.5, // price ceiling as a fraction of base price
  tradeImpact: 0.0005, // fractional price move per unit traded by a player
};

export const MAX_CATCHUP_HOURS = 720; // 30 days, safety cap on a single tick's elapsed time

export const NPC_GROWTH_TUNING = {
  minGoldToExpand: 200,
  expandChancePerTick: 0.05,
};

export const RESOURCE_LABELS: Record<ResourceType, string> = {
  food: "Food",
  wood: "Wood",
  stone: "Stone",
  gold: "Gold",
};

export function buildingsRequiringNoTech(): BuildingTypeId[] {
  return Object.values(BUILDING_TYPES)
    .filter((b) => !b.requiredTech)
    .map((b) => b.id);
}
