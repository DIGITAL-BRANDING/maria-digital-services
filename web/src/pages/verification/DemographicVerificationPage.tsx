import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import AppShell from '../../components/AppShell';
import { api, ApiError } from '../../lib/api';
import { PinConfirmDialog } from '../../components/PinConfirmDialog';
import {
  PageHeader,
  StepLabel,
  ConsentCheckbox,
  SlipResultView,
  VerificationHistoryView,
  useVerificationPrices,
  useVerificationHistory,
  money,
  TILE_CLASSES,
  TILE_SELECTED_CLASSES,
  TILE_UNSELECTED_CLASSES,
  FORM_SECTION_CLASSES,
  FORM_INPUT_CLASSES,
  FORM_LABEL_CLASSES,
  FORM_HELP_CLASSES,
  type SlipResult,
} from '../../components/verification/shared';

const SLIP_TIERS = ['information', 'regular', 'standard', 'premium', 'vnin'] as const;
type SlipTier = (typeof SLIP_TIERS)[number];

const SLIP_LABELS: Record<SlipTier, string> = {
  information: 'Information Slip',
  regular: 'Regular Slip',
  standard: 'Standard Slip',
  premium: 'Premium Slip',
  vnin: 'V-NIN Slip',
};

// Actual sample-slip photos, dropped in public/branding by the team.
const SLIP_IMAGES: Record<SlipTier, string> = {
  information: '/branding/information slip.jpg',
  regular: '/branding/regular slip.jpg',
  standard: '/branding/standard slip.jpg',
  premium: '/branding/premium slip.jpg',
  vnin: '/branding/Vnin slip.jpg',
};

const DOB_PATTERN = /^\d{2}-\d{2}-\d{4}$/;

type Gender = '' | 'MALE' | 'FEMALE';

export default function DemographicVerificationPage() {
  const { prices } = useVerificationPrices();
  const { history, loading: loadingHistory } = useVerificationHistory('NIN_DEMOGRAPHIC');
  const price = prices['NIN_DEMOGRAPHIC'];

  // Purely a visual pick — Techhub's nin_by_demo.php takes no tier
  // parameter, so every tier returns the same NIN_DEMOGRAPHIC slip at the
  // same price. Kept only so the page matches the reference design's five
  // slip tiles; it isn't sent to the backend.
  const [slipTier, setSlipTier] = useState<SlipTier>('premium');

  const [firstname, setFirstname] = useState('');
  const [lastname, setLastname] = useState('');
  const [gender, setGender] = useState<Gender>('');
  const [dob, setDob] = useState('');
  const [consent, setConsent] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<SlipResult | null>(null);

  function prepare(event: FormEvent) {
    event.preventDefault();
    if (!DOB_PATTERN.test(dob)) {
      setMessage('Please enter the date of birth as DD-MM-YYYY (e.g., 25-12-1990).');
      return;
    }
    setMessage('');
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
      }>('/verification/nin/by-demographic', {
        firstname,
        lastname,
        dob,
        gender: gender || undefined,
        pin,
      });
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
        <PageHeader title="Demographic Verification" subtitle="Search by name, gender & date of birth to retrieve NIN information." />

        <section className={FORM_SECTION_CLASSES}>
          {!result ? (
            <form onSubmit={prepare}>
              <StepLabel n={1}>Select Your Preferred Slip Type</StepLabel>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
                {SLIP_TIERS.map((tier) => (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => setSlipTier(tier)}
                    className={`${TILE_CLASSES} ${slipTier === tier ? TILE_SELECTED_CLASSES : TILE_UNSELECTED_CLASSES}`}
                  >
                    <div className="mb-2 overflow-hidden rounded-lg bg-white/10">
                      <img src={SLIP_IMAGES[tier]} alt={SLIP_LABELS[tier]} className="h-16 w-full object-cover" />
                    </div>
                    <span className="block text-xs font-semibold text-white sm:text-sm">{SLIP_LABELS[tier]}</span>
                    <span className="mt-1 block text-xs font-bold text-gold-300">{money(price)}</span>
                  </button>
                ))}
              </div>

              <StepLabel n={2}>Enter Demographic Details</StepLabel>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <label className={FORM_LABEL_CLASSES}>
                  First Name
                  <input required placeholder="Enter first name" className={`mt-1 ${FORM_INPUT_CLASSES}`} value={firstname} onChange={(e) => setFirstname(e.target.value)} />
                </label>
                <label className={FORM_LABEL_CLASSES}>
                  Last Name
                  <input required placeholder="Enter last name" className={`mt-1 ${FORM_INPUT_CLASSES}`} value={lastname} onChange={(e) => setLastname(e.target.value)} />
                </label>
                <label className={FORM_LABEL_CLASSES}>
                  Gender
                  <select required className={`mt-1 ${FORM_INPUT_CLASSES}`} value={gender} onChange={(e) => setGender(e.target.value as Gender)}>
                    <option value="">Select gender</option>
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                  </select>
                </label>
                <label className={FORM_LABEL_CLASSES}>
                  Date of Birth
                  <input
                    required
                    placeholder="DD-MM-YYYY (e.g., 25-12-1990)"
                    maxLength={10}
                    className={`mt-1 ${FORM_INPUT_CLASSES}`}
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                  />
                  <span className={`mt-1 block ${FORM_HELP_CLASSES}`}>Format: DD-MM-YYYY</span>
                </label>
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
                setFirstname('');
                setLastname('');
                setGender('');
                setDob('');
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
