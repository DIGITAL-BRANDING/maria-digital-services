import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownCircle, ArrowUpCircle, Landmark, Loader2, Plus, Wallet, WalletCards } from 'lucide-react';
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
  amount: number;
  balance_after: number;
  description: string;
  created_at: string;
};

const CREDIT_TYPES = new Set(['wallet_funding', 'referral_commission', 'coupon_redemption', 'manual_adjustment']);

const STATUS_CLASS: Record<string, string> = {
  success: 'bg-emerald-100 text-emerald-700',
  pending: 'bg-amber-100 text-amber-700',
  failed: 'bg-rose-100 text-rose-700',
  reversed: 'bg-slate-200 text-slate-600',
};

function money(amount: number) {
  return `₦${amount.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api.get<Balance>('/wallet/balance'),
      api.get<{ status: boolean; data: Transaction[] }>('/transactions'),
    ])
      .then(([b, tx]) => {
        setBalance(b);
        setTransactions(tx.data ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Unable to load your wallet summary.'))
      .finally(() => setLoading(false));
  }, []);

  const totalFunded = transactions.filter((t) => t.type === 'wallet_funding' && t.status === 'success').reduce((sum, t) => sum + t.amount, 0);
  const totalSpent = transactions.filter((t) => !CREDIT_TYPES.has(t.type) && t.status === 'success').reduce((sum, t) => sum + t.amount, 0);

  return (
    <AppShell>
      <div className="max-w-3xl">
        <header className="rounded-2xl border border-gold-500/40 bg-ink p-6 text-cream shadow-xl">
          <p className="text-sm font-semibold text-gold-300">Account resources</p>
          <h1 className="mt-1 text-3xl font-bold">Wallet Summary</h1>
          <p className="mt-2 text-sm text-cream/70">Your balance, funding, spend and full transaction history in one place.</p>
        </header>

        {loading ? (
          <div className="flex justify-center py-14">
            <Loader2 className="animate-spin text-gold-500" />
          </div>
        ) : error ? (
          <p className="mt-6 rounded-xl bg-ember-500/10 p-4 text-sm text-ember-600">{error}</p>
        ) : (
          <>
            <section className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-parchment-line bg-parchment p-4">
                <div className="flex items-center gap-2 text-ink-600"><Wallet size={15} /><p className="text-xs">Current balance</p></div>
                <p className="mt-1 font-display text-xl font-bold text-ink">{money(balance?.balance ?? 0)}</p>
              </div>
              <div className="rounded-2xl border border-parchment-line bg-parchment p-4">
                <div className="flex items-center gap-2 text-ink-600"><ArrowDownCircle size={15} /><p className="text-xs">Total funded</p></div>
                <p className="mt-1 font-display text-xl font-bold text-emerald-600">{money(totalFunded)}</p>
              </div>
              <div className="rounded-2xl border border-parchment-line bg-parchment p-4">
                <div className="flex items-center gap-2 text-ink-600"><ArrowUpCircle size={15} /><p className="text-xs">Total spent</p></div>
                <p className="mt-1 font-display text-xl font-bold text-ink">{money(totalSpent)}</p>
              </div>
            </section>

            {balance?.virtual_account_number && (
              <section className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-parchment-line bg-parchment p-4">
                <div className="flex items-center gap-3">
                  <Landmark className="text-gold-600" size={20} />
                  <div>
                    <p className="text-xs text-ink-600">Your virtual funding account</p>
                    <p className="font-display font-bold text-ink">{balance.virtual_account_number} · {balance.virtual_account_bank}</p>
                  </div>
                </div>
                <Link to="/fund-wallet" className="flex items-center gap-2 rounded-lg bg-gold-500 px-4 py-2 text-sm font-bold text-ink hover:bg-gold-400">
                  <Plus size={15} /> Fund wallet
                </Link>
              </section>
            )}
            {!balance?.virtual_account_number && (
              <section className="mt-4 flex justify-end">
                <Link to="/fund-wallet" className="flex items-center gap-2 rounded-lg bg-gold-500 px-4 py-2 text-sm font-bold text-ink hover:bg-gold-400">
                  <Plus size={15} /> Fund wallet
                </Link>
              </section>
            )}

            <section className="mt-6">
              <h2 className="font-display font-bold text-ink">Recent transactions</h2>
              {!transactions.length ? (
                <div className="mt-3 rounded-2xl border border-parchment-line bg-parchment p-10 text-center text-ink-600">
                  <WalletCards className="mx-auto mb-3 text-gold-400" />
                  <p>No wallet activity yet.</p>
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  {transactions.map((t) => {
                    const isCredit = CREDIT_TYPES.has(t.type);
                    return (
                      <Link
                        key={t.id}
                        to={`/receipt/${t.id}`}
                        className="flex items-center justify-between gap-4 rounded-xl border border-parchment-line bg-parchment px-4 py-3 hover:border-gold-400"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-ink">{t.description || friendlyType(t.type)}</p>
                          <p className="mt-0.5 text-xs text-ink-600">{new Date(t.created_at).toLocaleString()}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className={`font-display text-sm font-bold ${isCredit ? 'text-emerald-600' : 'text-ink'}`}>
                            {isCredit ? '+' : '-'}
                            {money(t.amount)}
                          </p>
                          <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${STATUS_CLASS[t.status] ?? 'bg-slate-200 text-slate-600'}`}>
                            {t.status}
                          </span>
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
