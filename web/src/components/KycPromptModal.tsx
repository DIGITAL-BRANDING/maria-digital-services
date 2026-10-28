import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ShieldCheck, X } from 'lucide-react';
import { KYC_PROMPT_PENDING_KEY, useAuth } from '../lib/auth';

export default function KycPromptModal() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  const needsKyc = !!user && user.kyc_status !== 'verified';

  useEffect(() => {
    if (!user) return;
    let promptPending = false;
    try { promptPending = window.sessionStorage.getItem(KYC_PROMPT_PENDING_KEY) === '1'; } catch { /* Optional UI prompt state. */ }
    if (!promptPending) return;
    // Wait until we know the KYC status for this login.
    if (!needsKyc) {
      try { window.sessionStorage.removeItem(KYC_PROMPT_PENDING_KEY); } catch { /* Ignore unavailable storage. */ }
      return;
    }
    // Keep the login flag until navigation reaches the authenticated app.
    // login() updates auth state before LoginPage navigates to the dashboard.
    if (pathname === '/login' || pathname === '/kyc' || pathname === '/setup-pins' || pathname === '/set-new-password') return;
    try { window.sessionStorage.removeItem(KYC_PROMPT_PENDING_KEY); } catch { /* Ignore unavailable storage. */ }
    setOpen(true);
  }, [user, needsKyc, pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  function goToKyc() {
    setOpen(false);
    navigate('/kyc');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="kyc-prompt-title"
        className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
      >
        <button
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="absolute right-3 top-3 rounded-lg p-2 text-slate-500 hover:bg-slate-100"
        >
          <X size={18} />
        </button>

        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50">
          <ShieldCheck className="text-blue-700" size={26} />
        </div>

        <h2 id="kyc-prompt-title" className="mt-4 text-xl font-bold text-slate-900">
          Get your ZenithPay account number
        </h2>

        <p className="mt-3 text-sm leading-6 text-slate-600">
          Hi{user?.full_name ? ` ${user.full_name.split(' ')[0]}` : ''}, complete identity verification with your BVN
          to activate your dedicated ZenithPay virtual account for wallet funding.
        </p>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            onClick={() => setOpen(false)}
            className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Remind me later
          </button>
          <button
            onClick={goToKyc}
            autoFocus
            className="rounded-xl bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800"
          >
            Complete KYC
          </button>
        </div>
      </div>
    </div>
  );
}
