import type { MarketResourceType } from "@dominion/shared";

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
  me: () => request<{ playerId: string; email: string }>("/auth/me"),

  gameState: () => request<GameStateResponse>("/game/state"),
  build: (type: string) => request<{ ok: true }>("/game/buildings", { method: "POST", body: JSON.stringify({ type }) }),
  setWorkers: (buildingId: string, workersAssigned: number) =>
    request<{ ok: true; workersAssigned: number }>("/game/workers", {
      method: "POST",
      body: JSON.stringify({ buildingId, workersAssigned }),
    }),
  upgradeBuilding: (buildingId: string) =>
    request<{ ok: true; level: number }>(`/game/buildings/${buildingId}/upgrade`, { method: "POST" }),

  techs: () => request<{ techs: TechInfo[] }>("/tech"),
  research: (techId: string) => request<{ ok: true }>("/tech/research", { method: "POST", body: JSON.stringify({ techId }) }),

  market: () => request<MarketResponse>("/market"),
  trade: (resourceType: string, side: "buy" | "sell", quantity: number) =>
    request<{ ok: true; newPrice: number; proceeds?: number; cost?: number; tax?: number }>("/market/trade", {
      method: "POST",
      body: JSON.stringify({ resourceType, side, quantity }),
    }),

  worldSettlements: () => request<{ settlements: NpcSettlementInfo[] }>("/world/settlements"),
  news: () => request<{ events: NewsEvent[] }>("/news"),

  myCompanies: () => request<{ companies: MyCompany[] }>("/companies/mine"),
  allCompanies: () => request<{ companies: PublicCompany[] }>("/companies"),
  foundCompany: (name: string, industry: string, seedMoney: number = 0) =>
    request<{ ok: true; companyId: string }>("/companies", {
      method: "POST",
      body: JSON.stringify({ name, industry, seedMoney }),
    }),
  setCompanyWorkers: (companyId: string, workersAssigned: number) =>
    request<{ ok: true; workersAssigned: number }>(`/companies/${companyId}/workers`, {
      method: "POST",
      body: JSON.stringify({ workersAssigned }),
    }),
  tradeCompany: (companyId: string, side: "buy" | "sell", quantity: number) =>
    request<{ ok: true; newPrice: number; proceeds?: number; cost?: number; tax?: number }>(`/companies/${companyId}/trade`, {
      method: "POST",
      body: JSON.stringify({ side, quantity }),
    }),
  withdrawCompanyCash: (companyId: string, amount: number) =>
    request<{ ok: true }>(`/companies/${companyId}/withdraw`, {
      method: "POST",
      body: JSON.stringify({ amount }),
    }),
  upgradeCompany: (companyId: string) =>
    request<{ ok: true; level: number; cost: number }>(`/companies/${companyId}/upgrade`, { method: "POST" }),
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
  createContract: (
    sellerCompanyId: string,
    buyerCompanyId: string,
    quantityPerHour: number,
    pricePerUnit: number,
    termHours: number,
  ) =>
    request<{ ok: true; contractId: string; pending: boolean }>("/contracts", {
      method: "POST",
      body: JSON.stringify({ sellerCompanyId, buyerCompanyId, quantityPerHour, pricePerUnit, termHours }),
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

  cheatsStatus: () => request<{ enabled: boolean }>("/cheats/status"),
  cheatAddResources: (deltas: Partial<Record<"food" | "wood" | "stone" | "gold", number>>) =>
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
};

export interface OfflineSummary {
  awaySeconds: number;
  resourceDeltas: { food: number; wood: number; stone: number; gold: number };
  populationDelta: number;
  events: { id: string; title: string; description: string; occurredAt: string }[];
}

export interface GameStateResponse {
  settlement: {
    id: string;
    name: string;
    era: number;
    food: number;
    wood: number;
    stone: number;
    gold: number;
    storageCap: number;
    foundedAt: string;
  };
  population: { count: number; happiness: number; capacity: number };
  buildings: {
    id: string;
    type: string;
    level: number;
    workersAssigned: number;
    upgradeCost: Partial<Record<"food" | "wood" | "stone" | "gold", number>> | null;
  }[];
  techIds: string[];
  offlineSummary: OfflineSummary | null;
}

export interface TechInfo {
  id: string;
  name: string;
  description: string;
  cost: Record<string, number>;
  requiredTech?: string;
  unlocksBuilding?: string;
  researched: boolean;
  available: boolean;
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
  buildingCount: number;
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
  cash: number;
  inputStock: number;
  goodsStock: number;
  workersAssigned: number;
  maxWorkers: number;
  level: number;
  upgradeCost: number | null;
  totalRevenue: number;
  totalExpenses: number;
  foundedAt: string;
  rates: { inputPerHour: number; goodsPerHour: number; wagePerHour: number };
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

export interface MyDeposit {
  id: string;
  bankId: string;
  bankName: string;
  bankCash: number;
  amount: number;
  interestRatePerHour: number;
  createdAt: string;
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
