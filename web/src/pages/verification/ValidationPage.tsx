import { useMemo, useState, type FormEvent } from 'react';
import { Info, Loader2 } from 'lucide-react';
import AppShell from '../../components/AppShell';
import { api, ApiError } from '../../lib/api';
import { PinConfirmDialog } from '../../components/PinConfirmDialog';
import {
  PageHeader,
  StepLabel,
  ConsentCheckbox,
  AsyncResultView,
  VerificationHistoryView,
  useVerificationPrices,
  useVerificationHistory,
  useTicketPolling,
  money,
  FORM_SECTION_CLASSES,
  FORM_INPUT_CLASSES,
  FORM_HELP_CLASSES,
  TILE_CLASSES,
  TILE_SELECTED_CLASSES,
  TILE_UNSELECTED_CLASSES,
  SlipIcon,
  type SlipIconVariant,
  type AsyncResult,
  type TicketStatus,
} from '../../components/verification/shared';

// The four detail types shown in the reference design — a subset of the
// eight validation_type values Techhub's nin_validation.php actually
// accepts (see the zod enum in verification.routes.ts). The rest (General,
// SIM, Bank, Photographic error) still work through the API; they're just
// not part of this screen's four cards.
const DETAILS = [
  { value: 'no_record', label: 'No Record Found', serviceKey: 'NIN_VALIDATION_NO_RECORD' },
  { value: 'update_records', label: 'Update Record', serviceKey: 'NIN_VALIDATION_UPDATE_RECORDS' },
  { value: 'modification', label: 'Validate Modification', serviceKey: 'NIN_VALIDATION_MODIFICATION' },
  { value: 'v.nin_validation', label: 'vNIN Validation', serviceKey: 'NIN_VALIDATION_VNIN' },
] as const;
type DetailValue = (typeof DETAILS)[number]['value'];

// Slip type has no effect on Techhub's nin-validation submission today
// (submitNinValidation only takes nin + validation_type) — it renders here
// to match the reference design and defaults to the free "No Slip" option.
const SLIP_TYPES = ['no-slip', 'regular', 'standard', 'premium'] as const;
type SlipType = (typeof SLIP_TYPES)[number];
const SLIP_LABEL: Record<SlipType, string> = { 'no-slip': 'No Slip', regular: 'Regular Slip', standard: 'Standard Slip', premium: 'Premium Slip' };
const SLIP_ICON: Record<SlipType, SlipIconVariant> = { 'no-slip': 'none', regular: 'regular', standard: 'standard', premium: 'premium' };

export default function ValidationPage() {
  const { prices } = useVerificationPrices();
  const [detail, setDetail] = useState<DetailValue>('no_record');
  const [slipType, setSlipType] = useState<SlipType>('no-slip');
  const [nin, setNin] = useState('');
  const [consent, setConsent] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [asyncResult, setAsyncResult] = useState<AsyncResult | null>(null);
  const [ticketStatus, setTicketStatus] = useState<TicketStatus | null>(null);

  const serviceKey = DETAILS.find((d) => d.value === detail)!.serviceKey;
  const { history, loading: loadingHistory } = useVerificationHistory(serviceKey);
  const price = useMemo(() => prices[serviceKey], [serviceKey, prices]);
  const { polling, checkTicket } = useTicketPolling('/verification/nin-validation', asyncResult, ticketStatus, setTicketStatus);

  function prepare(event: FormEvent) {
    event.preventDefault();
    setShowPin(true);
  }

  async function submit(pin: string) {
    setShowPin(false);
    setBusy(true);
    setMessage('');
    try {
      const result = await api.post<{ status: boolean; message: string; data?: { reference: string; ticket_id?: string } }>('/verification/nin-validation', {
        nin,
        validation_type: detail,
        pin,
      });
      if (!result.status) throw new Error(result.message);
      if (!result.data?.ticket_id) throw new Error('No ticket was returned - please contact support.');
      setAsyncResult({ ticket_id: result.data.ticket_id, reference: result.data.reference });
      setMessage("Request submitted. We'll check its status below - this is usually reviewed within a few minutes.");
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl">
        <div className="mt-1 flex items-center justify-between">
          <PageHeader
            title="Validation (Instant)"
            subtitle="NIMC service used when a NIN becomes inactive, or when a Self-Service Portal modification hasn't reflected yet."
          />
        </div>
        <button onClick={() => setShowInfo(true)} className="mt-3 flex items-center gap-1.5 font-body text-xs font-semibold text-gold-700">
          <Info size={14} /> What is Validation?
        </button>

        <section className={FORM_SECTION_CLASSES}>
          {!asyncResult ? (
            <form onSubmit={prepare}>
              <StepLabel n={1}>Details Needed</StepLabel>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
                {DETAILS.map((d) => (
                  <button key={d.value} type="button" onClick={() => setDetail(d.value)} className={`${TILE_CLASSES} ${detail === d.value ? TILE_SELECTED_CLASSES : TILE_UNSELECTED_CLASSES}`}>
                    <span className="block text-xs font-semibold sm:text-sm">{d.label}</span>
                    <span className="mt-1 block text-xs font-bold text-gold-300">{money(prices[d.serviceKey])}</span>
                  </button>
                ))}
              </div>

              <StepLabel n={2}>Slip Type</StepLabel>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
                {SLIP_TYPES.map((s) => (
                  <button key={s} type="button" onClick={() => setSlipType(s)} className={`${TILE_CLASSES} ${slipType === s ? TILE_SELECTED_CLASSES : TILE_UNSELECTED_CLASSES}`}>
                    <div className="mb-2 flex justify-center rounded-lg bg-white/10 p-1.5">
                      <SlipIcon variant={SLIP_ICON[s]} />
                    </div>
                    <span className="block text-xs font-semibold sm:text-sm">{SLIP_LABEL[s]}</span>
                    <span className="mt-1 block text-xs font-bold text-gold-300">{s === 'no-slip' ? money(0) : 'Coming soon'}</span>
                  </button>
                ))}
              </div>

              <StepLabel n={3}>Supply ID Number</StepLabel>
              <input
                required
                inputMode="numeric"
                maxLength={11}
                placeholder="NIN Number (11 digits)"
                className={`mt-3 ${FORM_INPUT_CLASSES}`}
                value={nin}
                onChange={(e) => setNin(e.target.value)}
              />
              <p className={`mt-1 ${FORM_HELP_CLASSES}`}>Enter your 11-digit NIN (e.g., 12345678901)</p>

              <ConsentCheckbox checked={consent} onChange={setConsent} />

              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="rounded-full bg-gold-500/15 px-4 py-2 text-center font-body text-sm font-bold text-gold-700">Service cost: {money(price)}</span>
                <button disabled={busy || !consent} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gold-500 px-6 py-3 font-display font-semibold text-ink disabled:opacity-60 sm:w-auto">
                  {busy ? <Loader2 size={16} className="animate-spin" /> : 'Submit Verification'}
                </button>
              </div>
              {message && <p className="mt-3 rounded-lg bg-blue-50 p-3 font-body text-sm text-[#0b2f73]">{message}</p>}
            </form>
          ) : (
            <AsyncResultView
              ticket={asyncResult}
              status={ticketStatus}
              polling={polling}
              message={message}
              onRefresh={() => checkTicket(false)}
              onDone={() => {
                setAsyncResult(null);
                setTicketStatus(null);
                setMessage('');
                setNin('');
              }}
            />
          )}

          <VerificationHistoryView history={history} loading={loadingHistory} />
        </section>
      </div>

      {showInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-2xl">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border-2 border-gold-500 text-gold-700">
              <Info size={22} />
            </div>
            <h3 className="mt-4 font-display text-lg font-bold text-[#0b2f73]">Warning</h3>
            <p className="mt-3 font-body text-sm text-[#0b2f73]/80">
              Validation is a NIMC service used when a NIN becomes inactive or stops working — most times showing the message "Record Not Found." This type of validation typically
              takes up to 48 working hours to complete.
            </p>
            <p className="mt-3 font-body text-sm text-[#0b2f73]/80">
              <b>NIN Modification Validation</b> is required when updates such as changes to name, date of birth, or phone number are made through the NIMC Self-Service Portal, but
              the system still displays the old details. It usually takes up to 2 weeks (depending on NIMC network).
            </p>
            <button onClick={() => setShowInfo(false)} className="mt-5 w-full rounded-xl bg-gold-500 py-2.5 font-display font-semibold text-ink">
              Close
            </button>
          </div>
        </div>
      )}

      <PinConfirmDialog open={showPin} onClose={() => setShowPin(false)} onVerified={submit} />
    </AppShell>
  );
}
