import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownCircle, ArrowUpCircle, Landmark, Loader2, Plus, RotateCcw, Wallet, WalletCards } from 'lucide-react';
import AppShell from '../components/AppShell';
import { api } from '../lib/api';

type Balance = {
  balance: number;
  currency: string;
  virtual_account_number: string | null;
  virtual_account_bank: string | null;
  virtual_account_funding_paused?: boolean;
};

type Transaction = {
  id: string;
  reference: string;
  type: string;
  status: string;
  /** Decided by the server: 'credit' adds money to the wallet (funding, refund, coupon...), 'debit' takes it out. */
  direction: 'credit' | 'debit';
  amount: number;
  balance_before: number;
  balance_after: number;
  /** false when the row never touched the wallet (e.g. a funding attempt still pending). */
  balance_changed: boolean;
  description: string;
  created_at: string;
};

type Summary = { total_funded: number; total_spent: number; total_refunded: number };

// This page deliberately does NOT use the legacy `bg-parchment` / `bg-cream`
// classes. index.css force-recolors everything inside those to white text
// (`main .bg-parchment * { color: #f8fbff }`), which turned every status badge
// into white-on-pastel and made it unreadable. Here every surface and every
// text color is explicit, so what you read in the code is what renders.
const STATUS_CLASS: Record<string, string> = {
  success: 'bg-emerald-100 text-emerald-900',
  pending: 'bg-amber-100 text-amber-900',
  failed: 'bg-rose-100 text-rose-900',
  reversed: 'bg-slate-200 text-slate-900',
};

const STATUS_LABEL: Record<string, string> = {
  success: 'Success',
  pending: 'Pending',
  failed: 'Failed',
  reversed: 'Reversed',
};

function money(amount: number) {
  return `₦${amount.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function friendlyType(type: string) {
  return type
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export default function WalletSummaryPage() {
  const [balance, setBalance] = useState<Balance | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    return Promise.all([
      api.get<Balance>('/wallet/balance'),
      api.get<{ status: boolean; data: Transaction[] }>('/transactions'),
      // Totals are computed by the server over the whole history. If that endpoint
      // is unavailable the page still works and falls back to the loaded rows.
      api.get<{ status: boolean; data: Summary }>('/transactions/summary').catch(() => null),
    ])
      .then(([b, tx, sum]) => {
        setBalance(b);
        setTransactions(tx.data ?? []);
        setSummary(sum?.data ?? null);
        setError('');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Unable to load your wallet summary.'));
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
    // Balance can change while this tab sits in the background (a refund landing,
    // a webhook crediting a deposit) - refresh when the user comes back to it so
    // the page never shows a stale balance next to a fresh notification.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const fallbackFunded = transactions
    .filter((t) => t.type === 'wallet_funding' && t.status === 'success')
    .reduce((sum, t) => sum + t.amount, 0);
  const fallbackSpent = transactions
    .filter((t) => t.direction === 'debit' && t.status === 'success')
    .reduce((sum, t) => sum + t.amount, 0);
  const fallbackRefunded = transactions
    .filter((t) => t.type === 'refund' && t.status === 'success')
    .reduce((sum, t) => sum + t.amount, 0);

  const totalFunded = summary?.total_funded ?? fallbackFunded;
  const totalSpent = summary?.total_spent ?? fallbackSpent;
  const totalRefunded = summary?.total_refunded ?? fallbackRefunded;

  return (
    <AppShell>
      <div className="max-w-3xl">
        <header className="surface-navy rounded-2xl p-6 shadow-xl">
          <p className="text-sm font-semibold text-gold-300">Account resources</p>
          <h1 className="mt-1 text-3xl font-bold text-white">Wallet Summary</h1>
          <p className="mt-2 text-sm text-blue-100">Your balance, funding, spend and full transaction history in one place.</p>
        </header>

        {loading ? (
          <div className="flex justify-center py-14">
            <Loader2 className="animate-spin text-gold-500" />
          </div>
        ) : error ? (
          <p className="mt-6 rounded-xl bg-rose-100 p-4 text-sm font-medium text-rose-900">{error}</p>
        ) : (
          <>
            <section className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="surface-navy rounded-2xl p-4">
                <div className="flex items-center gap-2 text-blue-100"><Wallet size={15} /><p className="text-xs">Current balance</p></div>
                <p className="mt-1 font-display text-xl font-bold text-white">{money(balance?.balance ?? 0)}</p>
              </div>
              <div className="surface-navy rounded-2xl p-4">
                <div className="flex items-center gap-2 text-blue-100"><ArrowDownCircle size={15} /><p className="text-xs">Total funded</p></div>
                <p className="mt-1 font-display text-xl font-bold text-emerald-300">{money(totalFunded)}</p>
              </div>
              <div className="surface-navy rounded-2xl p-4">
                <div className="flex items-center gap-2 text-blue-100"><ArrowUpCircle size={15} /><p className="text-xs">Total spent</p></div>
                <p className="mt-1 font-display text-xl font-bold text-white">{money(totalSpent)}</p>
                {totalRefunded > 0 && (
                  <p className="mt-1 text-[11px] text-blue-100">Refunds returned to you: {money(totalRefunded)}</p>
                )}
              </div>
            </section>

            <section className="mt-4 flex flex-wrap items-center justify-between gap-3">
              {balance?.virtual_account_number ? (
                <div className="surface-navy flex flex-1 items-center gap-3 rounded-2xl p-4">
                  <Landmark className="text-gold-300" size={20} />
                  <div>
                    <p className="text-xs text-blue-100">Your virtual funding account</p>
                    <p className="font-display font-bold text-white">{balance.virtual_account_number} · {balance.virtual_account_bank}</p>
                  </div>
                </div>
              ) : (
                <span />
              )}
              <Link to="/fund-wallet" className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700">
                <Plus size={15} /> Fund wallet
              </Link>
            </section>

            <section className="mt-6">
              <h2 className="font-display font-bold text-slate-900">Recent transactions</h2>
              {!transactions.length ? (
                <div className="surface-navy mt-3 rounded-2xl p-10 text-center text-blue-100">
                  <WalletCards className="mx-auto mb-3 text-gold-300" />
                  <p>No wallet activity yet.</p>
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  {transactions.map((t) => {
                    const isCredit = t.direction === 'credit';
                    const isRefund = t.type === 'refund';
                    return (
                      <Link
                        key={t.id}
                        to={`/receipt/${t.id}`}
                        className="surface-navy block rounded-xl px-4 py-3 hover:border-gold-400"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <p className="flex items-center gap-1.5 text-sm font-semibold text-white">
                              {isRefund && <RotateCcw size={13} className="shrink-0 text-emerald-300" aria-hidden />}
                              <span className="truncate">{t.description || friendlyType(t.type)}</span>
                            </p>
                            <p className="mt-0.5 text-xs text-blue-100">{new Date(t.created_at).toLocaleString()}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className={`font-display text-sm font-bold ${isCredit ? 'text-emerald-300' : 'text-white'}`}>
                              {isCredit ? '+' : '-'}
                              {money(t.amount)}
                            </p>
                            <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_CLASS[t.status] ?? 'bg-slate-200 text-slate-900'}`}>
                              {STATUS_LABEL[t.status] ?? friendlyType(t.status)}
                            </span>
                          </div>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-blue-300/30 pt-2 text-xs">
                          {t.balance_changed ? (
                            <>
                              <p className="text-blue-100">
                                Balance before: <span className="font-semibold text-white">{money(t.balance_before)}</span>
                              </p>
                              <p className="text-blue-100">
                                Balance after: <span className="font-semibold text-white">{money(t.balance_after)}</span>
                              </p>
                            </>
                          ) : (
                            <p className="text-blue-100">No change to your wallet balance</p>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
