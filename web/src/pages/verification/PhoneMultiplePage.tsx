import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import AppShell from '../../components/AppShell';
import { api, ApiError } from '../../lib/api';
import { PinConfirmDialog } from '../../components/PinConfirmDialog';
import {
  PageHeader,
  StepLabel,
  ConsentCheckbox,
  TierCardGrid,
  SlipResultView,
  VerificationHistoryView,
  useVerificationPrices,
  useVerificationHistory,
  money,
  FORM_SECTION_CLASSES,
  FORM_INPUT_CLASSES,
  FORM_HELP_CLASSES,
  PHONE_TIERS,
  PHONE_TIER_LABELS,
  PHONE_TIER_ICON,
  PHONE_TIER_IMAGE,
  PHONE_KEY,
  type PhoneTier,
  type SlipResult,
} from '../../components/verification/shared';

// "Phone Multiple" used to point at a POST /verification/nin/phone-multiple
// endpoint (and a NIN_PHONE_MULTIPLE service key) that never actually
// existed on the backend or in Techhub's API — every request here was
// guaranteed to fail, and the price never resolved. Techhub's real
// phone-based lookup is the same tiered "NIN by Phone" call already used
// by /nin's "Phone No" method (POST /verification/nin/by-phone with a
// regular/standard/premium tier, one slip back) - so this page now uses
// that real, working endpoint instead, with the same slip-type tiles.
export default function PhoneMultiplePage() {
  const { prices } = useVerificationPrices();
  const [phone, setPhone] = useState('');
  const [tier, setTier] = useState<PhoneTier>('premium');
  const [consent, setConsent] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<SlipResult | null>(null);

  const serviceKey = PHONE_KEY[tier];
  const { history, loading: loadingHistory } = useVerificationHistory(serviceKey);
  const price = prices[serviceKey];

  function prepare(event: FormEvent) {
    event.preventDefault();
    setShowPin(true);
  }

  async function submit(pin: string) {
    setShowPin(false);
    setBusy(true);
    setMessage('');
    try {
      const result = await api.post<{
        status: boolean;
        message: string;
        data?: { reference: string; user_data?: Record<string, unknown>; pdf_base64?: string; pdf_url?: string };
      }>('/verification/nin/by-phone', { phone, tier, pin });
      if (!result.status) throw new Error(result.message);
      setResult({ user_data: result.data?.user_data, pdf_base64: result.data?.pdf_base64, pdf_url: result.data?.pdf_url, reference: result.data?.reference ?? '' });
      setMessage(result.message || 'Done - your document is ready below.');
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl">
        <PageHeader title="Phone Number Verification" subtitle="Look up a NIN slip by its registered phone number." />

        <section className={FORM_SECTION_CLASSES}>
          {!result ? (
            <form onSubmit={prepare}>
              <StepLabel n={1}>Enter Phone Number</StepLabel>
              <input
                required
                inputMode="numeric"
                maxLength={11}
                placeholder="Enter Phone Number"
                className={`mt-3 ${FORM_INPUT_CLASSES}`}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <p className={`mt-1 ${FORM_HELP_CLASSES}`}>Enter your 11-digit phone number starting with 0 (e.g., 08012345678).</p>

              <StepLabel n={2}>Select Your Preferred Slip Type</StepLabel>
              <div className="mt-3">
                <TierCardGrid
                  options={PHONE_TIERS}
                  labels={PHONE_TIER_LABELS}
                  value={tier}
                  onChange={setTier}
                  priceFor={(t) => prices[PHONE_KEY[t]]}
                  iconFor={(t) => PHONE_TIER_ICON[t]}
                  imageFor={(t) => PHONE_TIER_IMAGE[t]}
                />
              </div>

              <ConsentCheckbox checked={consent} onChange={setConsent} />

              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="rounded-full bg-gold-500/15 px-4 py-2 text-center font-body text-sm font-bold text-gold-700">Service cost: {money(price)}</span>
                <button disabled={busy || !consent} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gold-500 px-6 py-3 font-display font-semibold text-ink disabled:opacity-60 sm:w-auto">
                  {busy ? <Loader2 size={16} className="animate-spin" /> : 'Verify'}
                </button>
              </div>
              {message && <p className="mt-3 rounded-lg bg-blue-50 p-3 font-body text-sm text-[#0b2f73]">{message}</p>}
            </form>
          ) : (
            <SlipResultView
              result={result}
              message={message}
              onDone={() => {
                setResult(null);
                setMessage('');
                setPhone('');
              }}
            />
          )}

          <VerificationHistoryView history={history} loading={loadingHistory} />
        </section>
      </div>

      <PinConfirmDialog open={showPin} onClose={() => setShowPin(false)} onVerified={submit} />
    </AppShell>
  );
}
