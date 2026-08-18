import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { BANK_TUNING } from "@dominion/shared";
import { api, ApiError } from "../api/client.js";
import { useBanks, useGameState, useMyBanks, useMyCompanies, useMyLoans } from "../api/hooks.js";

const RISK_COLOR: Record<string, string> = {
  low: "var(--success)",
  medium: "var(--warning)",
  high: "var(--critical)",
  defaulted: "var(--critical)",
};

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
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const requestLoan = useMutation({
    mutationFn: () => api.requestLoan(bankId, companyId, amount),
    onSuccess: () => {
      setError(null);
      setMessage(`Loan of ${amount}g issued.`);
      invalidateBanking(queryClient);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Loan request failed"),
  });

  const companies = myCompanies?.companies ?? [];
  const bankOptions = banks?.banks ?? [];

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
                  {b.name} ({(b.interestRatePerHour * 100).toFixed(2)}%/hr, {b.cash}g available)
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
          <p className="suggestion" style={{ marginTop: 8 }}>
            Credit check caps a loan at {BANK_TUNING.maxLoanToCashRatio}x the company's current cash. Interest compounds
            hourly on the outstanding balance until repaid — leave it too long and it defaults.
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

  return (
    <div className="card">
      <h2 className="card__title">My Loans</h2>
      {error && <div className="auth-error">{error}</div>}
      <table className="settlement-table">
        <thead>
          <tr>
            <th>Company</th>
            <th>Bank</th>
            <th>Principal</th>
            <th>Balance</th>
            <th>Rate/hr</th>
            <th>Risk</th>
            <th>Repay</th>
          </tr>
        </thead>
        <tbody>
          {loans.loans.map((l) => (
            <tr key={l.id}>
              <td>{l.companyName}</td>
              <td>{l.bankName}</td>
              <td>{l.principal.toFixed(0)}g</td>
              <td>{l.outstandingBalance.toFixed(1)}g</td>
              <td>{(l.interestRatePerHour * 100).toFixed(2)}%</td>
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
    </div>
  );
}

export default function Banking() {
  const { data: myBanks } = useMyBanks();
  const { data: banks } = useBanks();

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
          <table className="settlement-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Owner</th>
                <th>Reserve Cash</th>
                <th>Rate/hr</th>
                <th>Founded</th>
              </tr>
            </thead>
            <tbody>
              {banks.banks.map((b) => (
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
      </div>
    </div>
  );
}
