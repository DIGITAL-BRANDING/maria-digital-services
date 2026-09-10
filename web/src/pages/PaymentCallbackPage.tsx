import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, XCircle, Loader2, ReceiptText } from 'lucide-react';
import AppShell from '../components/AppShell';
import { api, ApiError } from '../lib/api';
import { findTransactionIdByReference } from '../lib/receipt';

/**
 * Where Paystack redirects back to after a card payment (see
 * PAYSTACK_CALLBACK_URL in the backend env - it needs to point at
 * `<web origin>/payment/callback` for this page to ever be reached).
 * Paystack appends the transaction reference as either `?reference=` or
 * `?trxref=` depending on which of their flows initiated it.
 */
export default function PaymentCallbackPage() {
  const [params] = useSearchParams();
  const [state, setState] = useState<'checking' | 'success' | 'failed'>('checking');
  const [message, setMessage] = useState('');
  const [receiptId, setReceiptId] = useState<string | null>(null);

  useEffect(() => {
    const reference = params.get('reference') ?? params.get('trxref');
    if (!reference) {
      setState('failed');
      setMessage('No payment reference was provided.');
      return;
    }

    api
      .post<{ status: boolean; message: string }>('/wallet/fund/verify', { reference })
      .then((res) => {
        if (res.status) {
          setState('success');
          setMessage(res.message || 'Your wallet has been funded.');
          findTransactionIdByReference(reference).then(setReceiptId);
        } else {
          setState('failed');
          setMessage(res.message || 'Payment was not successful.');
        }
      })
      .catch((err) => {
        setState('failed');
        setMessage(err instanceof ApiError ? err.message : 'Could not confirm this payment.');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AppShell>
      <div className="mx-auto mt-10 flex max-w-md flex-col items-center gap-4 rounded-2xl border border-parchment-line bg-parchment px-6 py-14 text-center">
        {state === 'checking' && (
          <>
            <Loader2 size={40} className="animate-spin text-gold-600" />
            <h1 className="font-display text-xl font-bold text-ink">Confirming payment…</h1>
            <p className="max-w-xs font-body text-sm text-ink-600">This only takes a moment.</p>
          </>
        )}
        {state === 'success' && (
          <>
            <CheckCircle2 size={44} className="text-success-500" />
            <h1 className="font-display text-xl font-bold text-ink">Payment confirmed</h1>
            <p className="max-w-xs font-body text-sm text-ink-600">{message}</p>
          </>
        )}
        {state === 'failed' && (
          <>
            <XCircle size={44} className="text-ember-500" />
            <h1 className="font-display text-xl font-bold text-ink">Payment not confirmed</h1>
            <p className="max-w-xs font-body text-sm text-ink-600">{message}</p>
          </>
        )}
        <div className="mt-2 flex gap-3">
          {receiptId && (
            <Link
              to={`/receipt/${receiptId}`}
              className="flex items-center gap-1.5 rounded-lg border border-gold-500/50 px-5 py-2.5 font-body text-sm font-semibold text-gold-700 transition hover:bg-gold-50"
            >
              <ReceiptText size={15} /> View receipt
            </Link>
          )}
          <Link
            to="/dashboard"
            className="rounded-lg bg-gold-500 px-5 py-2.5 font-display text-sm font-semibold text-ink transition hover:bg-gold-400"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
