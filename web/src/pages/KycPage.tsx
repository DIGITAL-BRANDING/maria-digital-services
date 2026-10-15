import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Copy, Check, Loader2, ShieldCheck, AlertTriangle } from 'lucide-react';
import AppShell from '../components/AppShell';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

type KycState = {
  kyc_status: 'unverified' | 'pending' | 'verified' | 'rejected';
  kyc_failure_reason: string | null;
  bvn_last4: string | null;
  virtual_account_number: string | null;
  virtual_account_bank: string | null;
  virtual_account_funding_paused?: boolean;
};

const INPUT_CLASSES =
  'w-full rounded-xl border border-slate-300 bg-white p-3 font-mono text-slate-900 tracking-widest outline-none focus:border-blue-600';

export default function KycPage() {
  const { refreshUser } = useAuth();
  const [kyc, setKyc] = useState<KycState | null>(null);
  const [loading, setLoading] = useState(true);
  const [bvn, setBvn] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  async function loadStatus() {
    try {
      const res = await api.get<{ data: KycState }>('/kyc/status');
      setKyc(res.data);
      setError('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load your verification status.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    if (!/^\d{11}$/.test(bvn)) {
      setError('BVN must be exactly 11 digits. / BVN dole ya zama lambobi 11.');
      return;
    }
    if (!consent) {
      setError('Please confirm the consent box before continuing. / Don Allah ka tabbatar da yarda kafin ka ci gaba.');
      return;
    }

    setBusy(true);
    try {
      const res = await api.post<{ message: string }>('/kyc/bvn', { bvn });
      setMessage(res.message || 'Verification submitted.');
      setBvn('');
      setConsent(false);
      await refreshUser();
      await loadStatus();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verification failed. Please try again.');
      // The server records a rejection when the BVN check fails, so reload to show it.
      await loadStatus();
    } finally {
      setBusy(false);
    }
  }

  function copyAccount() {
    if (!kyc?.virtual_account_number) return;
    void navigator.clipboard.writeText(kyc.virtual_account_number);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const isVerified = kyc?.kyc_status === 'verified';

  return (
    <AppShell>
      <div className="mx-auto max-w-xl">
        <header className="rounded-2xl bg-[#0b2f73] p-6 text-white shadow-xl">
          <p className="text-sm font-semibold text-amber-300">Account verification</p>
          <h1 className="mt-1 text-2xl font-bold">KYC Verification</h1>
          <p className="mt-2 text-sm text-blue-100">
            Verify your BVN to activate your dedicated virtual account number for wallet funding.
          </p>
          <p className="mt-1 text-sm text-blue-100/80">
            Tabbatar da BVN ɗinka domin kunna virtual account number ɗinka na cika wallet.
          </p>
        </header>

        {loading ? (
          <div className="flex justify-center py-14">
            <Loader2 className="animate-spin text-amber-500" />
          </div>
        ) : isVerified ? (
          <section className="mt-6 rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="text-emerald-600" size={28} />
              <div>
                <p className="font-bold text-slate-900">Identity verified</p>
                <p className="text-sm text-slate-600">An account has been activated for you.</p>
              </div>
            </div>

            {kyc?.virtual_account_number ? (
              <div className="mt-5 rounded-xl bg-slate-900 p-5 text-white">
                <p className="text-xs uppercase tracking-widest text-amber-300/80">Your virtual account number</p>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="font-mono text-xl font-semibold">{kyc.virtual_account_number}</span>
                  <button
                    onClick={copyAccount}
                    className="flex items-center gap-1.5 rounded-md bg-amber-400 px-3 py-1.5 text-xs font-semibold text-slate-900"
                  >
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p className="mt-1 text-sm text-slate-300">{kyc.virtual_account_bank}</p>
              </div>
            ) : (
              <p className="mt-5 rounded-xl bg-slate-100 p-4 text-sm text-slate-700">
                Your identity is verified. Virtual account funding is temporarily unavailable; please check back later.
              </p>
            )}

            {kyc?.bvn_last4 && (
              <p className="mt-4 text-xs text-slate-500">BVN on file ends in ••••{kyc.bvn_last4}</p>
            )}

            <Link
              to="/fund-wallet"
              className="mt-5 flex w-full items-center justify-center rounded-xl bg-blue-700 py-3 font-semibold text-white hover:bg-blue-800"
            >
              Go to wallet funding
            </Link>
          </section>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-start gap-3 rounded-xl bg-blue-50 p-4 text-sm text-slate-700">
              <ShieldCheck className="mt-0.5 shrink-0 text-blue-700" size={18} />
              <p>
                Your BVN is used only to verify your identity and issue your account number. We keep just the last 4 digits.
              </p>
            </div>

            {kyc?.kyc_status === 'pending' && (
              <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
                Your verification is still processing. Please wait a moment and refresh this page.
              </p>
            )}

            {kyc?.kyc_status === 'rejected' && kyc.kyc_failure_reason && (
              <div className="flex items-start gap-3 rounded-xl bg-rose-50 p-4 text-sm text-rose-900">
                <AlertTriangle className="mt-0.5 shrink-0" size={18} />
                <p>Your last attempt failed: {kyc.kyc_failure_reason}. Check your BVN and try again.</p>
              </div>
            )}

            <div>
              <label htmlFor="kyc-bvn" className="block text-sm font-semibold text-slate-800">
                Bank Verification Number (BVN)
              </label>
              <p className="mt-0.5 text-xs text-slate-500">Lambobi 11 na BVN ɗinka</p>
              <input
                id="kyc-bvn"
                required
                inputMode="numeric"
                autoComplete="off"
                maxLength={11}
                value={bvn}
                onChange={(e) => setBvn(e.target.value.replace(/\D/g, ''))}
                placeholder="00000000000"
                className={`mt-2 ${INPUT_CLASSES}`}
              />
              <p className="mt-1 text-xs text-slate-500">{bvn.length}/11 digits</p>
            </div>

            <label className="flex items-start gap-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-1 h-4 w-4 accent-blue-700"
              />
              <span>
                I confirm the BVN belongs to me and I consent to its use for identity verification and account creation.
              </span>
            </label>

            {error && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-900">{error}</p>}
            {message && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}

            <button
              type="submit"
              disabled={busy || bvn.length !== 11 || !consent}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-700 py-3 font-semibold text-white disabled:opacity-50"
            >
              {busy && <Loader2 size={16} className="animate-spin" />}
              {busy ? 'Verifying…' : 'Verify BVN · Tabbatar da BVN'}
            </button>
          </form>
        )}
      </div>
    </AppShell>
  );
}
