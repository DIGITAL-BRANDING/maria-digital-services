import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, Check, Loader2 } from 'lucide-react';
import AppShell from '../components/AppShell';
import { api, ApiError } from '../lib/api';

type Dynamic = { account_number: string; account_name: string; bank_name: string; reference: string; expires_at?: string };

const QUICK_AMOUNTS = [500, 1000, 2000, 5000, 10000];

export default function FundWalletPage() {
  const nav = useNavigate();
  const [method, setMethod] = useState<'static' | 'dynamic' | 'card' | 'coupon'>('static');
  const [amount, setAmount] = useState('');
  const [dynamic, setDynamic] = useState<Dynamic | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [funded, setFunded] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const pollCount = useRef(0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage('');
    setBusy(true);
    try {
      if (method === 'dynamic') {
        const r = await api.post<{ data: Dynamic; message: string }>('/wallet/fund/dynamic', { amount: Number(amount) });
        setDynamic(r.data);
        setMessage(r.message);
      } else if (method === 'card') {
        const r = await api.post<{ data: { authorization_url: string } }>('/wallet/fund', {
          amount: Number(amount),
          payment_method: 'card',
        });
        window.location.href = r.data.authorization_url;
      } else if (method === 'coupon') {
        const r = await api.post<{ status: boolean; message: string; data: { balance: number } }>('/wallet/coupon/redeem', {
          code: couponCode,
        });
        setMessage(r.message || `Redeemed! New balance ₦${r.data.balance.toLocaleString()}.`);
        setFunded(true);
      }
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Unable to start funding');
    } finally {
      setBusy(false);
    }
  }

  async function checkDynamicStatus(silent = false) {
    if (!dynamic) return;
    try {
      const r = await api.post<{ status: boolean }>('/wallet/fund/verify', { reference: dynamic.reference });
      if (r.status) setFunded(true);
    } catch {
      // still pending - the webhook is the primary path, this is just a manual/auto nudge
      if (!silent) setMessage('Not received yet - we\u2019ll keep checking automatically.');
    }
  }

  useEffect(() => {
    if (!dynamic || funded) return;
    const id = setInterval(() => {
      pollCount.current += 1;
      if (pollCount.current > 24) return clearInterval(id);
      void checkDynamicStatus(true);
    }, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dynamic, funded]);

  function copyAccount() {
    if (!dynamic) return;
    navigator.clipboard.writeText(dynamic.account_number);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <AppShell>
      <button onClick={() => nav('/dashboard')} className="text-sm text-gold-700">
        ← Dashboard
      </button>
      <main className="mx-auto mt-5 max-w-xl rounded-2xl border border-parchment-line bg-parchment p-6">
        <h1 className="font-display text-2xl font-bold text-ink">Fund wallet</h1>
        <p className="mt-1 text-sm text-ink-600">Choose how you want to add money.</p>

        <div className="mt-5 grid grid-cols-4 gap-2">
          {(['static', 'dynamic', 'card', 'coupon'] as const).map((x) => (
            <button
              key={x}
              onClick={() => {
                setMethod(x);
                setDynamic(null);
                setFunded(false);
                setMessage('');
              }}
              className={
                'rounded-xl border p-3 text-xs font-semibold sm:text-sm ' +
                (method === x ? 'border-gold-500 bg-gold-50 text-gold-700' : 'border-parchment-line text-ink-600')
              }
            >
              {x === 'static' ? 'My account' : x === 'dynamic' ? 'Exact transfer' : x === 'card' ? 'Card' : 'Coupon'}
            </button>
          ))}
        </div>

        {method === 'static' && (
          <p className="mt-6 rounded-xl bg-cream p-4 text-sm text-ink-600">
            Your dedicated account number is shown on your dashboard. Transfer any amount there and your wallet is
            credited automatically.
          </p>
        )}

        {method === 'coupon' && !funded && (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <input
              required
              minLength={4}
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
              placeholder="Coupon code"
              className="w-full rounded-xl border border-parchment-line bg-cream p-3 font-mono text-ink outline-none focus:border-gold-500"
            />
            <button
              disabled={busy || couponCode.length < 4}
              className="flex w-full items-center justify-center rounded-xl bg-gold-500 py-3 font-semibold text-ink disabled:opacity-60"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : 'Redeem'}
            </button>
          </form>
        )}

        {(method === 'dynamic' || method === 'card') && !dynamic && (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div className="flex flex-wrap gap-2">
              {QUICK_AMOUNTS.map((a) => (
                <button
                  type="button"
                  key={a}
                  onClick={() => setAmount(String(a))}
                  className={
                    'rounded-full border px-3 py-1 font-mono text-xs ' +
                    (amount === String(a) ? 'border-gold-500 bg-gold-50 text-gold-700' : 'border-parchment-line text-ink-600')
                  }
                >
                  ₦{a.toLocaleString()}
                </button>
              ))}
            </div>
            <input
              required
              type="number"
              min="100"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount in Naira"
              className="w-full rounded-xl border border-parchment-line bg-cream p-3 font-mono text-ink outline-none focus:border-gold-500"
            />
            <button
              disabled={busy || !amount}
              className="flex w-full items-center justify-center rounded-xl bg-gold-500 py-3 font-semibold text-ink disabled:opacity-60"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : 'Continue'}
            </button>
          </form>
        )}

        {dynamic && !funded && (
          <div className="mt-5 rounded-xl bg-ink p-5">
            <p className="font-mono text-xs uppercase tracking-widest text-gold-500/70">Transfer exactly</p>
            <p className="mt-1 font-display text-2xl font-bold text-cream">₦{Number(amount).toLocaleString()}</p>
            <div className="mt-4 rounded-lg border border-ink-line bg-ink-soft px-4 py-3">
              <p className="font-mono text-[11px] text-cream/50">{dynamic.bank_name}</p>
              <div className="mt-0.5 flex items-center justify-between">
                <span className="font-mono text-lg font-semibold text-cream">{dynamic.account_number}</span>
                <button
                  onClick={copyAccount}
                  className="flex items-center gap-1.5 rounded-md bg-gold-500 px-3 py-1.5 text-xs font-semibold text-ink"
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="mt-1 font-mono text-[11px] text-cream/50">{dynamic.account_name}</p>
            </div>
            <p className="mt-2 text-xs text-cream/40">Reference: {dynamic.reference}</p>
            <button
              onClick={() => checkDynamicStatus(false)}
              className="mt-4 flex w-full items-center justify-center rounded-lg bg-gold-500 py-2.5 text-sm font-semibold text-ink"
            >
              I've made the transfer
            </button>
            <p className="mt-2 text-center text-[11px] text-cream/40">We're also checking automatically every few seconds.</p>
          </div>
        )}

        {funded && (
          <div className="mt-6 flex flex-col items-center gap-2 rounded-xl border border-success-500/30 bg-success-500/5 py-8 text-center">
            <Check size={32} className="text-success-500" />
            <p className="font-display text-lg font-bold text-ink">Wallet funded!</p>
            <button
              onClick={() => {
                setDynamic(null);
                setFunded(false);
                setAmount('');
                setCouponCode('');
                setMessage('');
              }}
              className="mt-2 rounded-lg bg-gold-500 px-5 py-2 text-sm font-semibold text-ink"
            >
              Fund again
            </button>
          </div>
        )}

        {message && !funded && <p className="mt-4 text-sm text-ink-600">{message}</p>}
      </main>
    </AppShell>
  );
}
