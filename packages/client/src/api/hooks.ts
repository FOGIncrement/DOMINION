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

export function useNews() {
  return useQuery({ queryKey: ["news"], queryFn: api.news, refetchInterval: POLL_MS });
}

export function useTechs() {
  return useQuery({ queryKey: ["techs"], queryFn: api.techs, refetchInterval: POLL_MS });
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
