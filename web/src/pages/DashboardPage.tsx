import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Copy,
  Check,
  Wallet,
  Sparkles,
  PlusCircle,
  MessageCircle,
  Headset,
} from 'lucide-react';
import AppShell from '../components/AppShell';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { SERVICES, TINT_CLASSES } from '../lib/services';
import { CONTACT, whatsappLink } from '../lib/contact';

type WalletBalance = {
  balance: number;
  currency: string;
  virtual_account_number: string | null;
  virtual_account_bank: string | null;
  virtual_account_funding_paused?: boolean;
};

type Transaction = {
  id: string;
  type: string;
  description: string;
  amount: number;
  status: string;
  created_at: string;
};

export default function DashboardPage() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<WalletBalance | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadedTransactions, setLoadedTransactions] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.get<WalletBalance>('/wallet/balance').then(setWallet).catch(() => {});
    api
      .get<{ status: boolean; data: Transaction[] }>('/transactions')
      .then((res) => setTransactions((res.data ?? []).slice(0, 5)))
      .catch(() => {})
      .finally(() => setLoadedTransactions(true));
  }, []);

  function copyAccount() {
    if (!wallet?.virtual_account_number) return;
    navigator.clipboard.writeText(wallet.virtual_account_number);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // Shown only to first-timers (no transactions yet) — once someone has
  // actually bought something, they know how the site works and this just
  // becomes clutter above their real activity.
  const isFirstTimeUser = loadedTransactions && transactions.length === 0;

  return (
    <AppShell>
      <h1 className="font-display text-2xl font-bold text-ink">
        Hi, {user?.full_name?.split(' ')[0]}
      </h1>

      {/* Balance card */}
      <div className="relative mt-5 rounded-2xl bg-ink p-6">
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
          <a
            href={CONTACT.whatsappChannelUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Join our WhatsApp group"
            title="Join WhatsApp group"
            className="flex h-9 items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-500 px-3 text-xs font-bold text-white shadow-lg shadow-emerald-950/30 transition hover:bg-emerald-400"
          >
            <MessageCircle size={13} />
            <span>Join group</span>
          </a>
          <a
            href={whatsappLink('Hello MARIA Digital Solutions, I need support.')}
            target="_blank"
            rel="noreferrer"
            aria-label="Contact support"
            title="Contact support"
            className="flex h-9 items-center gap-1.5 rounded-full border border-gold-300 bg-gold-400 px-3 text-xs font-bold text-ink shadow-lg shadow-black/30 transition hover:bg-gold-300"
          >
            <Headset size={13} />
            <span>Support</span>
          </a>
        </div>
        <span className="block font-mono text-xs uppercase tracking-widest text-gold-500/70">
          Wallet balance
        </span>
        <div className="mt-1 font-display text-4xl font-bold text-cream">
          {wallet ? `₦${wallet.balance.toLocaleString()}` : '···'}
        </div>
        <p className="mt-1 font-body text-[11px] text-cream/55">Transaction fee: 2%</p>

        {wallet?.virtual_account_number ? (
          <div className="mt-5 flex items-center justify-between rounded-lg border border-ink-line bg-ink-soft px-4 py-3">
            <div>
              <span className="block font-mono text-[11px] text-cream/50">
                {wallet.virtual_account_bank}
              </span>
              <span className="font-mono text-sm font-semibold text-cream">
                {wallet.virtual_account_number}
              </span>
            </div>
            <button
              onClick={copyAccount}
              className="flex items-center gap-1.5 rounded-md bg-gold-500 px-3 py-1.5 font-body text-xs font-semibold text-ink transition hover:bg-gold-400"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        ) : (
          <div className="mt-5 flex items-center gap-2 rounded-lg border border-ink-line bg-ink-soft px-4 py-3">
            <Wallet size={15} className="shrink-0 text-gold-500/70" />
            <span className="font-body text-xs text-cream/60">
              {wallet?.virtual_account_funding_paused
                ? 'Click the button below to continue funding your wallet using Exact Transfer/Card'
                : 'Your dedicated account number is being set up — check back shortly, or fund via card from Buy Data / Buy Airtime.'}
            </span>
          </div>
        )}

        <Link
          to="/fund-wallet"
          className="mt-4 flex items-center justify-center gap-2 rounded-lg border border-gold-500/40 bg-gold-500/10 py-2.5 font-display text-sm font-semibold text-gold-400 transition hover:bg-gold-500/20"
        >
          <PlusCircle size={16} /> Fund Wallet
        </Link>
      </div>

      {/* First-time helper: how this whole thing works, in three steps */}
      {isFirstTimeUser && (
        <div className="mt-6 rounded-2xl border border-gold-500/30 bg-gold-50 p-5">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-gold-600" />
            <h2 className="font-display text-sm font-bold text-ink">
              New here? Here's how it works
            </h2>
          </div>
          <ol className="mt-4 space-y-3">
            <HowItWorksStep
              number={1}
              title="Fund your wallet"
              detail="Transfer any amount to the account number above — it lands in your wallet in seconds."
            />
            <HowItWorksStep
              number={2}
              title="Pick a service below"
              detail="Buy Data and Buy Airtime are ready now; more services are on the way."
            />
            <HowItWorksStep
              number={3}
              title="Confirm and you're done"
              detail="Enter the details, confirm — delivery is instant, and it shows up in Recent activity."
            />
          </ol>
        </div>
      )}

      {/* All services */}
      <div className="mt-8">
        <h2 className="font-display text-base font-semibold text-ink">Services</h2>
        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {SERVICES.slice(0, 17).map((service) => (
            <ServiceTile key={service.route} {...service} />
          ))}
        </div>
      </div>

      {/* Recent transactions */}
      <div className="mt-10">
        <h2 className="font-display text-base font-semibold text-ink">Recent activity</h2>
        {transactions.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-parchment-line px-4 py-8 text-center font-body text-sm text-ink-600">
            No transactions yet — your top-ups will show up here.
          </p>
        ) : (
          <div className="premium-activity mt-3 divide-y rounded-xl border">
            {transactions.map((t) => (
              <Link
                key={t.id}
                to={`/receipt/${t.id}`}
                className="premium-activity-row flex items-center justify-between px-4 py-3 transition hover:bg-parchment/40"
              >
                <div>
                  <p className="premium-activity-title font-body text-sm font-medium">{t.description}</p>
                  <p className="premium-activity-date font-mono text-xs">
                    {new Date(t.created_at).toLocaleString()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="premium-activity-amount font-mono text-sm font-semibold">
                    ₦{t.amount.toLocaleString()}
                  </p>
                  <StatusBadge status={t.status} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function HowItWorksStep({
  number,
  title,
  detail,
}: {
  number: number;
  title: string;
  detail: string;
}) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink font-mono text-[11px] font-bold text-gold-500">
        {number}
      </span>
      <div>
        <p className="font-body text-sm font-semibold text-ink">{title}</p>
        <p className="font-body text-xs text-ink-600">{detail}</p>
      </div>
    </li>
  );
}

function ServiceTile({
  label,
  icon: Icon,
  route,
  tint,
  implemented,
}: (typeof SERVICES)[number]) {
  const colors = TINT_CLASSES[tint];
  const assetName = ({
    '/nin': 'NIN_Phone_Verification.png', '/phone': 'Phone Multiple.png', '/cac': 'CAC Services.png', '/bvn': 'BVN Verifications.png',
    '/ipe': 'IPE Clearance.png', '/validation': 'Validation.png', '/tracking': 'Personalization.png', '/bvn-ret': 'BVN Retrieval.png', '/delink': 'Self Service Unlink.png', '/modification': 'NIN Modification.png', '/bvn-license': 'BVN Verifications.png', '/bvn-modification': 'BVN Modification.png', '/attestation': 'Birth Attestation.png', '/tin': 'TIN Certificate.png', '/newspaper': 'Demographic Serach.png', '/demo': 'Demographic Serach.png'
  } as Record<string, string>)[route];
  return (
    <Link
      to={route}
      className="service-tile group relative flex min-h-36 flex-col items-center justify-center overflow-hidden rounded-2xl p-4 text-center transition duration-200 hover:-translate-y-1"
    >
      {!implemented && (
        <span className="absolute right-2 top-2 z-10 rounded-full border border-gold-400/35 bg-black/35 px-2 py-1 font-body text-[9px] font-semibold uppercase tracking-wide text-gold-200">
          Soon
        </span>
      )}
      <div className={`service-tile-icon relative z-10 flex h-16 w-16 items-center justify-center rounded-full ${colors.bg} ${colors.text} transition group-hover:scale-110`}>
        {assetName ? <img src={`/branding/${assetName}`} alt="" className="h-full w-full rounded-full object-contain" /> : <Icon size={24} />}
      </div>
      <span className="relative z-10 mt-3 font-body text-sm font-bold leading-tight text-[#fff7dd] drop-shadow">{label}</span>
    </Link>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    success: 'text-emerald-300',
    pending: 'text-yellow-200',
    failed: 'text-rose-300',
  };
  return (
    <span className={`font-mono text-[10px] uppercase ${styles[status] ?? 'text-cream'}`}>
      {status}
    </span>
  );
}

