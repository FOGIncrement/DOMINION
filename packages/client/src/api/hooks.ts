import { useQuery } from "@tanstack/react-query";
import { api } from "./client.js";

const POLL_MS = 15_000;

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: api.me, retry: false });
}

export function useGameState() {
  return useQuery({ queryKey: ["gameState"], queryFn: api.gameState, refetchInterval: POLL_MS });
}

export function useMarket() {
  return useQuery({ queryKey: ["market"], queryFn: api.market, refetchInterval: POLL_MS });
}

export function useWorldSettlements() {
  return useQuery({ queryKey: ["worldSettlements"], queryFn: api.worldSettlements, refetchInterval: POLL_MS });
}

export function useWorldMap() {
  return useQuery({ queryKey: ["worldMap"], queryFn: api.worldMap, refetchInterval: POLL_MS });
}

export function useNews() {
  return useQuery({ queryKey: ["news"], queryFn: api.news, refetchInterval: POLL_MS });
}

export function useMyCompanies() {
  return useQuery({ queryKey: ["myCompanies"], queryFn: api.myCompanies, refetchInterval: POLL_MS });
}

export function useAllCompanies() {
  return useQuery({ queryKey: ["allCompanies"], queryFn: api.allCompanies, refetchInterval: POLL_MS });
}

export function useMyContracts() {
  return useQuery({ queryKey: ["myContracts"], queryFn: api.myContracts, refetchInterval: POLL_MS });
}

export function useWorldContracts() {
  return useQuery({ queryKey: ["worldContracts"], queryFn: api.worldContracts, refetchInterval: POLL_MS });
}

export function useStocks() {
  return useQuery({ queryKey: ["stocks"], queryFn: api.stocks, refetchInterval: POLL_MS });
}

export function useStockDetail(companyId: string | null) {
  return useQuery({
    queryKey: ["stockDetail", companyId],
    queryFn: () => api.stockDetail(companyId!),
    enabled: !!companyId,
    refetchInterval: POLL_MS,
  });
}

export function usePortfolio() {
  return useQuery({ queryKey: ["portfolio"], queryFn: api.portfolio, refetchInterval: POLL_MS });
}

export function useBanks() {
  return useQuery({ queryKey: ["banks"], queryFn: api.banks, refetchInterval: POLL_MS });
}

export function useMyBanks() {
  return useQuery({ queryKey: ["myBanks"], queryFn: api.myBanks, refetchInterval: POLL_MS });
}

export function useMyLoans() {
  return useQuery({ queryKey: ["myLoans"], queryFn: api.myLoans, refetchInterval: POLL_MS });
}

export function useMyDeposits() {
  return useQuery({ queryKey: ["myDeposits"], queryFn: api.myDeposits, refetchInterval: POLL_MS });
}

export function useBondGovernments() {
  return useQuery({ queryKey: ["bondGovernments"], queryFn: api.bondGovernments, refetchInterval: POLL_MS });
}

export function useMyBonds() {
  return useQuery({ queryKey: ["myBonds"], queryFn: api.myBonds, refetchInterval: POLL_MS });
}

export function useCorporateBondCompanies() {
  return useQuery({ queryKey: ["corporateBondCompanies"], queryFn: api.corporateBondCompanies, refetchInterval: POLL_MS });
}

export function useMyCorporateBonds() {
  return useQuery({ queryKey: ["myCorporateBonds"], queryFn: api.myCorporateBonds, refetchInterval: POLL_MS });
}

export function useCheatsEnabled() {
  return useQuery({
    queryKey: ["cheatsEnabled"],
    queryFn: api.cheatsStatus,
    staleTime: Infinity,
    retry: false,
  });
}

export function useGovernment() {
  return useQuery({ queryKey: ["government"], queryFn: api.government, refetchInterval: POLL_MS });
}

export function useZones() {
  return useQuery({ queryKey: ["zones"], queryFn: api.zones, refetchInterval: POLL_MS });
}

export function useMyZoneProjects() {
  return useQuery({ queryKey: ["myZoneProjects"], queryFn: api.myZoneProjects, refetchInterval: POLL_MS });
}

// No refetchInterval — the tutorial only ever moves forward in response to
// the player's own actions in this session, each of which already
// invalidates ["tutorial"] itself, so polling would just be wasted requests.
export function useTutorial() {
  return useQuery({ queryKey: ["tutorial"], queryFn: api.tutorial });
}

// No refetchInterval — only the admin editing it changes this, and every
// save/reset mutation already updates the query cache directly from the
// response instead of relying on a refetch.
export function useAdminConfig() {
  return useQuery({ queryKey: ["adminConfig"], queryFn: api.adminConfig, retry: false });
}

export function useAnnouncements() {
  return useQuery({ queryKey: ["announcements"], queryFn: api.announcements, refetchInterval: POLL_MS });
}

// staleTime: Infinity — the baked raster this fetches never changes without
// a worldgen rerun + server restart, so one fetch per session is enough; see
// useTerritoryClaims below for the part that does change.
export function useMapPreview() {
  return useQuery({ queryKey: ["mapPreview"], queryFn: api.mapPreview, staleTime: Infinity, retry: false });
}

export function useTerritoryClaims() {
  return useQuery({ queryKey: ["territoryClaims"], queryFn: api.territoryClaims, refetchInterval: POLL_MS });
}

export function useMyTerritories() {
  return useQuery({ queryKey: ["myTerritories"], queryFn: api.myTerritories, refetchInterval: POLL_MS });
}

// staleTime: Infinity, same reasoning as useMapPreview — the underlying
// native-resolution raster this crops never changes without a worldgen
// rerun + restart; only invalidated explicitly after gaining/losing land.
export function useMyTerritoryDetail(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["myTerritoryDetail"],
    queryFn: api.myTerritoryDetail,
    staleTime: Infinity,
    retry: false,
    enabled: options?.enabled ?? true,
  });
}

export function useMyMilitary() {
  return useQuery({ queryKey: ["myMilitary"], queryFn: api.myMilitary, refetchInterval: POLL_MS });
}
