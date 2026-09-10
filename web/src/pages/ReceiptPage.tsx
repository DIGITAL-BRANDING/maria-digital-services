import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  CheckCircle2,
  Clock,
  XCircle,
  RotateCcw,
  Copy,
  Check,
  Printer,
  ChevronLeft,
  Wallet,
  Smartphone,
  Wifi,
  Zap,
  Tv,
  GraduationCap,
  Fingerprint,
  IdCard,
  MessageSquare,
  ArrowRightLeft,
  Gift,
  ShieldCheck,
  Ticket,
  ReceiptText,
} from 'lucide-react';
import Logo from '../components/Logo';
import { api } from '../lib/api';

type Transaction = {
  id: string;
  reference: string;
  type: string;
  status: string;
  amount: number;
  balance_after: number;
  description: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

// Every TransactionType from the Prisma schema gets a label + icon here so a
// receipt never falls back to a raw enum string like "DATA_PURCHASE" — the
// fallback branch below only fires for a type genuinely missing from this
// map, not for the common cases.
const TYPE_META: Record<string, { label: string; icon: typeof Wallet }> = {
  wallet_funding: { label: 'Wallet Funding', icon: Wallet },
  wallet_transfer: { label: 'Wallet Transfer', icon: ArrowRightLeft },
  data_purchase: { label: 'Data Purchase', icon: Wifi },
  airtime_purchase: { label: 'Airtime Purchase', icon: Smartphone },
  electricity_purchase: { label: 'Electricity Payment', icon: Zap },
  cable_purchase: { label: 'Cable Subscription', icon: Tv },
  result_pin: { label: 'Result Checker PIN', icon: GraduationCap },
  sms: { label: 'SMS', icon: MessageSquare },
  withdrawal: { label: 'Withdrawal', icon: ArrowRightLeft },
  referral_commission: { label: 'Referral Commission', icon: Gift },
  manual_adjustment: { label: 'Account Adjustment', icon: ReceiptText },
  coupon_redemption: { label: 'Coupon Redemption', icon: Ticket },
  nin_verification: { label: 'NIN Verification', icon: IdCard },
  bvn_verification: { label: 'BVN Verification', icon: Fingerprint },
  identity_service_request: { label: 'Identity Service', icon: ShieldCheck },
  nin_modification: { label: 'NIN Modification', icon: IdCard },
};

const STATUS_META: Record<string, { label: string; icon: typeof CheckCircle2; className: string }> = {
  success: { label: 'Successful', icon: CheckCircle2, className: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  pending: { label: 'Pending', icon: Clock, className: 'text-amber-600 bg-amber-50 border-amber-200' },
  failed: { label: 'Failed', icon: XCircle, className: 'text-rose-600 bg-rose-50 border-rose-200' },
  reversed: { label: 'Reversed', icon: RotateCcw, className: 'text-slate-600 bg-slate-100 border-slate-200' },
};

// Credits add to the balance, debits subtract - this decides the "+"/"-"
// prefix and green/ink amount color. Matches the schema comment in
// wallet.service.ts on which transaction types move money which direction.
const CREDIT_TYPES = new Set(['wallet_funding', 'referral_commission', 'coupon_redemption', 'manual_adjustment']);

function money(amount: number) {
  return `₦${amount.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const [tx, setTx] = useState<Transaction | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) return;
    api
      .get<Transaction>(`/transactions/${id}`)
      .then(setTx)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load this receipt.'));
  }, [id]);

  function copyReference() {
    if (!tx) return;
    navigator.clipboard.writeText(tx.reference);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (error) {
    return (
      <ReceiptShell>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center">
          <XCircle className="mx-auto mb-2 text-rose-500" size={28} />
          <p className="font-body text-sm font-semibold text-rose-700">{error}</p>
          <Link to="/dashboard" className="mt-4 inline-block font-body text-sm font-semibold text-gold-700 underline">
            Back to dashboard
          </Link>
        </div>
      </ReceiptShell>
    );
  }

  if (!tx) {
    return (
      <ReceiptShell>
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 rounded-full border-2 border-gold-500 border-t-transparent animate-spin" />
        </div>
      </ReceiptShell>
    );
  }

  const typeMeta = TYPE_META[tx.type] ?? { label: tx.type.replace(/_/g, ' '), icon: ReceiptText };
  const statusMeta = STATUS_META[tx.status] ?? STATUS_META.pending;
  const TypeIcon = typeMeta.icon;
  const StatusIcon = statusMeta.icon;
  const isCredit = CREDIT_TYPES.has(tx.type);
  const createdAt = new Date(tx.created_at);

  return (
    <ReceiptShell>
      {/* Print-only mark - invisible on screen, appears at the top of a printed/PDF copy. */}
      <p className="hidden print:mb-4 print:block print:font-mono print:text-[10px] print:text-slate-500">
        major-data-link-production.up.railway.app/receipt/{tx.id}
      </p>

      <div className="receipt-card overflow-hidden rounded-2xl border border-parchment-line bg-white shadow-xl print:border-0 print:shadow-none">
        {/* Ink header band */}
        <div className="bg-ink px-6 py-6 text-center sm:px-10 sm:py-8">
          <Logo dark className="justify-center" />
          <p className="mt-4 font-body text-[11px] uppercase tracking-[0.2em] text-cream/50">
            Transaction Receipt
          </p>
        </div>

        {/* Status + amount hero */}
        <div className="border-b border-dashed border-parchment-line px-6 py-8 text-center sm:px-10">
          <div
            className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full border ${statusMeta.className}`}
          >
            <StatusIcon size={26} />
          </div>
          <p className="mt-4 font-display text-3xl font-bold text-ink sm:text-4xl">
            {isCredit ? '+' : '-'}
            {money(tx.amount)}
          </p>
          <span
            className={`mt-2 inline-block rounded-full border px-3 py-1 font-body text-xs font-semibold ${statusMeta.className}`}
          >
            {statusMeta.label}
          </span>
          <p className="mt-3 flex items-center justify-center gap-2 font-body text-sm font-medium text-ink-600">
            <TypeIcon size={15} className="text-gold-600" />
            {typeMeta.label}
          </p>
        </div>

        {/* Details table */}
        <div className="space-y-0 px-6 py-6 sm:px-10">
          <ReceiptRow label="Description" value={tx.description} />
          <ReceiptRow
            label="Reference"
            value={
              <button
                onClick={copyReference}
                className="flex items-center gap-1.5 font-mono text-xs font-semibold text-ink hover:text-gold-700 print:pointer-events-none"
              >
                {tx.reference}
                <span className="print:hidden">
                  {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                </span>
              </button>
            }
          />
          <ReceiptRow
            label="Date & time"
            value={createdAt.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}
          />
          <ReceiptRow label="Wallet balance after" value={money(tx.balance_after)} last />
        </div>

        {/* Footer */}
        <div className="border-t border-parchment-line bg-parchment/50 px-6 py-5 text-center sm:px-10">
          <p className="font-body text-xs leading-relaxed text-ink-600">
            This is an automatically generated receipt from MARIA Digital Solutions. Keep it for your
            records — quote the reference above if you ever need support with this transaction.
          </p>
        </div>
      </div>

      {/* Actions - hidden when printing */}
      <div className="mt-6 flex flex-col gap-3 print:hidden sm:flex-row">
        <button
          onClick={() => window.print()}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gold-500 py-3 font-body text-sm font-bold text-ink transition hover:bg-gold-400"
        >
          <Printer size={16} /> Print / Save as PDF
        </button>
        <Link
          to="/dashboard"
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-ink-line py-3 font-body text-sm font-semibold text-ink transition hover:bg-parchment"
        >
          <ChevronLeft size={16} /> Back to dashboard
        </Link>
      </div>
    </ReceiptShell>
  );
}

function ReceiptRow({ label, value, last = false }: { label: string; value: React.ReactNode; last?: boolean }) {
  return (
    <div className={`flex items-start justify-between gap-4 py-3 ${last ? '' : 'border-b border-parchment-line/70'}`}>
      <span className="font-body text-xs font-medium uppercase tracking-wide text-ink-600/70">{label}</span>
      <span className="text-right font-body text-sm font-semibold text-ink">{value}</span>
    </div>
  );
}

// Deliberately NOT wrapped in AppShell - a receipt is a standalone document
// people print, screenshot, or forward to someone else for support, not a
// dashboard view. Its own minimal header keeps a way back to the app without
// dragging the sidebar/nav chrome into a printed copy.
function ReceiptShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f7fb] print:bg-white">
      <header className="border-b border-parchment-line bg-white px-5 py-4 print:hidden">
        <div className="mx-auto flex max-w-lg items-center justify-between">
          <Link to="/dashboard" className="flex items-center gap-1.5 font-body text-sm font-semibold text-ink-600 hover:text-ink">
            <ChevronLeft size={16} /> Dashboard
          </Link>
          <Logo />
        </div>
      </header>
      <main className="mx-auto max-w-lg px-5 py-8 sm:py-12">{children}</main>
    </div>
  );
}

