import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  BANK_TUNING,
  BOND_TERM_OPTIONS,
  DEPOSIT_TUNING,
  LOAN_TERM_OPTIONS,
  computeBondRate,
  computeCorporateBondRate,
  computeLoanRate,
  computeMaxLoanAmount,
} from "@dominion/shared";
import { api, ApiError, type PublicBank } from "../api/client.js";
import {
  useBanks,
  useBondGovernments,
  useCorporateBondCompanies,
  useGameState,
  useMyBanks,
  useMyBonds,
  useMyCompanies,
  useMyCorporateBonds,
  useMyDeposits,
  useMyLoans,
} from "../api/hooks.js";
import { GlobeIcon, LayersIcon, PlusCircleIcon, ScrollIcon } from "../icons.js";

const RISK_COLOR: Record<string, string> = {
  low: "var(--success)",
  medium: "var(--warning)",
  high: "var(--critical)",
  defaulted: "var(--critical)",
};

type BankSortKey = "cash" | "interestRatePerHour";
type BankingTab = "loans" | "deposits" | "bonds" | "world";
type BondSubTab = "government" | "corporate";

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
  queryClient.invalidateQueries({ queryKey: ["myDeposits"] });
  queryClient.invalidateQueries({ queryKey: ["myCompanies"] });
  queryClient.invalidateQueries({ queryKey: ["gameState"] });
  queryClient.invalidateQueries({ queryKey: ["bondGovernments"] });
  queryClient.invalidateQueries({ queryKey: ["myBonds"] });
  queryClient.invalidateQueries({ queryKey: ["corporateBondCompanies"] });
  queryClient.invalidateQueries({ queryKey: ["myCorporateBonds"] });
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
    <div className="panel">
      <div className="panel__title">Found a Bank</div>
      {error && <div className="auth-error">{error}</div>}
      <div className="trade-row" style={{ marginTop: 0 }}>
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
    <div className="panel">
      <div className="panel__title">Request a Loan</div>
      {companies.length === 0 ? (
        <div className="empty-state">Found a company first — banks lend to companies, not settlements directly.</div>
      ) : (
        <>
          {error && <div className="auth-error">{error}</div>}
          {message && !error && <div className="suggestion">{message}</div>}
          <div className="trade-row" style={{ flexWrap: "wrap", marginTop: 0 }}>
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">Company...</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({Math.floor(c.cash)}g cash)
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
      <div className="panel">
        <div className="panel__title">My Loans</div>
        <div className="empty-state">No outstanding loans.</div>
      </div>
    );
  }

  const visibleLoans = riskFilter === "all" ? loans.loans : loans.loans.filter((l) => l.risk === riskFilter);

  return (
    <div className="panel">
      <div className="panel__title">My Loans — {loans.loans.length} active</div>
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
            <th>Balance</th>
            <th>Rate/hr</th>
            <th>Term</th>
            <th>Risk</th>
            <th>Repay</th>
          </tr>
        </thead>
        <tbody>
          {visibleLoans.map((l) => (
            <tr key={l.id} className={l.risk === "high" || l.risk === "defaulted" ? "attention-row" : ""}>
              <td>{l.companyName}</td>
              <td>{l.bankName}</td>
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
                      value={repayAmounts[l.id] ?? Math.floor(l.outstandingBalance / 4)}
                      onChange={(e) => setRepayAmounts({ ...repayAmounts, [l.id]: Number(e.target.value) })}
                      style={{ width: 70 }}
                    />
                    <button
                      className="btn"
                      disabled={repay.isPending}
                      onClick={() => repay.mutate({ loanId: l.id, amount: repayAmounts[l.id] ?? Math.floor(l.outstandingBalance / 4) })}
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

function MakeDepositForm() {
  const queryClient = useQueryClient();
  const { data: banks } = useBanks();
  const { data: gameState } = useGameState();
  const [bankId, setBankId] = useState("");
  const [amount, setAmount] = useState(100);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const makeDeposit = useMutation({
    mutationFn: () => api.requestDeposit(bankId, amount),
    onSuccess: () => {
      setError(null);
      setMessage(`Deposited ${amount}g.`);
      invalidateBanking(queryClient);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Deposit failed"),
  });

  const bankOptions = banks?.banks ?? [];
  const selectedBank = bankOptions.find((b) => b.id === bankId);
  const gold = gameState?.settlement.gold ?? 0;
  const canAfford = amount > 0 && amount <= gold;

  return (
    <div className="panel">
      <div className="panel__title">Make a Deposit</div>
      {error && <div className="auth-error">{error}</div>}
      {message && !error && <div className="suggestion">{message}</div>}
      <div className="trade-row" style={{ flexWrap: "wrap", marginTop: 0 }}>
        <select value={bankId} onChange={(e) => setBankId(e.target.value)}>
          <option value="">Bank...</option>
          {bankOptions.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} ({(b.interestRatePerHour * DEPOSIT_TUNING.rateFraction * 100).toFixed(2)}%/hr deposit rate)
            </option>
          ))}
        </select>
        <input type="number" min={1} value={amount} onChange={(e) => setAmount(Math.max(1, Number(e.target.value)))} />
        <button
          className="btn btn--accent"
          disabled={!bankId || !canAfford || makeDeposit.isPending}
          onClick={() => makeDeposit.mutate()}
        >
          Deposit
        </button>
      </div>
      <p className="suggestion" style={{ marginTop: 8 }}>
        Settlement gold parked at a bank earns interest — a fraction of what the bank charges borrowers, since the
        spread is the bank's margin.{selectedBank && ` This deposit stays at ${(selectedBank.interestRatePerHour * DEPOSIT_TUNING.rateFraction * 100).toFixed(2)}%/hr for its lifetime.`} Withdrawals are
        capped by the bank's current liquid cash — a bank that's lent heavily against its deposits may not be able to
        pay out everything at once.
      </p>
    </div>
  );
}

function MyDepositsList() {
  const queryClient = useQueryClient();
  const { data: deposits } = useMyDeposits();
  const [withdrawAmounts, setWithdrawAmounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  const withdraw = useMutation({
    mutationFn: ({ depositId, amount }: { depositId: string; amount: number }) => api.withdrawDeposit(depositId, amount),
    onSuccess: () => {
      setError(null);
      invalidateBanking(queryClient);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Withdrawal failed"),
  });

  if (!deposits || deposits.deposits.length === 0) {
    return (
      <div className="panel">
        <div className="panel__title">My Deposits</div>
        <div className="empty-state">No deposits yet.</div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel__title">My Deposits — {deposits.deposits.length} bank{deposits.deposits.length === 1 ? "" : "s"}</div>
      {error && <div className="auth-error">{error}</div>}
      <table className="settlement-table">
        <thead>
          <tr>
            <th>Bank</th>
            <th>Balance</th>
            <th>Rate/hr</th>
            <th>Withdraw</th>
          </tr>
        </thead>
        <tbody>
          {deposits.deposits.map((d) => (
            <tr key={d.id}>
              <td>{d.bankName}</td>
              <td>{d.amount.toFixed(1)}g</td>
              <td>{(d.interestRatePerHour * 100).toFixed(2)}%</td>
              <td>
                <div style={{ display: "flex", gap: 4 }}>
                  <input
                    type="number"
                    min={1}
                    value={withdrawAmounts[d.id] ?? Math.floor(d.amount)}
                    onChange={(e) => setWithdrawAmounts({ ...withdrawAmounts, [d.id]: Number(e.target.value) })}
                    style={{ width: 70 }}
                  />
                  <button
                    className="btn"
                    disabled={withdraw.isPending}
                    onClick={() => withdraw.mutate({ depositId: d.id, amount: withdrawAmounts[d.id] ?? Math.floor(d.amount) })}
                  >
                    Pay out
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BuyBondForm() {
  const queryClient = useQueryClient();
  const { data: governments } = useBondGovernments();
  const { data: gameState } = useGameState();
  const [governmentId, setGovernmentId] = useState("");
  const [amount, setAmount] = useState(100);
  const [termHours, setTermHours] = useState(BOND_TERM_OPTIONS[0].hours);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const buyBond = useMutation({
    mutationFn: () => api.buyBond(governmentId, amount, termHours),
    onSuccess: (res) => {
      setError(null);
      setMessage(`Bought a ${amount}g bond at ${(res.interestRatePerHour * 100).toFixed(2)}%/hr, matures ${new Date(res.maturesAt).toLocaleDateString()}.`);
      invalidateBanking(queryClient);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Bond purchase failed"),
  });

  const govOptions = governments?.governments ?? [];
  const gold = gameState?.settlement.gold ?? 0;
  const canAfford = amount > 0 && amount <= gold;
  const termOption = BOND_TERM_OPTIONS.find((t) => t.hours === termHours);
  const rate = computeBondRate(termHours);

  if (govOptions.length === 0) {
    return (
      <div className="panel">
        <div className="panel__title">Buy a Government Bond</div>
        <div className="empty-state">No other nations to buy bonds from yet.</div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel__title">Buy a Government Bond</div>
      {error && <div className="auth-error">{error}</div>}
      {message && !error && <div className="suggestion">{message}</div>}
      <div className="trade-row" style={{ flexWrap: "wrap", marginTop: 0 }}>
        <select value={governmentId} onChange={(e) => setGovernmentId(e.target.value)}>
          <option value="">Nation...</option>
          {govOptions.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} ({Math.floor(g.treasury)}g treasury)
            </option>
          ))}
        </select>
        <select value={termHours} onChange={(e) => setTermHours(Number(e.target.value))}>
          {BOND_TERM_OPTIONS.map((t) => (
            <option key={t.hours} value={t.hours}>
              {t.label} ({(computeBondRate(t.hours) * 100).toFixed(2)}%/hr)
            </option>
          ))}
        </select>
        <input type="number" min={1} value={amount} onChange={(e) => setAmount(Math.max(1, Number(e.target.value)))} />
        <button
          className="btn btn--accent"
          disabled={!governmentId || !canAfford || buyBond.isPending}
          onClick={() => buyBond.mutate()}
        >
          Buy Bond
        </button>
      </div>
      <p className="suggestion" style={{ marginTop: 8 }}>
        A fixed-term, fixed-rate loan to another player's government — {termOption?.label.toLowerCase()} locks in{" "}
        {(rate * 100).toFixed(2)}%/hr, paid out once in full at maturity rather than compounding like a bank deposit.
        Longer terms pay a better rate for locking capital up longer. Redemption is capped by that government's
        treasury at maturity — a nation that spends beyond its means may not be able to redeem in full.
      </p>
    </div>
  );
}

function MyBondsList() {
  const { data: bonds } = useMyBonds();

  if (!bonds || bonds.bonds.length === 0) {
    return (
      <div className="panel">
        <div className="panel__title">My Bonds</div>
        <div className="empty-state">No bonds yet.</div>
      </div>
    );
  }

  const active = bonds.bonds.filter((b) => !b.redeemedAt);

  return (
    <div className="panel">
      <div className="panel__title">
        My Bonds — {active.length} active, {active.reduce((sum, b) => sum + b.principal, 0).toFixed(0)}g outstanding
      </div>
      <table className="settlement-table">
        <thead>
          <tr>
            <th>Nation</th>
            <th>Principal</th>
            <th>Rate/hr</th>
            <th>Redemption value</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {bonds.bonds.map((b) => (
            <tr key={b.id}>
              <td>{b.governmentName}</td>
              <td>{b.principal.toFixed(0)}g</td>
              <td>{(b.interestRatePerHour * 100).toFixed(2)}%</td>
              <td>{b.redemptionValue.toFixed(1)}g</td>
              <td>{b.redeemedAt ? "Redeemed" : `Matures ${new Date(b.maturesAt).toLocaleDateString()}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BuyCorporateBondForm() {
  const queryClient = useQueryClient();
  const { data: companies } = useCorporateBondCompanies();
  const { data: gameState } = useGameState();
  const [companyId, setCompanyId] = useState("");
  const [amount, setAmount] = useState(100);
  const [termHours, setTermHours] = useState(BOND_TERM_OPTIONS[0].hours);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const buyBond = useMutation({
    mutationFn: () => api.buyCorporateBond(companyId, amount, termHours),
    onSuccess: (res) => {
      setError(null);
      setMessage(`Bought a ${amount}g corporate bond at ${(res.interestRatePerHour * 100).toFixed(2)}%/hr, matures ${new Date(res.maturesAt).toLocaleDateString()}.`);
      invalidateBanking(queryClient);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Bond purchase failed"),
  });

  const companyOptions = companies?.companies ?? [];
  const gold = gameState?.settlement.gold ?? 0;
  const canAfford = amount > 0 && amount <= gold;
  const selectedCompany = companyOptions.find((c) => c.id === companyId);
  const exceedsCapacity = selectedCompany ? amount > selectedCompany.maxIssuance : false;
  const rate = selectedCompany ? computeCorporateBondRate(termHours, amount, selectedCompany.cash) : null;

  if (companyOptions.length === 0) {
    return (
      <div className="panel">
        <div className="panel__title">Buy a Corporate Bond</div>
        <div className="empty-state">No companies you don't already control to buy bonds from yet.</div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel__title">Buy a Corporate Bond</div>
      {error && <div className="auth-error">{error}</div>}
      {message && !error && <div className="suggestion">{message}</div>}
      <div className="trade-row" style={{ flexWrap: "wrap", marginTop: 0 }}>
        <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
          <option value="">Company...</option>
          {companyOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({Math.floor(c.cash)}g cash, up to {c.maxIssuance.toFixed(0)}g)
            </option>
          ))}
        </select>
        <select value={termHours} onChange={(e) => setTermHours(Number(e.target.value))}>
          {BOND_TERM_OPTIONS.map((t) => (
            <option key={t.hours} value={t.hours}>
              {t.label}
            </option>
          ))}
        </select>
        <input type="number" min={1} value={amount} onChange={(e) => setAmount(Math.max(1, Number(e.target.value)))} />
        <button
          className="btn btn--accent"
          disabled={!companyId || !canAfford || exceedsCapacity || buyBond.isPending}
          onClick={() => buyBond.mutate()}
        >
          Buy Bond
        </button>
      </div>
      {rate !== null && (
        <p className="suggestion" style={{ marginTop: 8 }}>
          Quoted rate for this amount: <b>{(rate * 100).toFixed(2)}%/hr</b> — a company is a riskier borrower than a
          government (it can close before maturity), so the rate climbs the closer this gets to the company's{" "}
          {selectedCompany!.maxIssuance.toFixed(0)}g credit limit.{" "}
          {exceedsCapacity && "This amount exceeds the credit limit and will be rejected."}
        </p>
      )}
      <p className="suggestion" style={{ marginTop: 8 }}>
        A company financing itself with debt instead of a bank loan — paid out once in full at maturity like a
        government bond. If the company closes before maturity (voluntarily or forced), bondholders are paid first
        from whatever cash remains, ahead of anything the founder recovers — split pro-rata if several bonds are
        outstanding and there isn't enough to cover everyone.
      </p>
    </div>
  );
}

function MyCorporateBondsList() {
  const { data: bonds } = useMyCorporateBonds();

  if (!bonds || bonds.bonds.length === 0) {
    return (
      <div className="panel">
        <div className="panel__title">My Corporate Bonds</div>
        <div className="empty-state">No corporate bonds yet.</div>
      </div>
    );
  }

  const active = bonds.bonds.filter((b) => !b.redeemedAt);

  return (
    <div className="panel">
      <div className="panel__title">
        My Corporate Bonds — {active.length} active, {active.reduce((sum, b) => sum + b.principal, 0).toFixed(0)}g outstanding
      </div>
      <table className="settlement-table">
        <thead>
          <tr>
            <th>Company</th>
            <th>Principal</th>
            <th>Rate/hr</th>
            <th>Redemption value</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {bonds.bonds.map((b) => (
            <tr key={b.id} className={b.companyClosed && !b.redeemedAt ? "attention-row" : ""}>
              <td>{b.companyName}</td>
              <td>{b.principal.toFixed(0)}g</td>
              <td>{(b.interestRatePerHour * 100).toFixed(2)}%</td>
              <td>{b.redemptionValue.toFixed(1)}g</td>
              <td>{b.redeemedAt ? "Redeemed" : `Matures ${new Date(b.maturesAt).toLocaleDateString()}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MyBanksSection() {
  const { data: myBanks } = useMyBanks();

  if (!myBanks || myBanks.banks.length === 0) return null;

  const summary = {
    count: myBanks.banks.length,
    totalCash: myBanks.banks.reduce((sum, b) => sum + b.cash, 0),
    totalDeposits: myBanks.banks.reduce((sum, b) => sum + b.depositsHeld.reduce((s, d) => s + d.amount, 0), 0),
    illiquid: myBanks.banks.filter((b) => {
      const depositTotal = b.depositsHeld.reduce((s, d) => s + d.amount, 0);
      return depositTotal > 0 && b.cash < depositTotal * 0.2;
    }).length,
  };

  return (
    <div className="card">
      <h2 className="card__title">My Banks</h2>
      <div className="summary-bar">
        <div className="summary-stat">
          <div className="summary-stat__label">Banks</div>
          <div className="summary-stat__value">{summary.count}</div>
        </div>
        <div className="summary-stat">
          <div className="summary-stat__label">Combined reserve cash</div>
          <div className="summary-stat__value">{summary.totalCash.toFixed(0)}g</div>
        </div>
        <div className="summary-stat">
          <div className="summary-stat__label">Deposits owed</div>
          <div className="summary-stat__value">{summary.totalDeposits.toFixed(0)}g</div>
        </div>
        <div className="summary-stat">
          <div className="summary-stat__label">Low liquidity</div>
          <div className={`summary-stat__value${summary.illiquid > 0 ? " attention" : ""}`}>{summary.illiquid}</div>
        </div>
      </div>
      <div className="company-grid">
        {myBanks.banks.map((b) => {
          const depositTotal = b.depositsHeld.reduce((s, d) => s + d.amount, 0);
          const lowLiquidity = depositTotal > 0 && b.cash < depositTotal * 0.2;
          return (
          <div className={`company-card${lowLiquidity ? " company-card--attention" : ""}`} key={b.id}>
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
              <div>
                <div className="delta-cell__label">Deposits held</div>
                <div className="delta-cell__value">{b.depositsHeld.length}</div>
              </div>
            </div>
            {lowLiquidity && (
              <p className="suggestion" style={{ color: "var(--critical)", paddingTop: 0 }}>
                Reserve cash covers less than 20% of deposits owed — a withdrawal could be turned away.
              </p>
            )}
            {b.loansIssued.length > 0 && (
              <>
                <div className="card-section-label">Loans issued</div>
                <div className="scroll-table">
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
                </div>
              </>
            )}
            {b.depositsHeld.length > 0 && (
              <>
                <div className="card-section-label">Deposits held</div>
                <div className="scroll-table">
                <table className="settlement-table">
                  <thead>
                    <tr>
                      <th>Depositor</th>
                      <th>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.depositsHeld.map((d) => (
                      <tr key={d.id}>
                        <td>{d.depositorName}</td>
                        <td>{d.amount.toFixed(1)}g</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Banking() {
  const { data: myLoans } = useMyLoans();
  const { data: myDeposits } = useMyDeposits();
  const { data: myBonds } = useMyBonds();
  const { data: myCorporateBonds } = useMyCorporateBonds();
  const { data: banks } = useBanks();
  const [activeTab, setActiveTab] = useState<BankingTab>("loans");
  const [bondSubTab, setBondSubTab] = useState<BondSubTab>("government");
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

  const totalBorrowed = (myLoans?.loans ?? []).reduce((sum, l) => sum + (l.defaultedAt ? 0 : l.outstandingBalance), 0);
  const totalDeposited = (myDeposits?.deposits ?? []).reduce((sum, d) => sum + d.amount, 0);
  const activeBonds = (myBonds?.bonds ?? []).filter((b) => !b.redeemedAt);
  const activeCorporateBonds = (myCorporateBonds?.bonds ?? []).filter((b) => !b.redeemedAt);
  const totalBondsHeld = activeBonds.reduce((sum, b) => sum + b.principal, 0) + activeCorporateBonds.reduce((sum, b) => sum + b.principal, 0);
  const netPosition = totalDeposited + totalBondsHeld - totalBorrowed;

  const bondCount = activeBonds.length + activeCorporateBonds.length;

  return (
    <div className="page page--full">
      <div className="summary-bar">
        <div className="summary-stat">
          <div className="summary-stat__label">Deposited</div>
          <div className="summary-stat__value">{totalDeposited.toFixed(0)}g</div>
        </div>
        <div className="summary-stat">
          <div className="summary-stat__label">Borrowed</div>
          <div className={`summary-stat__value${totalBorrowed > 0 ? " attention" : ""}`}>{totalBorrowed.toFixed(0)}g</div>
        </div>
        <div className="summary-stat">
          <div className="summary-stat__label">Bonds held</div>
          <div className="summary-stat__value">{totalBondsHeld.toFixed(0)}g</div>
        </div>
        <div className="summary-stat">
          <div className="summary-stat__label">Net position</div>
          <div className="summary-stat__value">{netPosition >= 0 ? "+" : ""}{netPosition.toFixed(0)}g</div>
        </div>
      </div>

      <MyBanksSection />

      <div className="page-tabs">
        <button
          className={`page-tab${activeTab === "loans" ? " page-tab--active" : ""}`}
          onClick={() => setActiveTab("loans")}
        >
          <LayersIcon className="icon" />
          Loans
        </button>
        <button
          className={`page-tab${activeTab === "deposits" ? " page-tab--active" : ""}`}
          onClick={() => setActiveTab("deposits")}
        >
          <PlusCircleIcon className="icon" />
          Deposits
        </button>
        <button
          className={`page-tab${activeTab === "bonds" ? " page-tab--active" : ""}`}
          onClick={() => setActiveTab("bonds")}
        >
          <ScrollIcon className="icon" />
          Bonds
          {bondCount > 0 && <span className="page-tab__badge">{bondCount}</span>}
        </button>
        <button
          className={`page-tab${activeTab === "world" ? " page-tab--active" : ""}`}
          onClick={() => setActiveTab("world")}
        >
          <GlobeIcon className="icon" />
          Banks of the World
        </button>
      </div>

      <div className="page-panel">
        {activeTab === "loans" && (
          <div className="split">
            <RequestLoanForm />
            <MyLoansList />
          </div>
        )}

        {activeTab === "deposits" && (
          <div className="split">
            <MakeDepositForm />
            <MyDepositsList />
          </div>
        )}

        {activeTab === "bonds" && (
          <>
            <div className="cc-tabs" style={{ marginBottom: 16 }}>
              <button
                className={`cc-tab${bondSubTab === "government" ? " cc-tab--active" : ""}`}
                onClick={() => setBondSubTab("government")}
              >
                Government {activeBonds.length > 0 && `(${activeBonds.length})`}
              </button>
              <button
                className={`cc-tab${bondSubTab === "corporate" ? " cc-tab--active" : ""}`}
                onClick={() => setBondSubTab("corporate")}
              >
                Corporate {activeCorporateBonds.length > 0 && `(${activeCorporateBonds.length})`}
              </button>
            </div>
            {bondSubTab === "government" ? (
              <div className="split">
                <BuyBondForm />
                <MyBondsList />
              </div>
            ) : (
              <div className="split">
                <BuyCorporateBondForm />
                <MyCorporateBondsList />
              </div>
            )}
          </>
        )}

        {activeTab === "world" && (
          <>
          <FoundBankForm />
          <div className="panel" style={{ margin: 0 }}>
            <div className="panel__title">Banks of the World</div>
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
          </>
        )}
      </div>
    </div>
  );
}
