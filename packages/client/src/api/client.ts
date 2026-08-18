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

  techs: () => request<{ techs: TechInfo[] }>("/tech"),
  research: (techId: string) => request<{ ok: true }>("/tech/research", { method: "POST", body: JSON.stringify({ techId }) }),

  market: () => request<MarketResponse>("/market"),
  trade: (resourceType: string, side: "buy" | "sell", quantity: number) =>
    request<{ ok: true; newPrice: number; proceeds?: number; cost?: number }>("/market/trade", {
      method: "POST",
      body: JSON.stringify({ resourceType, side, quantity }),
    }),

  worldSettlements: () => request<{ settlements: NpcSettlementInfo[] }>("/world/settlements"),
  news: () => request<{ events: NewsEvent[] }>("/news"),

  myCompanies: () => request<{ companies: MyCompany[] }>("/companies/mine"),
  allCompanies: () => request<{ companies: PublicCompany[] }>("/companies"),
  foundCompany: (name: string, industry: string) =>
    request<{ ok: true; companyId: string }>("/companies", {
      method: "POST",
      body: JSON.stringify({ name, industry }),
    }),
  setCompanyWorkers: (companyId: string, workersAssigned: number) =>
    request<{ ok: true; workersAssigned: number }>(`/companies/${companyId}/workers`, {
      method: "POST",
      body: JSON.stringify({ workersAssigned }),
    }),
  tradeCompany: (companyId: string, side: "buy" | "sell", quantity: number) =>
    request<{ ok: true; newPrice: number; proceeds?: number; cost?: number }>(`/companies/${companyId}/trade`, {
      method: "POST",
      body: JSON.stringify({ side, quantity }),
    }),
  withdrawCompanyCash: (companyId: string, amount: number) =>
    request<{ ok: true }>(`/companies/${companyId}/withdraw`, {
      method: "POST",
      body: JSON.stringify({ amount }),
    }),
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
  buildings: { id: string; type: string; level: number; workersAssigned: number }[];
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
  totalRevenue: number;
  totalExpenses: number;
  foundedAt: string;
  rates: { inputPerHour: number; goodsPerHour: number; wagePerHour: number };
}

export interface PublicCompany {
  id: string;
  name: string;
  industry: string;
  industryName: string;
  isPlayerOwned: boolean;
  workersAssigned: number;
  cash: number;
  foundedAt: string;
}
