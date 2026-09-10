import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, ReceiptText } from 'lucide-react';
import AppShell from '../components/AppShell';
import { api, ApiError } from '../lib/api';
import { findLatestTransactionId } from '../lib/receipt';
import { PinConfirmDialog } from '../components/PinConfirmDialog';

const NETWORKS = [
  { code: 'MTN', label: 'MTN', bg: 'bg-[#FFCC00]', text: 'text-ink' },
  { code: 'GLO', label: 'Glo', bg: 'bg-[#00A651]', text: 'text-white' },
  { code: 'AIRTEL', label: 'Airtel', bg: 'bg-[#ED1C24]', text: 'text-white' },
  { code: '9MOBILE', label: '9mobile', bg: 'bg-[#00A99D]', text: 'text-white' },
];

const QUICK_AMOUNTS = [100, 200, 500, 1000, 2000, 5000];

export default function BuyAirtimePage() {
  const navigate = useNavigate();
  const [network, setNetwork] = useState('MTN');
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [showPin, setShowPin] = useState(false);

  function handleSubmit(e: FormEvent) { e.preventDefault(); setShowPin(true); }
  async function purchase(pin: string) { setShowPin(false); setError(null); setIsSubmitting(true); try { const res = await api.post<{ status: boolean; message: string }>('/airtime/purchase', { network, phone, amount: Number(amount), pin }); if (res.status) { setSuccess(res.message || 'Airtime delivered successfully'); findLatestTransactionId().then(setReceiptId); } else setError(res.message || 'Purchase failed'); } catch (err) { setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.'); } finally { setIsSubmitting(false); } }

  if (success) {
    return (
      <AppShell>
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-parchment-line bg-parchment px-6 py-14 text-center">
          <CheckCircle2 size={44} className="text-success-500" />
          <h1 className="font-display text-xl font-bold text-ink">Airtime delivered</h1>
          <p className="max-w-xs font-body text-sm text-ink-600">{success}</p>
          <div className="mt-2 flex gap-3">
            {receiptId && (
              <Link
                to={`/receipt/${receiptId}`}
                className="flex items-center gap-1.5 rounded-lg border border-gold-500/50 px-5 py-2.5 font-body text-sm font-semibold text-gold-700 transition hover:bg-gold-50"
              >
                <ReceiptText size={15} /> View receipt
              </Link>
            )}
            <button
              onClick={() => {
                setSuccess(null);
                setReceiptId(null);
                setPhone('');
                setAmount('');
              }}
              className="rounded-lg bg-gold-500 px-5 py-2.5 font-display text-sm font-semibold text-ink transition hover:bg-gold-400"
            >
              Buy again
            </button>
            <button
              onClick={() => navigate('/dashboard')}
              className="rounded-lg border border-parchment-line px-5 py-2.5 font-body text-sm text-ink-600"
            >
              Back to dashboard
            </button>
          </div>
        </div>
      <PinConfirmDialog open={showPin} onClose={() => setShowPin(false)} onVerified={purchase} /></AppShell>
    );
  }

  return (
    <AppShell>
      <button
        onClick={() => navigate('/dashboard')}
        className="mb-4 flex items-center gap-1.5 font-body text-sm text-ink-600 hover:text-ink"
      >
        <ArrowLeft size={15} /> Back
      </button>
      <h1 className="font-display text-2xl font-bold text-ink">Buy Airtime</h1>

      <form onSubmit={handleSubmit} className="mt-6 max-w-md space-y-6">
        <div>
          <span className="mb-2 block font-body text-xs font-medium text-ink-600">Network</span>
          <div className="grid grid-cols-4 gap-2">
            {NETWORKS.map((n) => (
              <button
                key={n.code}
                type="button"
                onClick={() => setNetwork(n.code)}
                className={`flex flex-col items-center gap-1.5 rounded-xl border-2 py-3 transition ${
                  network === n.code ? 'border-gold-500' : 'border-transparent'
                }`}
              >
                <span className={`flex h-9 w-9 items-center justify-center rounded-full font-display text-[10px] font-bold ${n.bg} ${n.text}`}>
                  {n.label.slice(0, 3).toUpperCase()}
                </span>
                <span className="font-body text-[11px] text-ink-600">{n.label}</span>
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="mb-1.5 block font-body text-xs font-medium text-ink-600">
            Phone number
          </span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="080..."
            required
            className="w-full rounded-lg border border-parchment-line bg-parchment px-3.5 py-2.5 font-body text-sm text-ink outline-none focus:border-gold-500"
          />
        </label>

        <div>
          <span className="mb-1.5 block font-body text-xs font-medium text-ink-600">Amount</span>
          <div className="mb-2 flex flex-wrap gap-2">
            {QUICK_AMOUNTS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAmount(String(a))}
                className={`rounded-full border px-3 py-1 font-mono text-xs transition ${
                  amount === String(a)
                    ? 'border-gold-500 bg-gold-500/10 text-gold-700'
                    : 'border-parchment-line text-ink-600'
                }`}
              >
                ₦{a.toLocaleString()}
              </button>
            ))}
          </div>
          <input
            type="number"
            min={50}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Enter amount"
            required
            className="w-full rounded-lg border border-parchment-line bg-parchment px-3.5 py-2.5 font-mono text-sm text-ink outline-none focus:border-gold-500"
          />
        </div>

        {error && (
          <p className="rounded-lg bg-ember-500/10 px-3 py-2 font-body text-sm text-ember-600">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={isSubmitting || !phone || !amount}
          className="flex w-full items-center justify-center rounded-lg bg-gold-500 py-3 font-display text-sm font-semibold text-ink transition hover:bg-gold-400 disabled:opacity-50"
        >
          {isSubmitting ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-ink border-t-transparent" />
          ) : (
            `Buy airtime${amount ? ` — ₦${Number(amount).toLocaleString()}` : ''}`
          )}
        </button>
      </form>
    <PinConfirmDialog open={showPin} onClose={() => setShowPin(false)} onVerified={purchase} /></AppShell>
  );
}
