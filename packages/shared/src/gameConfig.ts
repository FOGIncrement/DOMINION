import type {
  BuildingTypeDef,
  BuildingTypeId,
  CompanyIndustryDef,
  CompanyIndustryId,
  EventTemplateDef,
  MarketResourceType,
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
    retiredForConstruction: true,
  },
  lumberCamp: {
    id: "lumberCamp",
    name: "Lumber Camp",
    description: "Assign workers to harvest wood from nearby forest.",
    cost: { wood: 15, stone: 5 },
    maxWorkers: 3,
    producesResource: "wood",
    productionPerWorkerPerHour: 3,
    retiredForConstruction: true,
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
    retiredForConstruction: true,
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

export const COMPANY_INDUSTRIES: Record<CompanyIndustryId, CompanyIndustryDef> = {
  bakery: {
    id: "bakery",
    name: "Bakery",
    description: "Buys food, sells baked goods at a markup.",
    inputResource: "food",
    inputPerWorkerPerHour: 2.5,
    outputResource: "goods",
    goodsPerWorkerPerHour: 1,
    wagePerWorkerPerHour: 1.5,
    maxWorkers: 4,
    foundingCost: 150,
  },
  sawmill: {
    id: "sawmill",
    name: "Sawmill",
    description: "Buys wood, sells finished lumber goods at a markup.",
    inputResource: "wood",
    inputPerWorkerPerHour: 1.5,
    outputResource: "goods",
    goodsPerWorkerPerHour: 1,
    wagePerWorkerPerHour: 1.5,
    maxWorkers: 4,
    foundingCost: 150,
  },
  stoneworks: {
    id: "stoneworks",
    name: "Stoneworks",
    description: "Buys stone, sells dressed masonry goods at a markup.",
    inputResource: "stone",
    inputPerWorkerPerHour: 1.2,
    outputResource: "goods",
    goodsPerWorkerPerHour: 1,
    wagePerWorkerPerHour: 1.5,
    maxWorkers: 4,
    foundingCost: 150,
  },
  // Buys wholesale food and resells it — not to the open market, but
  // directly to its own founder's settlement population (see
  // maybeBuyFromOwnedRetail in simulation/directSales.ts). Deliberately
  // outputs "food" rather than "goods": reselling the same resource type is
  // what makes it a shop rather than a transformation industry like the
  // three above, and it's what gives Retail a reason to exist distinct from
  // Farming (which also outputs food, but from labor alone with no
  // customer relationship).
  retail: {
    id: "retail",
    name: "Retail Store",
    description: "Buys wholesale food and resells it directly to the settlement's own population.",
    inputResource: "food",
    inputPerWorkerPerHour: 3,
    outputResource: "food",
    goodsPerWorkerPerHour: 3,
    wagePerWorkerPerHour: 1.5,
    maxWorkers: 4,
    foundingCost: 150,
  },
  // Extraction industries: labor in, raw resource out, nothing to buy.
  // Output rates match the equivalent settlement building exactly
  // (BUILDING_TYPES.farm/lumberCamp/quarry) so a company is a direct
  // commercial alternative to building one yourself, not a different deal.
  farming: {
    id: "farming",
    name: "Farm",
    description: "Grows food to sell on the open market — no input required.",
    inputPerWorkerPerHour: 0,
    outputResource: "food",
    goodsPerWorkerPerHour: 4,
    wagePerWorkerPerHour: 1.5,
    maxWorkers: 4,
    foundingCost: 150,
  },
  logging: {
    id: "logging",
    name: "Logging Camp",
    description: "Harvests wood to sell on the open market — no input required.",
    inputPerWorkerPerHour: 0,
    outputResource: "wood",
    goodsPerWorkerPerHour: 3,
    wagePerWorkerPerHour: 1.5,
    maxWorkers: 4,
    foundingCost: 150,
  },
  quarrying: {
    id: "quarrying",
    name: "Quarry",
    description: "Extracts stone to sell on the open market — no input required.",
    inputPerWorkerPerHour: 0,
    outputResource: "stone",
    goodsPerWorkerPerHour: 2,
    wagePerWorkerPerHour: 1.5,
    maxWorkers: 4,
    foundingCost: 150,
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

// A settlement buys baseline food from a Retail company its own player owns
// (see maybeBuyFromOwnedRetail) at this markup over the current world food
// price — the markup is the retailer's entire margin, since buying and
// reselling the same resource type creates no quantity-conversion profit
// the way a processing industry's input-to-goods conversion does.
export const RETAIL_TUNING = {
  markup: 1.15,
};

// The Bakery-luxury counterpart: once a settlement is fed, surplus gold can
// optionally buy "goods" from an owned Bakery (or the shared market as a
// fallback) purely for a happiness boost beyond plain food sufficiency —
// goods bought this way are consumed for happiness immediately, never
// stockpiled (no Settlement.goods field).
export const LUXURY_GOODS_TUNING = {
  goodsWantedPerCapitaPerHour: 0.02,
  maxGoldSpendFraction: 0.1, // never more than this fraction of on-hand gold in one tick
  markup: 1.1,
  happinessBoostPerHour: 0.02, // scaled by fulfillment fraction; comparable to happinessDeclinePerHourWhenHungry so it's a meaningful bump
};

// Wood/stone have no direct population upkeep in this MVP model (no building
// decay yet), so a small per-capita "world economic activity" demand keeps
// their markets from collapsing to the price floor for lack of any buyer.
// Goods (company output) get the same treatment: population is the organic
// consumer market for manufactured goods.
export const WORLD_DEMAND_TUNING = {
  woodDemandPerCapitaPerHour: 0.02,
  stoneDemandPerCapitaPerHour: 0.015,
  goodsDemandPerCapitaPerHour: 0.05,
};

export const BASE_PRICES: Record<MarketResourceType, number> = {
  food: 2,
  wood: 3,
  stone: 4,
  goods: 9,
};

export const MARKET_TUNING = {
  smoothing: 0.3, // weight given to this tick's fresh flow vs. prior smoothed value
  maxPriceStepPerTick: 0.03, // max fractional price move toward target per tick
  minPriceRatio: 0.4, // price floor as a fraction of base price
  maxPriceRatio: 2.5, // price ceiling as a fraction of base price
  tradeImpact: 0.0005, // fractional price move per unit traded by a player
};

export const MAX_CATCHUP_HOURS = 720; // 30 days, safety cap on a single tick's elapsed time

// The scheduler ticks once per real minute in normal operation — price-step
// tuning (maxPriceStepPerTick, STOCK_TUNING.maxPriceStepPerTick) is
// calibrated per call at that cadence. When a single call represents more
// elapsed time (a cheat-forced catch-up, or the server having been down),
// the step must scale by elapsedHours / REFERENCE_TICK_HOURS or prices
// barely move even after a "away for 8 hours" jump — one call is still just
// one step. Clamped by distance-to-target, so it can't overshoot.
export const REFERENCE_TICK_HOURS = 1 / 60;

export const NPC_GROWTH_TUNING = {
  minGoldToExpand: 200,
  expandChancePerTick: 0.08, // was 0.05 — bumped 2026-08-25 alongside the sell-before-build ordering fix (see engine.ts)
};

// Auto-close is a multiple of a baseline (foundingCost), same idiom as
// BANK_TUNING.defaultMultiplier being a multiple of loan principal.
export const COMPANY_FAILURE_TUNING = {
  autoCloseDebtMultiplier: 3,
};

// A fixed menu of term lengths, same idiom as LOAN_TERM_OPTIONS — no
// discount curve here since a contract's price is whatever the two
// (same-player-controlled) companies agree to, not risk-priced by the game.
export const CONTRACT_TERM_HOURS_OPTIONS = [24, 72, 168];

export const NPC_COMPANY_TUNING = {
  inputBuffer: 20, // NPC companies buy input up to this stock level
  goodsSellBuffer: 15, // and sell goods stock held above this level
  minCashToHire: 100,
  hireChancePerTick: 0.05,
  minCashToUpgrade: 400,
  upgradeChancePerTick: 0.02,
  // The NPC company roster could previously only shrink (auto-close on deep
  // debt) — nothing ever replaced a company that closed, or grew the roster
  // as the world's settlement count grew. foundChancePerTick rolls once per
  // tick, world-wide (not per-settlement); maxCompaniesPerSettlement keeps
  // the roster bounded relative to how many NPC settlements actually exist,
  // rather than growing unboundedly forever.
  foundChancePerTick: 0.04,
  maxCompaniesPerSettlement: 1.5,
};

// One level stat raises both a company's worker cap and its per-worker
// output efficiency together — not separate tracks. Capped at maxLevel so
// this is a bounded, finite progression. Wages scale with headcount only:
// a bigger workforce costs more to pay, a more efficient facility doesn't
// pay each worker more.
export const COMPANY_UPGRADE_TUNING = {
  maxLevel: 5,
  extraWorkersPerLevel: 2,
  outputBonusPerLevel: 0.2,
  costMultiplierPerLevel: 1.8, // upgrade cost = industry.foundingCost * multiplier^currentLevel
};

// Share price is a simple, deliberately-not-random valuation: a "P/E"-like
// multiple of lifetime-average hourly profit, plus a book-value (cash per
// share) component, drifting toward that target with a bounded step per
// tick — same idiom as commodity price formation in market.ts.
export const STOCK_TUNING = {
  sharesOutstandingAtIPO: 100,
  profitMultiplier: 40,
  bookValueWeight: 0.3,
  maxPriceStepPerTick: 0.05,
  minSharePrice: 0.1,
  tradeImpact: 0.002, // fractional price move per share traded — bigger than commodity tradeImpact since share counts are small
  minProfitToIPO: 20, // lifetime profit (gold) required before a company can list
};

export const DIVIDEND_TUNING = {
  cashThreshold: 150, // company needs at least this much cash to be considered for a payout
  payoutFraction: 0.15, // fraction of cash paid out, split pro-rata across shareholders
  chancePerTick: 0.03,
};

export const NPC_INVESTOR_TUNING = {
  actChancePerTick: 0.08,
  buySpendFraction: 0.2, // fraction of available cash committed to a single buy decision
  sellFraction: 0.3, // fraction of held shares sold on a sell decision
  minCashToAct: 20,
};

// Loans are a revolving balance, not a fixed-term mortgage: interest
// compounds on outstandingBalance every tick until voluntarily repaid.
// Left unpaid for long enough, a loan defaults rather than amortizing to a
// maturity date — see the Stage 4 plan for why.
export const BANK_TUNING = {
  foundingCost: 200, // gold, becomes the bank's starting lending reserve
  defaultMultiplier: 2.5, // defaults once outstandingBalance exceeds principal * this
  maxLoanToCashRatio: 5, // a company can borrow up to this multiple of its own current cash
  maxRiskPremium: 1.5, // rate multiplier added at 100% credit utilization (so borrowing right up to the limit costs 2.5x the bank's base rate)
};

export const NPC_BANKING_TUNING = {
  borrowChancePerTick: 0.04,
  repayChancePerTick: 0.06,
  minCashToConsiderBorrow: 30, // below this, a struggling company might seek a loan
  borrowAmountFraction: 0.5, // borrows up to this fraction of what the credit check allows
  repayFraction: 0.4, // repays this fraction of outstanding balance when repaying
};

// The opposite side of a loan. Deposited gold becomes real bank.cash — it
// funds the bank's lending capacity, so a bank that's lent heavily against
// its deposits can genuinely run short of cash for a withdrawal.
export const DEPOSIT_TUNING = {
  rateFraction: 0.4, // depositors earn this fraction of the bank's lending rate — the spread is the bank's margin
};

// Government bonds: a distinct debt instrument from a bank Deposit — see the
// Bond model comment in schema.prisma. Base rate sits a bit above a typical
// deposit's yield (0.002 bank base rate * 0.4 rateFraction = 0.0008/hr)
// since capital is genuinely locked for the term rather than withdrawable
// anytime; the longest term's bonus brings it up to roughly a bank's own
// base lending rate, rewarding the longer lock-up.
export const BOND_TUNING = {
  baseRatePerHour: 0.001,
};

// Corporate bonds carry the same term-length base rate as a government bond
// plus a risk premium, the same "riskier borrower pays more" idiom as
// BANK_TUNING.maxRiskPremium for loans.
export const CORPORATE_BOND_TUNING = {
  maxRiskPremium: 1.2, // rate multiplier added at 100% issuance-to-capacity utilization
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
