// Runtime-editable overlay on top of packages/shared/src/gameConfig.ts's
// static tuning constants. The static constants stay the source of
// DEFAULTS (and are what packages/client still reads directly for
// preview/display math, unaffected by anything here) — this module lets
// the server apply a persisted, admin-edited DELTA over those defaults and
// exposes the merged result via getConfig(), which every simulation call
// site should read through instead of importing a *_TUNING constant
// directly. Always call getConfig() inside a function body at the point of
// use, never destructure it at module scope — module-scope destructuring
// would freeze the value at process boot and defeat the entire point of
// this being live-editable without a restart.
import {
  BANK_TUNING,
  BASE_PRICES,
  BOND_TUNING,
  COMPANY_FACILITY_TUNING,
  COMPANY_FAILURE_TUNING,
  COMPANY_INDUSTRIES,
  COMPANY_UPGRADE_TUNING,
  CORPORATE_BOND_TUNING,
  DEPOSIT_TUNING,
  DIVIDEND_TUNING,
  EVENT_TUNING,
  HOUSING_TUNING,
  LUXURY_GOODS_TUNING,
  MARKET_TUNING,
  MILITARY_TUNING,
  NPC_BANKING_TUNING,
  NPC_COMPANY_TUNING,
  NPC_GROWTH_TUNING,
  NPC_INVESTOR_TUNING,
  POPULATION_TUNING,
  RETAIL_TUNING,
  STOCK_TUNING,
  TERRITORY_TUNING,
  TRADE_FEE,
  WORLD_DEMAND_TUNING,
} from "@dominion/shared";
import { prisma } from "./db.js";

// Every field on every one of these is a plain number — merge is a trivial
// per-field shallow overlay. (MAX_CATCHUP_HOURS, and the catalog/one-time-
// read groups — ZONE_TYPES, NPC_ARCHETYPE_DEFS, EVENT_TEMPLATES,
// STARTING_SETTLEMENT, STARTING_TREASURY — are deliberately not in this
// registry: not ongoing-pacing levers, or one-time creation-time values
// that wouldn't retroactively affect existing settlements/players anyway.
// Extend this object using the exact same pattern if any of those need to
// become tunable later — and add a matching entry to FLAT_GROUP_DESCRIPTIONS
// below so the admin panel keeps explaining what it changes.)
const FLAT_GROUPS = {
  POPULATION_TUNING,
  HOUSING_TUNING,
  MARKET_TUNING,
  NPC_GROWTH_TUNING,
  COMPANY_UPGRADE_TUNING,
  COMPANY_FACILITY_TUNING,
  STOCK_TUNING,
  DIVIDEND_TUNING,
  NPC_INVESTOR_TUNING,
  BANK_TUNING,
  NPC_BANKING_TUNING,
  DEPOSIT_TUNING,
  BOND_TUNING,
  CORPORATE_BOND_TUNING,
  RETAIL_TUNING,
  LUXURY_GOODS_TUNING,
  WORLD_DEMAND_TUNING,
  TRADE_FEE,
  COMPANY_FAILURE_TUNING,
  NPC_COMPANY_TUNING,
  EVENT_TUNING,
  BASE_PRICES,
  TERRITORY_TUNING,
  MILITARY_TUNING,
};

type FlatGroupName = keyof typeof FLAT_GROUPS;

// One plain-language sentence per group, shown in the admin balance panel
// next to its fields — kept here (not duplicated client-side) so it can
// never drift out of sync with the actual registry above, same reasoning as
// getConfigRegistryMeta's flatGroups/companyIndustryFields already being
// server-computed rather than hardcoded in the client.
const FLAT_GROUP_DESCRIPTIONS: Record<FlatGroupName, string> = {
  POPULATION_TUNING: "How fast population grows when fed, shrinks when starving, and how happiness reacts to both.",
  HOUSING_TUNING: "Population capacity — a flat base plus a bonus per territory a player owns.",
  MARKET_TUNING: "How world commodity prices react to supply/demand imbalance and how fast they move each tick.",
  NPC_GROWTH_TUNING: "How often and how easily a cash-rich NPC settlement reinvests to grow.",
  COMPANY_UPGRADE_TUNING: "Cost and payoff of leveling up a company (more workers, better per-worker output).",
  COMPANY_FACILITY_TUNING: "Cost and cap for adding extra facilities to a company (a second worker-cap multiplier, separate from level).",
  STOCK_TUNING: "How a public company's share price is valued and how fast it drifts toward that value.",
  DIVIDEND_TUNING: "How often and how much cash a public company pays out to shareholders.",
  NPC_INVESTOR_TUNING: "How often and how aggressively NPC investors buy/sell shares.",
  BANK_TUNING: "Bank founding cost and lending limits/rates for company loans.",
  NPC_BANKING_TUNING: "How often NPC companies borrow from or repay banks.",
  DEPOSIT_TUNING: "What fraction of a bank's lending rate a depositor earns.",
  BOND_TUNING: "Base interest rate on government bonds.",
  CORPORATE_BOND_TUNING: "Risk premium added to a corporate bond's rate as issuance approaches a company's capacity.",
  RETAIL_TUNING: "Markup a Retail company charges its own settlement over the wholesale food price.",
  LUXURY_GOODS_TUNING: "How much surplus gold a settlement spends on \"goods\" for a happiness boost beyond plain food sufficiency.",
  WORLD_DEMAND_TUNING: "Baseline per-capita demand for manufactured goods, keeping that market from collapsing for lack of a buyer.",
  TRADE_FEE: "Flat fee charged on the settlement-level food trade route.",
  COMPANY_FAILURE_TUNING: "How deep in debt (as a multiple of founding cost) a company can go before it's auto-closed.",
  NPC_COMPANY_TUNING: "How NPC companies stock inputs/outputs and decide to hire, upgrade, expand, or found new companies.",
  EVENT_TUNING: "How often a random world/settlement event (harvest, storm, etc.) fires.",
  BASE_PRICES: "Starting price for every tradeable resource before supply/demand moves it.",
  TERRITORY_TUNING: "Territory sizing, dormant/abandoned timing, the one-time starter grant, and the price to buy unclaimed land.",
  MILITARY_TUNING: "Army strength, attack cooldown, and combat odds for conquering territory by force.",
};

// COMPANY_INDUSTRIES mixes tunable rate fields with structural/identity
// fields (inputs/outputs recipe arrays, name, requiresTerritory) that other
// code branches on — an explicit numeric-field allowlist per entry, never a
// blind recursive merge, so a malformed edit can only ever change how fast
// an industry runs, never what it fundamentally is. Note: the recipe-based
// inputs[]/outputs[] arrays (added with the recipe-economy rework) aren't
// reachable through this flat allowlist mechanism — only the scalar rate
// fields below are admin-editable; a per-recipe-component editor is future
// work if that's ever needed.
const COMPANY_INDUSTRY_EDITABLE_FIELDS = [
  "wagePerWorkerPerHour",
  "maxWorkers",
  "foundingCost",
] as const;

type NumericPatch = Record<string, number>;

interface GameConfigOverrides {
  flat?: Partial<Record<FlatGroupName, NumericPatch>>;
  COMPANY_INDUSTRIES?: Record<string, NumericPatch>;
}

export type MergedGameConfig = {
  [K in FlatGroupName]: (typeof FLAT_GROUPS)[K];
} & {
  COMPANY_INDUSTRIES: typeof COMPANY_INDUSTRIES;
};

let persistedOverrides: GameConfigOverrides = {};
let mergedCache: MergedGameConfig;

// COMPANY_INDUSTRIES is keyed by a specific string-literal union
// (CompanyIndustryId), which TS won't structurally match against a generic
// Record<string, ...> constraint — this is a runtime merge utility, not
// something that needs
// (or can cleanly have) compile-time key-safety, so it takes `unknown` in
// and the caller casts the result back to the concrete defaults type,
// which is always correct since every key in `defaults` is preserved.
function mergeRecordGroup(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaults: Record<string, any>,
  overrides: Record<string, NumericPatch> | undefined,
  allowedFields: readonly string[],
): Record<string, Record<string, unknown>> {
  const merged: Record<string, Record<string, unknown>> = {};
  for (const [id, entry] of Object.entries(defaults) as [string, Record<string, unknown>][]) {
    const entryOverride = overrides?.[id] ?? {};
    const filtered: NumericPatch = {};
    for (const field of allowedFields) {
      const value = entryOverride[field];
      if (typeof value === "number" && Number.isFinite(value)) filtered[field] = value;
    }
    merged[id] = { ...entry, ...filtered };
  }
  return merged;
}

function recompute(): void {
  // Per-key assignment inside a loop over a union-typed key can't be
  // narrowed by TS to "the value type for this specific K" — this is a
  // known mapped-type limitation, not a runtime bug: each iteration's
  // `defaults`/`override`/assignment all genuinely correspond to the same
  // groupName, just not provably so to the type checker across a loop.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flat: any = {};
  for (const groupName of Object.keys(FLAT_GROUPS) as FlatGroupName[]) {
    const defaults = FLAT_GROUPS[groupName];
    const override = persistedOverrides.flat?.[groupName] ?? {};
    flat[groupName] = { ...defaults, ...override };
  }
  mergedCache = {
    ...flat,
    COMPANY_INDUSTRIES: mergeRecordGroup(
      COMPANY_INDUSTRIES,
      persistedOverrides.COMPANY_INDUSTRIES,
      COMPANY_INDUSTRY_EDITABLE_FIELDS,
    ) as unknown as typeof COMPANY_INDUSTRIES,
  } as unknown as MergedGameConfig;
}

async function persist(): Promise<void> {
  const data = JSON.stringify(persistedOverrides);
  await prisma.gameConfigOverride.upsert({
    where: { id: 1 },
    update: { data },
    create: { id: 1, data },
  });
}

/** Call once at server boot, before the scheduler starts. */
export async function initGameConfigStore(): Promise<void> {
  const row = await prisma.gameConfigOverride.findUnique({ where: { id: 1 } });
  persistedOverrides = row ? (JSON.parse(row.data) as GameConfigOverrides) : {};
  recompute();
}

/** O(1) — call anywhere, as often as needed. Always reads the latest edits. */
export function getConfig(): MergedGameConfig {
  return mergedCache;
}

export async function setFlatOverrides(group: FlatGroupName, patch: NumericPatch): Promise<MergedGameConfig> {
  if (!(group in FLAT_GROUPS)) throw new Error(`Unknown tuning group: ${group}`);
  const validFields = new Set(Object.keys(FLAT_GROUPS[group]));
  const filtered: NumericPatch = {};
  for (const [key, value] of Object.entries(patch)) {
    if (validFields.has(key) && typeof value === "number" && Number.isFinite(value)) filtered[key] = value;
  }
  persistedOverrides.flat = persistedOverrides.flat ?? {};
  persistedOverrides.flat[group] = { ...(persistedOverrides.flat[group] ?? {}), ...filtered };
  await persist();
  recompute();
  return mergedCache;
}

export async function setRecordOverrides(
  group: "COMPANY_INDUSTRIES",
  entryId: string,
  patch: NumericPatch,
): Promise<MergedGameConfig> {
  const allowedFields = COMPANY_INDUSTRY_EDITABLE_FIELDS;
  const defaults = COMPANY_INDUSTRIES;
  if (!(entryId in defaults)) throw new Error(`Unknown ${group} entry: ${entryId}`);
  const filtered: NumericPatch = {};
  for (const [key, value] of Object.entries(patch)) {
    if ((allowedFields as readonly string[]).includes(key) && typeof value === "number" && Number.isFinite(value)) {
      filtered[key] = value;
    }
  }
  persistedOverrides[group] = persistedOverrides[group] ?? {};
  persistedOverrides[group]![entryId] = { ...(persistedOverrides[group]![entryId] ?? {}), ...filtered };
  await persist();
  recompute();
  return mergedCache;
}

export async function resetFlatGroup(group: FlatGroupName): Promise<MergedGameConfig> {
  if (persistedOverrides.flat) delete persistedOverrides.flat[group];
  await persist();
  recompute();
  return mergedCache;
}

export async function resetRecordEntry(group: "COMPANY_INDUSTRIES", entryId: string): Promise<MergedGameConfig> {
  if (persistedOverrides[group]) delete persistedOverrides[group]![entryId];
  await persist();
  recompute();
  return mergedCache;
}

export async function resetAll(): Promise<MergedGameConfig> {
  persistedOverrides = {};
  await persist();
  recompute();
  return mergedCache;
}

// Shown once above the COMPANY_INDUSTRIES table in the admin panel — the
// per-field labels (Wage Per Worker Per Hour, Max Workers, Founding Cost)
// are already self-explanatory, so this only needs to explain the table as
// a whole plus the one thing it can't reach.
const COMPANY_INDUSTRIES_DESCRIPTION =
  "Per-industry wages, worker cap, and founding cost — one row per company type, including land-gated ones (Power Plant, Farm, etc). Recipe quantities (which resources an industry buys/sells and how much) aren't editable here, only these three rates.";

// Field-name metadata so the client can render an editor generically
// instead of hardcoding a second copy of the group/field list that could
// drift out of sync with this file.
export function getConfigRegistryMeta() {
  const flatGroups: Record<string, string[]> = {};
  const flatGroupDescriptions: Record<string, string> = {};
  for (const groupName of Object.keys(FLAT_GROUPS) as FlatGroupName[]) {
    flatGroups[groupName] = Object.keys(FLAT_GROUPS[groupName]);
    flatGroupDescriptions[groupName] = FLAT_GROUP_DESCRIPTIONS[groupName];
  }
  return {
    flatGroups,
    flatGroupDescriptions,
    companyIndustryFields: COMPANY_INDUSTRY_EDITABLE_FIELDS,
    companyIndustriesDescription: COMPANY_INDUSTRIES_DESCRIPTION,
  };
}
