import type { CompanyIndustryId, CurrencyCode, MarketResourceType, TutorialStep } from "@dominion/shared";

const BASE = "/api";

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  register: (email: string, password: string, settlementName: string) =>
    request<{ playerId: string }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, settlementName }),
    }),
  login: (email: string, password: string) =>
    request<{ playerId: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  me: () => request<{ playerId: string; email: string; isAdmin: boolean; currencyCode: CurrencyCode }>("/auth/me"),
  setCurrency: (currencyCode: CurrencyCode) =>
    request<{ ok: true; currencyCode: CurrencyCode }>("/auth/me/currency", {
      method: "PATCH",
      body: JSON.stringify({ currencyCode }),
    }),

  gameState: () => request<GameStateResponse>("/game/state"),

  market: () => request<MarketResponse>("/market"),
  trade: (resourceType: string, side: "buy" | "sell", quantity: number) =>
    request<{ ok: true; newPrice: number; proceeds?: number; cost?: number; tax?: number }>("/market/trade", {
      method: "POST",
      body: JSON.stringify({ resourceType, side, quantity }),
    }),

  worldSettlements: () => request<{ settlements: NpcSettlementInfo[] }>("/world/settlements"),
  worldMap: () => request<WorldMapResponse>("/world/map"),
  news: () => request<{ events: NewsEvent[] }>("/news"),

  myCompanies: () => request<{ companies: MyCompany[] }>("/companies/mine"),
  allCompanies: () => request<{ companies: PublicCompany[] }>("/companies"),
  foundCompany: (name: string, industry: string, seedMoney: number = 0) =>
    request<{ ok: true; companyId: string }>("/companies", {
      method: "POST",
      body: JSON.stringify({ name, industry, seedMoney }),
    }),
  // Founding Grid — the map-driven founding path (see Map.tsx's inline
  // drawer): the player picks the exact cell, rather than the plain
  // foundCompany() route or the zone-capacity pool picking one for them.
  foundCompanyAtCell: (zoneId: string, cellX: number, cellY: number, industry: CompanyIndustryId, name: string, seedMoney = 0) =>
    request<{ ok: true; companyId: string; zoneId: string; cellX: number; cellY: number }>("/companies/at-cell", {
      method: "POST",
      body: JSON.stringify({ zoneId, cellX, cellY, industry, name, seedMoney }),
    }),
  setCompanyWorkers: (companyId: string, workersAssigned: number) =>
    request<{ ok: true; workersAssigned: number }>(`/companies/${companyId}/workers`, {
      method: "POST",
      body: JSON.stringify({ workersAssigned }),
    }),
  setAutoStaff: (companyId: string, enabled: boolean) =>
    request<{ ok: true; autoStaff: boolean }>(`/companies/${companyId}/auto-staff`, {
      method: "POST",
      body: JSON.stringify({ enabled }),
    }),
  tradeCompany: (companyId: string, side: "buy" | "sell", resource: MarketResourceType, quantity: number) =>
    request<{ ok: true; newPrice: number; proceeds?: number; cost?: number; tax?: number }>(`/companies/${companyId}/trade`, {
      method: "POST",
      body: JSON.stringify({ side, resource, quantity }),
    }),
  withdrawCompanyCash: (companyId: string, amount: number) =>
    request<{ ok: true }>(`/companies/${companyId}/withdraw`, {
      method: "POST",
      body: JSON.stringify({ amount }),
    }),
  upgradeCompany: (companyId: string) =>
    request<{ ok: true; level: number; cost: number }>(`/companies/${companyId}/upgrade`, { method: "POST" }),
  expandCompany: (companyId: string) =>
    request<{ ok: true; facilityCount: number; cost: number }>(`/companies/${companyId}/expand`, { method: "POST" }),
  bailoutCompany: (companyId: string, amount: number) =>
    request<{ ok: true; amount: number; remainingDeficit: number }>(`/companies/${companyId}/bailout`, {
      method: "POST",
      body: JSON.stringify({ amount }),
    }),
  closeCompany: (companyId: string) =>
    request<{ ok: true; recoveredCash: number }>(`/companies/${companyId}/close`, { method: "POST" }),
  ipoCompany: (companyId: string) =>
    request<{ ok: true; sharePrice: number; sharesOutstanding: number }>(`/companies/${companyId}/ipo`, {
      method: "POST",
    }),

  myContracts: () => request<{ contracts: MyContract[] }>("/contracts/mine"),
  worldContracts: () => request<{ contracts: WorldContract[] }>("/contracts/world"),
  createContract: (
    sellerCompanyId: string,
    buyerCompanyId: string,
    resourceType: MarketResourceType,
    quantityPerHour: number,
    pricePerUnit: number,
    termHours: number,
  ) =>
    request<{ ok: true; contractId: string; pending: boolean }>("/contracts", {
      method: "POST",
      body: JSON.stringify({ sellerCompanyId, buyerCompanyId, resourceType, quantityPerHour, pricePerUnit, termHours }),
    }),
  cancelContract: (contractId: string) => request<{ ok: true }>(`/contracts/${contractId}/cancel`, { method: "POST" }),
  acceptContract: (contractId: string) => request<{ ok: true }>(`/contracts/${contractId}/accept`, { method: "POST" }),

  stocks: () => request<{ stocks: StockSummary[] }>("/stocks"),
  stockDetail: (companyId: string) => request<StockDetail>(`/stocks/${companyId}`),
  portfolio: () => request<{ holdings: PortfolioHolding[] }>("/stocks/me/portfolio"),
  tradeStock: (companyId: string, side: "buy" | "sell", shares: number) =>
    request<{ ok: true; newPrice: number; proceeds?: number; cost?: number }>(`/stocks/${companyId}/trade`, {
      method: "POST",
      body: JSON.stringify({ side, shares }),
    }),

  banks: () => request<{ banks: PublicBank[] }>("/banks"),
  myBanks: () => request<{ banks: MyBank[] }>("/banks/mine"),
  foundBank: (name: string) => request<{ ok: true; bankId: string }>("/banks", { method: "POST", body: JSON.stringify({ name }) }),
  requestLoan: (bankId: string, companyId: string, amount: number, termHours: number | null = null) =>
    request<{ ok: true; loanId: string; interestRatePerHour: number }>(`/banks/${bankId}/loans`, {
      method: "POST",
      body: JSON.stringify({ companyId, amount, termHours }),
    }),
  myLoans: () => request<{ loans: MyLoan[] }>("/loans/mine"),
  repayLoan: (loanId: string, amount: number) =>
    request<{ ok: true; remainingBalance: number }>(`/loans/${loanId}/repay`, {
      method: "POST",
      body: JSON.stringify({ amount }),
    }),
  requestDeposit: (bankId: string, amount: number) =>
    request<{ ok: true; depositId: string; interestRatePerHour: number }>(`/banks/${bankId}/deposits`, {
      method: "POST",
      body: JSON.stringify({ amount }),
    }),
  myDeposits: () => request<{ deposits: MyDeposit[] }>("/deposits/mine"),
  withdrawDeposit: (depositId: string, amount: number) =>
    request<{ ok: true; withdrawn: number; remainingBalance: number }>(`/deposits/${depositId}/withdraw`, {
      method: "POST",
      body: JSON.stringify({ amount }),
    }),

  bondGovernments: () => request<{ governments: BondGovernment[] }>("/bonds/governments"),
  buyBond: (governmentId: string, amount: number, termHours: number) =>
    request<{ ok: true; bondId: string; interestRatePerHour: number; maturesAt: string }>("/bonds", {
      method: "POST",
      body: JSON.stringify({ governmentId, amount, termHours }),
    }),
  myBonds: () => request<{ bonds: MyBond[] }>("/bonds/mine"),

  corporateBondCompanies: () => request<{ companies: CorporateBondCompany[] }>("/corporate-bonds/companies"),
  buyCorporateBond: (companyId: string, amount: number, termHours: number) =>
    request<{ ok: true; bondId: string; interestRatePerHour: number; maturesAt: string }>("/corporate-bonds", {
      method: "POST",
      body: JSON.stringify({ companyId, amount, termHours }),
    }),
  myCorporateBonds: () => request<{ bonds: MyCorporateBond[] }>("/corporate-bonds/mine"),

  cheatsStatus: () => request<{ enabled: boolean }>("/cheats/status"),
  cheatAddResources: (deltas: Partial<Record<"food" | "gold", number>>) =>
    request<{ ok: true }>("/cheats/resources", { method: "POST", body: JSON.stringify(deltas) }),
  cheatAddPopulation: (amount: number) =>
    request<{ ok: true }>("/cheats/population", { method: "POST", body: JSON.stringify({ amount }) }),
  cheatForceTick: () =>
    request<{ ok: true; settlementsProcessed: number; companiesProcessed: number }>("/cheats/tick", { method: "POST" }),
  cheatAddCompanyCash: (companyId: string, amount: number) =>
    request<{ ok: true }>("/cheats/company-cash", { method: "POST", body: JSON.stringify({ companyId, amount }) }),
  cheatSimulateOffline: (hours: number) =>
    request<{ ok: true }>("/cheats/simulate-offline", { method: "POST", body: JSON.stringify({ hours }) }),

  government: () => request<GovernmentInfo>("/government/mine"),
  setTaxRates: (rates: {
    incomeTaxRate?: number;
    corporateTaxRate?: number;
    welfareRatePerUnemployedPerHour?: number;
  }) => request<{ ok: true }>("/government/rates", { method: "POST", body: JSON.stringify(rates) }),
  subsidize: (companyId: string, amount: number) =>
    request<{ ok: true }>("/government/subsidize", { method: "POST", body: JSON.stringify({ companyId, amount }) }),

  zones: () => request<{ zones: ZoneCatalogEntry[] }>("/infrastructure"),
  myZoneProjects: () => request<{ projects: MyZoneProject[] }>("/infrastructure/mine"),
  // Pay the treasury cost, done — no construction company, no accept/cancel
  // negotiation (see the recipe-economy plan's zoning simplification).
  commissionZone: (
    zoneType: string,
    treasuryCost: number,
    shape: { zoneX: number; zoneY: number; zoneWidth: number; zoneHeight: number },
  ) =>
    request<{ ok: true; projectId: string }>("/infrastructure", {
      method: "POST",
      body: JSON.stringify({ zoneType, treasuryCost, ...shape }),
    }),

  tutorial: () => request<TutorialInfo>("/tutorial"),
  tutorialAdvance: (step: TutorialStep) =>
    request<{ ok: true; step: TutorialStep }>("/tutorial/advance", { method: "POST", body: JSON.stringify({ step }) }),
  tutorialSkip: () => request<{ ok: true; step: TutorialStep }>("/tutorial/skip", { method: "POST" }),

  adminConfig: () => request<AdminConfigResponse>("/admin/config"),
  adminSetFlat: (group: string, patch: Record<string, number>) =>
    request<{ ok: true; config: AdminConfigResponse["config"] }>(`/admin/config/flat/${group}`, {
      method: "POST",
      body: JSON.stringify(patch),
    }),
  adminResetFlat: (group: string) =>
    request<{ ok: true; config: AdminConfigResponse["config"] }>(`/admin/config/flat/${group}/reset`, { method: "POST" }),
  adminSetRecord: (group: "COMPANY_INDUSTRIES", entryId: string, patch: Record<string, number>) =>
    request<{ ok: true; config: AdminConfigResponse["config"] }>(`/admin/config/record/${group}/${entryId}`, {
      method: "POST",
      body: JSON.stringify(patch),
    }),
  adminResetRecord: (group: "COMPANY_INDUSTRIES", entryId: string) =>
    request<{ ok: true; config: AdminConfigResponse["config"] }>(`/admin/config/record/${group}/${entryId}/reset`, {
      method: "POST",
    }),
  adminResetAll: () =>
    request<{ ok: true; config: AdminConfigResponse["config"] }>("/admin/config/reset-all", { method: "POST" }),

  mapPreview: () => request<MapPreviewResponse>("/territory/preview"),
  territoryClaims: () => request<{ claims: TerritoryClaim[] }>("/territory/claims"),
  territoryDetail: (seedIndex: number) => request<TerritoryDetail>(`/territory/${seedIndex}`),
  myTerritories: () => request<{ territories: MyTerritory[] }>("/territory/mine"),
  myTerritoryDetail: () => request<MyTerritoryDetailResponse>("/territory/mine/detail"),
  // Free — only succeeds for a player's very first territory (see the
  // "choose your starting land" picker flow in Continent.tsx).
  claimTerritory: (seedIndex: number) =>
    request<{ ok: true; seedIndex: number; claimedAt: string }>(`/territory/${seedIndex}/claim`, { method: "POST" }),
  // Paid (Government treasury) — every territory after a player's first.
  buyTerritory: (seedIndex: number) =>
    request<{ ok: true; seedIndex: number; claimedAt: string; price: number }>(`/territory/${seedIndex}/buy`, {
      method: "POST",
    }),
  foundOnTerritory: (seedIndex: number, industry: CompanyIndustryId, name: string) =>
    request<{ ok: true; companyId: string }>(`/territory/${seedIndex}/found`, {
      method: "POST",
      body: JSON.stringify({ industry, name }),
    }),

  myMilitary: () => request<MilitaryStatus>("/military/mine"),
  raiseArmy: (goldAmount: number) =>
    request<{ ok: true; armyStrength: number }>("/military/raise", {
      method: "POST",
      body: JSON.stringify({ goldAmount }),
    }),
  attackTerritory: (targetSeedIndex: number) =>
    request<AttackResult>("/military/attack", {
      method: "POST",
      body: JSON.stringify({ targetSeedIndex }),
    }),

  announcements: () => request<{ announcements: Announcement[] }>("/announcements"),
  adminCreateAnnouncement: (title: string, body: string) =>
    request<{ ok: true; id: string }>("/admin/announcements", {
      method: "POST",
      body: JSON.stringify({ title, body }),
    }),
  adminDeleteAnnouncement: (id: string) =>
    request<{ ok: true }>(`/admin/announcements/${id}`, { method: "DELETE" }),
};

export interface OfflineSummary {
  awaySeconds: number;
  resourceDeltas: { food: number; gold: number };
  populationDelta: number;
  events: { id: string; title: string; description: string; occurredAt: string }[];
}

export interface GameStateResponse {
  settlement: {
    id: string;
    name: string;
    era: number;
    food: number;
    gold: number;
    storageCap: number;
    foundedAt: string;
  };
  // available == unemployed: population.count minus every worker currently
  // assigned to a company this player founded — the same number
  // /companies/:id/workers caps hiring against.
  population: { count: number; happiness: number; capacity: number; available: number };
  offlineSummary: OfflineSummary | null;
}

export interface MarketResponse {
  resources: { resourceType: string; supply: number; demand: number; price: number; updatedAt: string }[];
  history: { resourceType: string; price: number; recordedAt: string }[];
}

export interface NpcSettlementInfo {
  id: string;
  name: string;
  archetype: string | null;
  archetypeName: string | null;
  population: number;
  gold: number;
  foundedAt: string;
}

export interface NewsEvent {
  id: string;
  type: string;
  title: string;
  description: string;
  settlementName: string | null;
  occurredAt: string;
}

export interface MyCompany {
  id: string;
  name: string;
  industry: string;
  // Set only for a land-gated company founded via POST
  // /territory/:seedIndex/found — which territory it's founded on.
  territorySeedIndex: number | null;
  // Founding Grid: the zoning-grid cell this company occupies (see
  // Map.tsx). Null for a land-gated company (uses territorySeedIndex
  // instead), for one founded before this feature existed, or for one
  // still covered by its zone category's baseline free-slot allowance.
  zoneId: string | null;
  cellX: number | null;
  cellY: number | null;
  cash: number;
  // One entry per resource this company currently holds any stock of
  // (every recipe input it's stockpiled, every output not yet sold).
  stocks: Partial<Record<MarketResourceType, number>>;
  // Sum of quantity across this company's still-undelivered incoming
  // Shipment rows, grouped by resourceType — goods a supply contract
  // already dispatched but that haven't physically arrived yet (real
  // in-transit shipments; see GET /companies/mine).
  incomingShipments: Partial<Record<MarketResourceType, number>>;
  workersAssigned: number;
  autoStaff: boolean;
  maxWorkers: number;
  level: number;
  upgradeCost: number | null;
  facilityCount: number;
  expandCost: number | null;
  totalRevenue: number;
  totalExpenses: number;
  foundedAt: string;
  rates: {
    inputs: Partial<Record<MarketResourceType, number>>;
    outputs: Partial<Record<MarketResourceType, number>>;
    wagePerHour: number;
  };
  isPublic: boolean;
  sharePrice: number;
  sharesOutstanding: number;
  isFounder: boolean;
  controlledByMe: boolean;
  controllerLabel: string;
}

export interface PublicCompany {
  id: string;
  name: string;
  industry: string;
  industryName: string;
  isPlayerOwned: boolean;
  workersAssigned: number;
  level: number;
  facilityCount: number;
  cash: number;
  foundedAt: string;
  isPublic: boolean;
  sharePrice: number;
}

export interface StockSummary {
  id: string;
  name: string;
  industry: string;
  sharePrice: number;
  sharesOutstanding: number;
  marketCap: number;
  isPlayerOwned: boolean;
  profitRatePerHour: number;
}

export interface StockDetail {
  id: string;
  name: string;
  industry: string;
  cash: number;
  sharePrice: number;
  sharesOutstanding: number;
  marketCap: number;
  totalRevenue: number;
  totalExpenses: number;
  profitRatePerHour: number;
  workersAssigned: number;
  ipoAt: string | null;
  controllerLabel: string;
  history: { price: number; recordedAt: string }[];
  topShareholders: { name: string; isPlayer: boolean; shares: number; percent: number }[];
}

export interface PortfolioHolding {
  companyId: string;
  companyName: string;
  shares: number;
  sharePrice: number;
  value: number;
}

export interface PublicBank {
  id: string;
  name: string;
  cash: number;
  interestRatePerHour: number;
  isPlayerOwned: boolean;
  foundedAt: string;
}

export interface MyBank {
  id: string;
  name: string;
  cash: number;
  interestRatePerHour: number;
  foundedAt: string;
  loansIssued: {
    id: string;
    companyName: string;
    principal: number;
    outstandingBalance: number;
    interestRatePerHour: number;
    termHours: number | null;
    maturityAt: string | null;
  }[];
  depositsHeld: {
    id: string;
    depositorName: string;
    amount: number;
    interestRatePerHour: number;
  }[];
}

export interface MyContract {
  id: string;
  sellerCompanyId: string;
  sellerCompanyName: string;
  sellerIsMine: boolean;
  buyerCompanyId: string;
  buyerCompanyName: string;
  buyerIsMine: boolean;
  resourceType: MarketResourceType;
  quantityPerHour: number;
  pricePerUnit: number;
  termHours: number;
  createdAt: string;
  acceptedAt: string | null;
  expiresAt: string | null;
  cancelledAt: string | null;
  status: "pending" | "active" | "expired" | "cancelled";
}

export interface WorldContract {
  id: string;
  sellerCompanyId: string;
  sellerCompanyName: string;
  sellerIndustry: string;
  sellerOwner: "you" | "player" | "npc";
  buyerCompanyId: string;
  buyerCompanyName: string;
  buyerIndustry: string;
  buyerOwner: "you" | "player" | "npc";
  resourceType: MarketResourceType;
  quantityPerHour: number;
  pricePerUnit: number;
}

export interface MyDeposit {
  id: string;
  bankId: string;
  bankName: string;
  bankCash: number;
  amount: number;
  interestRatePerHour: number;
  createdAt: string;
}

export interface BondGovernment {
  id: string;
  name: string;
  treasury: number;
}

export interface MyBond {
  id: string;
  governmentName: string;
  principal: number;
  interestRatePerHour: number;
  termHours: number;
  issuedAt: string;
  maturesAt: string;
  redeemedAt: string | null;
  redemptionValue: number;
}

export interface CorporateBondCompany {
  id: string;
  name: string;
  industry: string;
  cash: number;
  maxIssuance: number;
}

export interface MyCorporateBond {
  id: string;
  companyId: string;
  companyName: string;
  companyClosed: boolean;
  principal: number;
  interestRatePerHour: number;
  termHours: number;
  issuedAt: string;
  maturesAt: string;
  redeemedAt: string | null;
  redemptionValue: number;
}

export interface MyLoan {
  id: string;
  bankName: string;
  companyId: string;
  companyName: string;
  principal: number;
  outstandingBalance: number;
  interestRatePerHour: number;
  termHours: number | null;
  maturityAt: string | null;
  defaultedAt: string | null;
  risk: "low" | "medium" | "high" | "defaulted";
  createdAt: string;
}

export interface GovernmentInfo {
  treasury: number;
  incomeTaxRate: number;
  corporateTaxRate: number;
  welfareRatePerUnemployedPerHour: number;
  maxRate: number;
  maxWelfareRate: number;
  populationCount: number;
  employedCount: number;
  unemployedCount: number;
  welfareCostPerHour: number;
}

export interface ZoneCatalogEntry {
  id: string;
  name: string;
  description: string;
  industries: string[];
  suggestedTreasuryCost: number;
  buildTimeHours: number;
  slotsGranted: number;
  used: number;
  available: number;
}

export interface TutorialInfo {
  step: TutorialStep;
}

export interface MyZoneProject {
  id: string;
  zoneType: string;
  treasuryCost: number;
  zoneX: number | null;
  zoneY: number | null;
  zoneWidth: number | null;
  zoneHeight: number | null;
  buildTimeHours: number;
  createdAt: string;
  acceptedAt: string | null;
  completesAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  status: "pending" | "cancelled" | "building" | "completed";
}

export interface ZoneRect {
  // The SettlementZone row's id — only present once a zone is "completed"
  // (the only status a company can be founded into, via foundCompanyAtCell
  // above). Null for a still-pending/building zone project.
  id: string | null;
  zoneType: string;
  x: number;
  y: number;
  width: number;
  height: number;
  status: "completed" | "pending" | "building";
}

export interface WorldMapSettlement {
  id: string;
  name: string;
  worldCol: number;
  worldRow: number;
  isPlayer: boolean;
  isMine: boolean;
  archetypeName: string | null;
}

export interface WorldMapResponse {
  cols: number;
  rows: number;
  settlements: WorldMapSettlement[];
  myZones: ZoneRect[];
}

// Loosely typed on purpose — this mirrors the server's runtime tuning
// registry (packages/server/src/gameConfigStore.ts), whose group/field
// shape is generic by design so new tuning groups don't need a matching
// type update here. Flat groups are Record<string, number>; COMPANY_INDUSTRIES
// is Record<id, fullDefWithOverridesApplied> — the editable numeric fields
// are named in meta, everything else is read-only context (name,
// description, structural fields).
export interface AdminConfigResponse {
  config: Record<string, Record<string, unknown>>;
  meta: {
    flatGroups: Record<string, string[]>;
    flatGroupDescriptions: Record<string, string>;
    // Per-entry, not a single shared list like flatGroups — each industry's
    // recipe fields differ (Power Plant has no inputs, Bakery has three).
    companyIndustryFields: Record<string, string[]>;
    companyIndustriesDescription: string;
  };
}

export interface MapPreviewResponse {
  cols: number;
  rows: number;
  cellSizeKm: number;
  biomeIds: string[];
  biome: string; // base64-encoded Uint8Array, cols*rows
  seed: string; // base64-encoded Uint16Array (little-endian), cols*rows — NO_SEED sentinel for ocean/lake
  noSeedSentinel: number;
}

export interface TerritoryClaim {
  seedIndex: number;
  ownerId: string;
  ownerLabel: string;
  status: "active" | "dormant" | "abandoned";
  isMine: boolean;
}

export interface TerritoryDetail {
  seedIndex: number;
  centerWorldX: number;
  centerWorldY: number;
  areaKm2: number;
  dominantBiome: string;
  resources: Record<string, number>;
  status: "unclaimed" | "active" | "dormant" | "abandoned";
  ownerId: string | null;
  isMine: boolean;
  claimedAt?: string;
}

export interface MyTerritory {
  seedIndex: number;
  centerWorldX: number;
  centerWorldY: number;
  areaKm2: number;
  dominantBiome: string;
  resources: Record<string, number>;
  status: "active" | "dormant" | "abandoned";
  claimedAt: string;
}

// Native-resolution crop (no downsampling, unlike MapPreviewResponse) of
// just the player's own owned territory/territories — see the "My
// Territory" page (formerly the old per-island Map.tsx).
export interface MyTerritoryDetailResponse {
  cols: number;
  rows: number;
  cellSizeKm: number;
  biomeIds: string[];
  biome: string; // base64-encoded Uint8Array, cols*rows
  seed: string; // base64-encoded Uint16Array (little-endian), cols*rows — NO_SEED sentinel for cells outside the player's land
  noSeedSentinel: number;
  offsetWorldX: number; // world-km coordinate of this crop's top-left corner, for aligning territory popups/zone placement
  offsetWorldY: number;
}

export interface MilitaryStatus {
  armyStrength: number;
  lastAttackAt: string | null;
  cooldownRemainingSeconds: number;
}

export interface AttackResult {
  ok: true;
  won: boolean;
  attackerPower: number;
  defenderPower: number;
  territorySeedIndex: number;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  authorEmail: string;
  createdAt: string;
}
