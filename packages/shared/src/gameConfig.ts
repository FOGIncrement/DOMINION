import type {
  CompanyIndustryDef,
  CompanyIndustryId,
  EventTemplateDef,
  MarketResourceType,
  NpcArchetypeDef,
  NpcArchetype,
  ResourceType,
  ZoneDef,
  ZoneTypeId,
} from "./types.js";
import type { BiomeId } from "./continentTerrain.js";

// Realistic-scale balance pass (2026-09-03): starting cash needs to cover
// founding one Farm + one Power Plant (see COMPANY_INDUSTRIES below,
// foundingCost 4000 each) plus a wage cushion once the player picks their
// one starting territory (see TERRITORY_TUNING.extractionStarterGrant) —
// 2000 here + 7000 from that grant = 9000 available, ~1000 left over.
export const STARTING_SETTLEMENT = {
  population: 25,
  food: 140,
  gold: 2000,
  storageCap: 500,
};

// Government.treasury otherwise defaults to 0 (the schema default) — without
// a real starting seed here, a brand-new government can't afford to
// commission anything at all, since it has no organic income yet (tax
// collection and bond issuance both need real trade activity or another
// player first). Also the pool territory purchases (see TERRITORY_TUNING.
// buyPricePerKm2) and army-raising spend from.
export const STARTING_TREASURY = 3000;

// Two-level grid for the shared territory map: every settlement (player or
// NPC) claims exactly one same-sized slot on the shared WORLD_PLOT grid
// (see settlementFactory.ts's assignSettlementPlot), and within its own
// slot has a fixed local PLOT_ZONING grid a player drags rectangles on to
// place zones. Prototype-scale numbers — not tuned for a real player base,
// just large enough to hold today's ~16 NPC settlements plus real players
// without crowding immediately.
export const WORLD_PLOT_COLS = 12;
export const WORLD_PLOT_ROWS = 8;
export const PLOT_ZONING_SIZE = 10;

// A dragged zone's founding-capacity grant is its area divided by this —
// kept at 1 so each individual grid square on the zone tool grants exactly
// one company's founding capacity, a direct and legible relationship
// rather than a hidden ratio. Left as a named constant (not inlined) so
// this can still be retuned later without touching every call site.
export const CELLS_PER_ZONE_SLOT = 1;

// Slice 1 of the recipe-based production economy. Land-gated industries
// (requiresTerritory: true) are founded via routes/territory.ts's POST
// /:seedIndex/found, one per owned territory, no zoning capacity needed —
// zoning-gated ones (flourMill, bakery, retail) still go through the
// ordinary routes/companies.ts founding path. The other ~27 industries
// from the user's full list (mines, wells, processing plants, and
// manufacturers) follow in a later pass now that the recipe mechanism
// itself is proven on this one real chain: wheat -> flour -> bread, with
// power/fertilizer/packaging filling gaps the user's list didn't specify a
// producer for. `farm` was added alongside the legacy building-economy
// removal (2026-09-03) to replace the old Farm building as the settlement's
// food supply. Every land-gated producer except powerPlant itself now also
// draws electricity — "each company type should have a cost for total
// energy required to run it" — powerPlant is exempt since it produces
// electricity and shouldn't consume its own output. Founding costs, wages,
// and market prices are realistic-scale Euros (see STARTING_SETTLEMENT/
// STARTING_TREASURY above for how starting cash is sized against these).
export const COMPANY_INDUSTRIES: Record<CompanyIndustryId, CompanyIndustryDef> = {
  powerPlant: {
    id: "powerPlant",
    name: "Power Plant",
    description: "Generates electricity on your own land — no input required.",
    inputs: [],
    outputs: [{ resource: "electricity", perWorkerPerHour: 4 }],
    wagePerWorkerPerHour: 18,
    maxWorkers: 4,
    foundingCost: 4000,
    requiresTerritory: true,
  },
  // Replaces the old Farm building as the settlement's food supply — Land
  // -> Food, same shape as wheatFarm. wheatFarm's `wheat` commodity chain
  // (-> flour -> bread) stays separate and unaffected; this produces the
  // settlement-consumable `food` resource directly.
  farm: {
    id: "farm",
    name: "Farm",
    description: "Grows food on your own land to feed your settlement (and sell on the open market).",
    inputs: [{ resource: "electricity", perWorkerPerHour: 1.5 }],
    outputs: [{ resource: "food", perWorkerPerHour: 4 }],
    wagePerWorkerPerHour: 18,
    maxWorkers: 4,
    foundingCost: 4000,
    requiresTerritory: true,
  },
  // Simplified stand-in recipe for this slice — the real chain (natural
  // gas + chemicals + electricity) needs oil/gas wells and a chemical
  // plant that don't exist yet. Revisit once that tree is built.
  fertilizerPlant: {
    id: "fertilizerPlant",
    name: "Fertilizer Plant",
    description: "Produces fertilizer on your own land (simplified recipe for now).",
    inputs: [{ resource: "electricity", perWorkerPerHour: 2 }],
    outputs: [{ resource: "fertilizer", perWorkerPerHour: 3 }],
    wagePerWorkerPerHour: 18,
    maxWorkers: 4,
    foundingCost: 4000,
    requiresTerritory: true,
  },
  // Water is treated as an ambient, always-available input for now (like
  // land itself) rather than a tracked/traded resource — see the recipe-
  // economy plan.
  wheatFarm: {
    id: "wheatFarm",
    name: "Wheat Farm",
    description: "Grows wheat on your own land using fertilizer and electricity (water is always available).",
    inputs: [
      { resource: "fertilizer", perWorkerPerHour: 1 },
      { resource: "electricity", perWorkerPerHour: 1.5 },
    ],
    outputs: [{ resource: "wheat", perWorkerPerHour: 4 }],
    wagePerWorkerPerHour: 18,
    maxWorkers: 4,
    foundingCost: 4000,
    requiresTerritory: true,
  },
  // Simplified stand-in, same reasoning as fertilizerPlant — the eventual
  // recipe (paper or plastic) needs a much deeper chain.
  packagingPlant: {
    id: "packagingPlant",
    name: "Packaging Plant",
    description: "Produces packaging materials on your own land (simplified recipe for now).",
    inputs: [{ resource: "electricity", perWorkerPerHour: 2 }],
    outputs: [{ resource: "packaging", perWorkerPerHour: 3 }],
    wagePerWorkerPerHour: 18,
    maxWorkers: 4,
    foundingCost: 4000,
    requiresTerritory: true,
  },
  flourMill: {
    id: "flourMill",
    name: "Flour Mill",
    description: "Buys wheat and electricity, sells flour.",
    inputs: [
      { resource: "wheat", perWorkerPerHour: 2 },
      { resource: "electricity", perWorkerPerHour: 1 },
    ],
    outputs: [{ resource: "flour", perWorkerPerHour: 1.5 }],
    wagePerWorkerPerHour: 18,
    maxWorkers: 4,
    foundingCost: 8000,
  },
  bakery: {
    id: "bakery",
    name: "Bakery",
    description: "Buys flour, electricity, and packaging, sells bread.",
    inputs: [
      { resource: "flour", perWorkerPerHour: 2 },
      { resource: "electricity", perWorkerPerHour: 0.5 },
      { resource: "packaging", perWorkerPerHour: 0.5 },
    ],
    outputs: [{ resource: "bread", perWorkerPerHour: 1 }],
    wagePerWorkerPerHour: 18,
    maxWorkers: 4,
    foundingCost: 12000,
  },
  // Buys wholesale food and resells it — not to the open market, but
  // directly to its own founder's settlement population (see
  // maybeBuyFromOwnedRetail in simulation/directSales.ts). The one industry
  // kept outside the recipe-catalog replacement: it's the sole existing
  // bridge between company output and population happiness, not a
  // production/recipe company.
  retail: {
    id: "retail",
    name: "Retail Store",
    description: "Buys wholesale food and resells it directly to the settlement's own population.",
    inputs: [
      { resource: "food", perWorkerPerHour: 3 },
      { resource: "electricity", perWorkerPerHour: 1.5 },
    ],
    outputs: [{ resource: "food", perWorkerPerHour: 3 }],
    wagePerWorkerPerHour: 18,
    maxWorkers: 4,
    foundingCost: 12000,
  },
};

// A settlement can commission a zone to open founding capacity for a
// category of (non-land-gated) company industries — see
// ZONE_BASELINE_FREE_SLOTS and the capacity check in routes/companies.ts.
// Land-gated industries (COMPANY_INDUSTRIES entries with
// requiresTerritory: true) never appear here — they're gated by territory
// ownership instead, see routes/territory.ts.
export const ZONE_TYPES: Record<ZoneTypeId, ZoneDef> = {
  industrial: {
    id: "industrial",
    name: "Industrial Zone",
    description: "Opens capacity to found processing and manufacturing companies — mills, factories, and more.",
    industries: ["flourMill", "bakery"],
    suggestedTreasuryCost: 200,
    buildTimeHours: 4,
    slotsGranted: 2,
  },
  retail: {
    id: "retail",
    name: "Retail Zone",
    description: "Opens capacity to found retail companies that sell directly to your population.",
    industries: ["retail"],
    suggestedTreasuryCost: 150,
    buildTimeHours: 3,
    slotsGranted: 2,
  },
};

// A new player can found a couple of companies per category before ever
// touching zoning — no cold-start wall — then needs to commission zones to
// keep scaling past this.
export const ZONE_BASELINE_FREE_SLOTS: Record<ZoneTypeId, number> = {
  industrial: 2,
  retail: 2,
};

export function zoneCategoryForIndustry(industry: CompanyIndustryId): ZoneTypeId {
  const entry = (Object.values(ZONE_TYPES) as ZoneDef[]).find((z) => z.industries.includes(industry));
  // Every CompanyIndustryId is assigned to exactly one zone category above —
  // this can only throw if a new industry is added to COMPANY_INDUSTRIES
  // without also adding it to some ZONE_TYPES.industries list.
  if (!entry) throw new Error(`No zone category defined for industry "${industry}"`);
  return entry.id;
}

export const NPC_ARCHETYPE_DEFS: Record<NpcArchetype, NpcArchetypeDef> = {
  agrarian: {
    id: "agrarian",
    name: "Agrarian",
    description: "A farming community focused on feeding its people and neighbors.",
  },
  mining: {
    id: "mining",
    name: "Mining",
    description: "A settlement built around resource extraction.",
  },
  trade: {
    id: "trade",
    name: "Trade",
    description: "A mercantile settlement that thrives on buying low and selling high.",
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
    description: "A storm damaged food stockpiles.",
    weight: 2,
    scope: "settlement",
    resourceEffect: { food: -25 },
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

// Marketplace (the building that used to discount this) is gone along with
// the rest of the legacy building economy — a single flat fee now, on the
// food-only settlement trade route (see routes/market.ts).
export const TRADE_FEE = {
  base: 0.05,
};

// House (the building that used to be the only source of population
// capacity) is gone along with the rest of the legacy building economy —
// this flat base plus a per-territory bonus (see simulation/consumption.ts's
// housingCapacity()) is now the sole capacity source, giving territory
// expansion a second reason to matter. A proper tuning group (not bare
// scalars) so it's live-editable from the admin balance panel like every
// other ongoing pacing lever.
export const HOUSING_TUNING = {
  base: 100,
  perTerritory: 50,
};

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

// Goods (company output) have no direct population upkeep, so a small
// per-capita "world economic activity" demand keeps the market from
// collapsing to the price floor for lack of any buyer — population is the
// organic consumer market for manufactured goods.
export const WORLD_DEMAND_TUNING = {
  goodsDemandPerCapitaPerHour: 0.05,
};

// Realistic-scale balance pass (2026-09-03) — roughly real per-unit
// commodity/retail Euro pricing rather than the earlier 1-10 placeholder
// scale.
export const BASE_PRICES: Record<MarketResourceType, number> = {
  food: 3,
  goods: 9,
  electricity: 0.3,
  fertilizer: 2,
  wheat: 0.4,
  flour: 1.2,
  packaging: 1.5,
  bread: 3.5,
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

// Shipment dispatch/transit tuning (real in-transit contract shipments —
// see simulation/shipments.ts and simulation/companyPosition.ts). This is
// deliberately an ABSTRACTED logistics speed, not a literal truck's
// ~60km/h — this is a real-time 1:1 simulation (1 real hour = 1 sim hour),
// so a literal truck speed would make a cross-continent shipment take
// multiple real DAYS, which is bad game feel. At these defaults: a
// same-settlement shipment (a few km, see kmPerZoneCell) arrives
// effectively next-tick; a typical territory-to-territory shipment (the
// ~100-300km spacing between this continent's ~48 territories) resolves in
// well under an hour; even the continent's ~3,300km diagonal corner case
// is capped at maxTransitHours rather than growing unbounded. All three
// are easy-retune placeholders (also live-editable via /admin/config), not
// load-bearing precision.
export const LOGISTICS_TUNING = {
  // Real km one PLOT_ZONING_SIZE grid cell represents for a zoning-gated
  // company's position — a whole 10x10 zoning grid spans ~10km at this
  // default, "your own settlement's local footprint," much smaller than
  // inter-territory distances (hundreds to thousands of km).
  kmPerZoneCell: 1,
  transitSpeedKmPerHour: 500,
  maxTransitHours: 6,
};

export const NPC_COMPANY_TUNING = {
  inputBuffer: 20, // NPC companies buy input up to this stock level
  goodsSellBuffer: 15, // and sell goods stock held above this level
  minCashToHire: 100,
  hireChancePerTick: 0.05,
  minCashToUpgrade: 400,
  upgradeChancePerTick: 0.02,
  // A facility costs more than a level upgrade (see COMPANY_FACILITY_TUNING)
  // and also consumes zone capacity for player-owned companies — NPCs skip
  // that gate (no Government/zoning), but keep a slightly more conservative
  // cash bar and roll chance than upgrading, matching the bigger commitment.
  minCashToExpand: 500,
  expandChancePerTick: 0.015,
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

// A second, orthogonal reinvestment axis alongside level: facilityCount
// multiplies the worker cap wholesale (computeCompanyMaxWorkers) rather than
// raising per-worker efficiency — "more sites running the same practices,"
// not "better practices." Steeper cost curve than COMPANY_UPGRADE_TUNING
// since a facility is a bigger structural jump and (for player-owned
// companies) also consumes zone capacity, same as founding a new company —
// see the zone-capacity usage helper in routes/companies.ts.
export const COMPANY_FACILITY_TUNING = {
  maxFacilities: 4,
  costMultiplierPerFacility: 2.5, // expand cost = industry.foundingCost * multiplier^currentFacilityCount
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

export const EVENT_TUNING = {
  chancePerTick: 0.15,
};

// Margin land-system Phase 2 (territory partition/ownership/lifecycle) —
// simple pacing levers, admin-tunable via the same FLAT_GROUPS registry as
// everything above. targetAreaPerSeedKm2 drives how many territory seeds
// get placed at world-gen time (computed from measured land area / this
// number, not a fixed count — see generateTerritories.ts). dormant/
// abandoned thresholds gate off Player.lastSeenAt, not a stored per-
// territory status (see the Territory model) — reclaim is just logging
// back in, which already refreshes lastSeenAt via the existing offline-
// summary mechanism, with zero extra code.
export const TERRITORY_TUNING = {
  // Chosen so the continent reads as ~40-55 distinct countries (1,056,692km²
  // measured land / 22,000 ≈ 48) rather than ~2000 tiny provinces — a
  // country-scale starting claim, not a field. Subdividing an owned country
  // into smaller provinces is deliberately not modeled yet; this only
  // controls the size of the atomic claimable/conquerable unit.
  targetAreaPerSeedKm2: 22000,
  dormantAfterDays: 14,
  abandonedAfterDays: 30,
  // River-crossing cost multiplier at the biggest river on the continent,
  // scaling down to 1x (no extra toll) at zero flow — a trickling stream
  // barely taxes a border, a major river is a real obstacle.
  riverFlowTollMax: 2,
  // One-time gold grant when a player gains a new territory (their one free
  // starting pick, or a won attack — see the territory-acquisition rework)
  // — sized to cover founding one Farm + one Power Plant (4000 each) plus a
  // wage cushion. See routes/territory.ts's grantExtractionStarterBundle.
  // No richness/yield scaling by territory quality in the recipe-economy
  // slice — land is a flat founding-eligibility gate, not a stocked
  // resource; see the recipe-economy plan for why.
  extractionStarterGrant: 7000,
  // Price (Government treasury, not settlement gold — buying land is a
  // civic/state action, same pool army-raising spends from) for POST
  // /:seedIndex/buy — unclaimed/abandoned land once a player already owns
  // territory. Picked so a typical ~20,000km² territory costs roughly the
  // same order of magnitude as founding a company (~€8,000), not a literal
  // real-world land price (which would dwarf every other number here).
  buyPricePerKm2: 0.4,
};

// Structural data, not a pacing lever (same treatment ZONE_TYPES/
// NPC_ARCHETYPE_DEFS already get — deliberately NOT in FLAT_GROUPS, see
// gameConfigStore.ts's own comment on that registry). The terrain-cost
// lookup for the territory-partition multi-source Dijkstra: "every point
// belongs to the cheapest seed to reach," not the geometrically closest —
// crossing a mountain is expensive, a plain is cheap. ocean/lake values are
// never actually read (those cells are excluded from the partition before
// any cost lookup happens) but are listed for type completeness.
export const TERRITORY_BIOME_COST: Record<BiomeId, number> = {
  ocean: Infinity,
  lake: Infinity,
  river: 3,
  beach: 1,
  desert: 1.3,
  plains: 1,
  grassland: 1,
  forest: 1.5,
  taiga: 1.5,
  tundra: 1.4,
  mountain: 6,
  snow: 8,
};

// Phase 4 (military/conquest) — one scalar army, no unit composition. See
// routes/military.ts for how these are used.
export const MILITARY_TUNING = {
  // Gold spent raising an army converts to armyStrength at this rate.
  strengthPerGold: 0.1,
  // Home-turf advantage — defending is meant to be easier than attacking.
  defenderBonusMultiplier: 1.2,
  // +/- range applied to both sides' rolled power, e.g. 0.15 = +/-15%.
  attackRandomJitter: 0.15,
  attackCooldownHours: 6,
  // Fraction of armyStrength a defender loses even when they successfully
  // repel an attack — a won defense still costs something.
  defenderStrengthLossFractionOnWin: 0.3,
};

export const RESOURCE_LABELS: Record<ResourceType, string> = {
  food: "Food",
  gold: "Gold",
};
