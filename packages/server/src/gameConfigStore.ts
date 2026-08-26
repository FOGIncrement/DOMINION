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
  BUILDING_TYPES,
  BUILDING_UPGRADE_TUNING,
  COMPANY_FAILURE_TUNING,
  COMPANY_INDUSTRIES,
  COMPANY_UPGRADE_TUNING,
  CORPORATE_BOND_TUNING,
  DEPOSIT_TUNING,
  DIVIDEND_TUNING,
  EVENT_TUNING,
  LUXURY_GOODS_TUNING,
  MARKET_TUNING,
  NPC_BANKING_TUNING,
  NPC_COMPANY_TUNING,
  NPC_GROWTH_TUNING,
  NPC_INVESTOR_TUNING,
  POPULATION_TUNING,
  RETAIL_TUNING,
  STOCK_TUNING,
  TRADE_FEE,
  WORLD_DEMAND_TUNING,
} from "@dominion/shared";
import { prisma } from "./db.js";

// Every field on every one of these is a plain number — merge is a trivial
// per-field shallow overlay. (BASE_HOUSING_CAPACITY, MAX_CATCHUP_HOURS, and
// the catalog/one-time-read groups — ZONE_TYPES, TECHS, NPC_ARCHETYPE_DEFS,
// EVENT_TEMPLATES, STARTING_SETTLEMENT — are deliberately not in this
// registry: not ongoing-pacing levers, or bare scalars that don't fit the
// group shape. Extend this object using the exact same pattern if any of
// those need to become tunable later.)
const FLAT_GROUPS = {
  POPULATION_TUNING,
  MARKET_TUNING,
  NPC_GROWTH_TUNING,
  COMPANY_UPGRADE_TUNING,
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
  BUILDING_UPGRADE_TUNING,
  BASE_PRICES,
};

type FlatGroupName = keyof typeof FLAT_GROUPS;

// COMPANY_INDUSTRIES / BUILDING_TYPES mix tunable rate fields with
// structural/identity fields (inputResource, outputResource, contractOnly,
// name, cost, requiredTech) that other code branches on — an explicit
// numeric-field allowlist per entry, never a blind recursive merge, so a
// malformed edit can only ever change how fast an industry/building runs,
// never what it fundamentally is.
const COMPANY_INDUSTRY_EDITABLE_FIELDS = [
  "inputPerWorkerPerHour",
  "goodsPerWorkerPerHour",
  "wagePerWorkerPerHour",
  "maxWorkers",
  "foundingCost",
] as const;

const BUILDING_TYPE_EDITABLE_FIELDS = ["productionPerWorkerPerHour", "maxWorkers", "populationCapacity"] as const;

type NumericPatch = Record<string, number>;

interface GameConfigOverrides {
  flat?: Partial<Record<FlatGroupName, NumericPatch>>;
  COMPANY_INDUSTRIES?: Record<string, NumericPatch>;
  BUILDING_TYPES?: Record<string, NumericPatch>;
}

export type MergedGameConfig = {
  [K in FlatGroupName]: (typeof FLAT_GROUPS)[K];
} & {
  COMPANY_INDUSTRIES: typeof COMPANY_INDUSTRIES;
  BUILDING_TYPES: typeof BUILDING_TYPES;
};

let persistedOverrides: GameConfigOverrides = {};
let mergedCache: MergedGameConfig;

// Record-shape config groups (COMPANY_INDUSTRIES/BUILDING_TYPES) are keyed
// by a specific string-literal union (CompanyIndustryId/BuildingTypeId),
// which TS won't structurally match against a generic Record<string, ...>
// constraint — this is a runtime merge utility, not something that needs
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
    BUILDING_TYPES: mergeRecordGroup(
      BUILDING_TYPES,
      persistedOverrides.BUILDING_TYPES,
      BUILDING_TYPE_EDITABLE_FIELDS,
    ) as unknown as typeof BUILDING_TYPES,
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
  group: "COMPANY_INDUSTRIES" | "BUILDING_TYPES",
  entryId: string,
  patch: NumericPatch,
): Promise<MergedGameConfig> {
  const allowedFields = group === "COMPANY_INDUSTRIES" ? COMPANY_INDUSTRY_EDITABLE_FIELDS : BUILDING_TYPE_EDITABLE_FIELDS;
  const defaults = group === "COMPANY_INDUSTRIES" ? COMPANY_INDUSTRIES : BUILDING_TYPES;
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

export async function resetRecordEntry(group: "COMPANY_INDUSTRIES" | "BUILDING_TYPES", entryId: string): Promise<MergedGameConfig> {
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

// Field-name metadata so the client can render an editor generically
// instead of hardcoding a second copy of the group/field list that could
// drift out of sync with this file.
export function getConfigRegistryMeta() {
  const flatGroups: Record<string, string[]> = {};
  for (const groupName of Object.keys(FLAT_GROUPS) as FlatGroupName[]) {
    flatGroups[groupName] = Object.keys(FLAT_GROUPS[groupName]);
  }
  return {
    flatGroups,
    companyIndustryFields: COMPANY_INDUSTRY_EDITABLE_FIELDS,
    buildingTypeFields: BUILDING_TYPE_EDITABLE_FIELDS,
  };
}
