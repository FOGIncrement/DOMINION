import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { BANK_TUNING, LOAN_TERM_OPTIONS, computeLoanRate, computeMaxLoanAmount } from "@dominion/shared";
import { api, ApiError, type PublicBank } from "../api/client.js";
import { useBanks, useGameState, useMyBanks, useMyCompanies, useMyLoans } from "../api/hooks.js";

const RISK_COLOR: Record<string, string> = {
  low: "var(--success)",
  medium: "var(--warning)",
  high: "var(--critical)",
  defaulted: "var(--critical)",
};

type BankSortKey = "cash" | "interestRatePerHour";

function SortableHeader({
  label,
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <th className="sortable-header" onClick={onClick}>
      {label}
      {active && <span className="sortable-header__arrow">{direction === "asc" ? "▲" : "▼"}</span>}
    </th>
  );
}

function invalidateBanking(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["banks"] });
  queryClient.invalidateQueries({ queryKey: ["myBanks"] });
  queryClient.invalidateQueries({ queryKey: ["myLoans"] });
  queryClient.invalidateQueries({ queryKey: ["myCompanies"] });
  queryClient.invalidateQueries({ queryKey: ["gameState"] });
}

function FoundBankForm() {
  const queryClient = useQueryClient();
  const { data: gameState } = useGameState();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const found = useMutation({
    mutationFn: () => api.foundBank(name || "New Bank"),
    onSuccess: () => {
      setError(null);
      setName("");
      invalidateBanking(queryClient);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Couldn't found bank"),
  });

  const canAfford = (gameState?.settlement.gold ?? 0) >= BANK_TUNING.foundingCost;

  return (
    <div className="card">
      <h2 className="card__title">Found a Bank</h2>
      {error && <div className="auth-error">{error}</div>}
      <div className="trade-row">
        <input type="text" placeholder="Bank name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 200 }} />
        <button className="btn btn--accent" disabled={!canAfford || found.isPending} onClick={() => found.mutate()}>
          Found ({BANK_TUNING.foundingCost}g)
        </button>
      </div>
      {!canAfford && <p className="suggestion" style={{ marginTop: 8 }}>Not enough gold yet.</p>}
    </div>
  );
}

function RequestLoanForm() {
  const queryClient = useQueryClient();
  const { data: banks } = useBanks();
  const { data: myCompanies } = useMyCompanies();
  const [bankId, setBankId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [amount, setAmount] = useState(100);
  const [termHours, setTermHours] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const requestLoan = useMutation({
    mutationFn: () => api.requestLoan(bankId, companyId, amount, termHours),
    onSuccess: () => {
      setError(null);
      setMessage(`Loan of ${amount}g issued.`);
      invalidateBanking(queryClient);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Loan request failed"),
  });

  const companies = myCompanies?.companies ?? [];
  const bankOptions = banks?.banks ?? [];

  const selectedCompany = companies.find((c) => c.id === companyId);
  const selectedBank = bankOptions.find((b) => b.id === bankId);
  const termOption = LOAN_TERM_OPTIONS.find((t) => t.hours === termHours);
  const quote =
    selectedCompany && selectedBank
      ? {
          maxLoan: computeMaxLoanAmount(selectedCompany.cash),
          rate: computeLoanRate(selectedBank.interestRatePerHour, amount, selectedCompany.cash, termOption?.rateDiscount),
        }
      : null;

  return (
    <div className="card">
      <h2 className="card__title">Request a Loan</h2>
      {companies.length === 0 ? (
        <div className="empty-state">Found a company first — banks lend to companies, not settlements directly.</div>
      ) : (
        <>
          {error && <div className="auth-error">{error}</div>}
          {message && !error && <div className="suggestion">{message}</div>}
          <div className="trade-row" style={{ flexWrap: "wrap" }}>
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">Company...</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({Math.round(c.cash)}g cash)
                </option>
              ))}
            </select>
            <select value={bankId} onChange={(e) => setBankId(e.target.value)}>
              <option value="">Bank...</option>
              {bankOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({(b.interestRatePerHour * 100).toFixed(2)}%/hr base, {b.cash}g available)
                </option>
              ))}
            </select>
            <select value={termHours ?? ""} onChange={(e) => setTermHours(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Revolving (no term)</option>
              {LOAN_TERM_OPTIONS.map((t) => (
                <option key={t.hours} value={t.hours}>
                  {t.label} (−{(t.rateDiscount * 100).toFixed(0)}% rate)
                </option>
              ))}
            </select>
            <input type="number" min={1} value={amount} onChange={(e) => setAmount(Math.max(1, Number(e.target.value)))} />
            <button
              className="btn btn--accent"
              disabled={!companyId || !bankId || requestLoan.isPending}
              onClick={() => requestLoan.mutate()}
            >
              Borrow
            </button>
          </div>
          {quote && (
            <p className="suggestion" style={{ marginTop: 8 }}>
              Quoted rate for this amount: <b>{(quote.rate * 100).toFixed(2)}%/hr</b> — the closer a loan gets to this
              company's {quote.maxLoan.toFixed(0)}g credit limit, the higher the rate climbs above the bank's base
              rate. {amount > quote.maxLoan && "This amount exceeds the credit limit and will be rejected."}
              {termOption && " Committing to a term buys a lower rate, but the loan defaults immediately if any balance remains at maturity — repaying early any time is always fine."}
            </p>
          )}
          <p className="suggestion" style={{ marginTop: 8 }}>
            Credit check caps a loan at {BANK_TUNING.maxLoanToCashRatio}x the company's current cash. Interest compounds
            hourly on the outstanding balance until repaid — leave a revolving loan too long and it defaults.
          </p>
        </>
      )}
    </div>
  );
}

function MyLoansList() {
  const queryClient = useQueryClient();
  const { data: loans } = useMyLoans();
  const [repayAmounts, setRepayAmounts] = useState<Record<string, number>>({});
  const [riskFilter, setRiskFilter] = useState<"all" | "low" | "medium" | "high" | "defaulted">("all");
  const [error, setError] = useState<string | null>(null);

  const repay = useMutation({
    mutationFn: ({ loanId, amount }: { loanId: string; amount: number }) => api.repayLoan(loanId, amount),
    onSuccess: () => {
      setError(null);
      invalidateBanking(queryClient);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Repayment failed"),
  });

  if (!loans || loans.loans.length === 0) {
    return (
      <div className="card">
        <h2 className="card__title">My Loans</h2>
        <div className="empty-state">No outstanding loans.</div>
      </div>
    );
  }

  const visibleLoans = riskFilter === "all" ? loans.loans : loans.loans.filter((l) => l.risk === riskFilter);

  return (
    <div className="card">
      <h2 className="card__title">My Loans</h2>
      {error && <div className="auth-error">{error}</div>}
      <div className="filter-row">
        <select value={riskFilter} onChange={(e) => setRiskFilter(e.target.value as typeof riskFilter)}>
          <option value="all">All risk levels</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="defaulted">Defaulted</option>
        </select>
      </div>
      {visibleLoans.length === 0 ? (
        <div className="empty-state">No loans match that filter.</div>
      ) : (
      <table className="settlement-table">
        <thead>
          <tr>
            <th>Company</th>
            <th>Bank</th>
            <th>Principal</th>
            <th>Balance</th>
            <th>Rate/hr</th>
            <th>Term</th>
            <th>Risk</th>
            <th>Repay</th>
          </tr>
        </thead>
        <tbody>
          {visibleLoans.map((l) => (
            <tr key={l.id}>
              <td>{l.companyName}</td>
              <td>{l.bankName}</td>
              <td>{l.principal.toFixed(0)}g</td>
              <td>{l.outstandingBalance.toFixed(1)}g</td>
              <td>{(l.interestRatePerHour * 100).toFixed(2)}%</td>
              <td>{l.maturityAt ? `Matures ${new Date(l.maturityAt).toLocaleDateString()}` : "Revolving"}</td>
              <td>
                <span className="archetype-tag" style={{ color: RISK_COLOR[l.risk], borderColor: RISK_COLOR[l.risk] }}>
                  {l.risk}
                </span>
              </td>
              <td>
                {l.defaultedAt ? (
                  "—"
                ) : (
                  <div style={{ display: "flex", gap: 4 }}>
                    <input
                      type="number"
                      min={1}
                      value={repayAmounts[l.id] ?? Math.round(l.outstandingBalance / 4)}
                      onChange={(e) => setRepayAmounts({ ...repayAmounts, [l.id]: Number(e.target.value) })}
                      style={{ width: 70 }}
                    />
                    <button
                      className="btn"
                      disabled={repay.isPending}
                      onClick={() => repay.mutate({ loanId: l.id, amount: repayAmounts[l.id] ?? Math.round(l.outstandingBalance / 4) })}
                    >
                      Pay
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
    </div>
  );
}

export default function Banking() {
  const { data: myBanks } = useMyBanks();
  const { data: banks } = useBanks();
  const [ownerFilter, setOwnerFilter] = useState<"all" | "player" | "npc">("all");
  const [sort, setSort] = useState<{ key: BankSortKey; direction: "asc" | "desc" }>({
    key: "cash",
    direction: "desc",
  });

  const visibleBanks = useMemo(() => {
    const all = banks?.banks ?? [];
    const filtered = all.filter((b) => {
      if (ownerFilter === "player" && !b.isPlayerOwned) return false;
      if (ownerFilter === "npc" && b.isPlayerOwned) return false;
      return true;
    });
    const dir = sort.direction === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => (a[sort.key] - b[sort.key]) * dir);
  }, [banks, ownerFilter, sort]);

  const toggleSort = (key: BankSortKey) => {
    setSort((prev) =>
      prev.key === key ? { key, direction: prev.direction === "asc" ? "desc" : "asc" } : { key, direction: "desc" },
    );
  };

  return (
    <div className="page page--full">
      {myBanks && myBanks.banks.length > 0 && (
        <div className="card">
          <h2 className="card__title">My Banks</h2>
          <div className="company-grid">
            {myBanks.banks.map((b) => (
              <div className="company-card" key={b.id}>
                <div className="building-card__head">
                  <span className="building-card__name">{b.name}</span>
                  <span className="archetype-tag">{(b.interestRatePerHour * 100).toFixed(2)}%/hr</span>
                </div>
                <div className="company-card__stats">
                  <div>
                    <div className="delta-cell__label">Reserve cash</div>
                    <div className="delta-cell__value">{b.cash.toFixed(0)}g</div>
                  </div>
                  <div>
                    <div className="delta-cell__label">Loans issued</div>
                    <div className="delta-cell__value">{b.loansIssued.length}</div>
                  </div>
                </div>
                {b.loansIssued.length > 0 && (
                  <table className="settlement-table">
                    <thead>
                      <tr>
                        <th>Borrower</th>
                        <th>Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {b.loansIssued.map((l) => (
                        <tr key={l.id}>
                          <td>{l.companyName}</td>
                          <td>{l.outstandingBalance.toFixed(1)}g</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <FoundBankForm />
      <RequestLoanForm />
      <MyLoansList />

      <div className="card">
        <h2 className="card__title">Banks of the World</h2>
        {!banks ? (
          <div className="loading">Loading...</div>
        ) : (
          <>
            <div className="filter-row">
              <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value as typeof ownerFilter)}>
                <option value="all">All owners</option>
                <option value="player">Player-owned</option>
                <option value="npc">NPC-owned</option>
              </select>
            </div>
            {visibleBanks.length === 0 ? (
              <div className="empty-state">No banks match that filter.</div>
            ) : (
              <table className="settlement-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Owner</th>
                    <SortableHeader
                      label="Reserve Cash"
                      active={sort.key === "cash"}
                      direction={sort.direction}
                      onClick={() => toggleSort("cash")}
                    />
                    <SortableHeader
                      label="Rate/hr"
                      active={sort.key === "interestRatePerHour"}
                      direction={sort.direction}
                      onClick={() => toggleSort("interestRatePerHour")}
                    />
                    <th>Founded</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleBanks.map((b: PublicBank) => (
                    <tr key={b.id}>
                      <td>{b.name}</td>
                      <td>{b.isPlayerOwned ? "Player" : "NPC"}</td>
                      <td>{b.cash.toLocaleString()}g</td>
                      <td>{(b.interestRatePerHour * 100).toFixed(2)}%</td>
                      <td>{new Date(b.foundedAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}
