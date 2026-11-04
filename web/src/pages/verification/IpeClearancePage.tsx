import { useMemo, useState, type FormEvent } from 'react';
import { Clock, Loader2, Lock, TriangleAlert } from 'lucide-react';
import AppShell from '../../components/AppShell';
import { api, ApiError, INTERRUPTED_MESSAGE, SLIP_REQUEST_TIMEOUT_MS, wasInterrupted } from '../../lib/api';
import { PinConfirmDialog } from '../../components/PinConfirmDialog';
import {
  PageHeader,
  StepLabel,
  ConsentCheckbox,
  AsyncResultView,
  TicketTrackingTable,
  useVerificationPrices,
  useServiceTickets,
  useTicketPolling,
  useIdempotencyKey,
  money,
  BulkModeToggle,
  BulkSubmitResults,
  BULK_MAX_ITEMS,
  parseBulkLines,
  type BulkSubmitSummary,
  FORM_SECTION_CLASSES,
  FORM_INPUT_CLASSES,
  FORM_HELP_CLASSES,
  TILE_CLASSES,
  TILE_SELECTED_CLASSES,
  TILE_UNSELECTED_CLASSES,
  type AsyncResult,
  type TicketStatus,
} from '../../components/verification/shared';

// Only the first service type is wired to Techhub today (submitIpeClearance
// only takes a tracking_id — see verification.routes.ts POST
// /ipe-clearance). The other three cards from the reference design are
// shown for parity but disabled until pricing/logic for them is added
// server-side (each would need its own priced service key, the way
// NIN_VALIDATION_* was split out per validation_type).
const SERVICE_TYPES = [
  { id: 'enrollment', label: 'NIN enrollment for tracking ID', note: '(Normal IPE only)', enabled: true },
  { id: 'processing_error', label: 'InProcessing Error', note: '(Normal IPE)', enabled: false },
  { id: 'invalid_tracking', label: 'Invalid Tracking ID', note: '(Normal IPE)', enabled: false },
  { id: 'still_processing', label: 'Still Being Processed', note: '(Normal IPE)', enabled: false },
] as const;

const SLIP_TYPES = ['no-slip', 'regular', 'standard', 'premium'] as const;
type SlipType = (typeof SLIP_TYPES)[number];
const SLIP_LABEL: Record<SlipType, string> = { 'no-slip': 'No Slip', regular: 'Regular Slip', standard: 'Standard Slip', premium: 'Premium Slip' };

export default function IpeClearancePage() {
  const { prices } = useVerificationPrices();
  const [slipType, setSlipType] = useState<SlipType>('no-slip');
  const [trackingId, setTrackingId] = useState('');
  const [consent, setConsent] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [asyncResult, setAsyncResult] = useState<AsyncResult | null>(null);
  const [ticketStatus, setTicketStatus] = useState<TicketStatus | null>(null);
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [bulkText, setBulkText] = useState('');
  const [bulkSummary, setBulkSummary] = useState<BulkSubmitSummary | null>(null);
  const idempotency = useIdempotencyKey();

  const price = prices['IPE_CLEARANCE'];
  // Same shape the single form enforces (maxLength 15, alphanumeric tracking IDs).
  const isTrackingId = (line: string) => /^[A-Za-z0-9]{1,15}$/.test(line);
  const bulkParse = useMemo(() => parseBulkLines(bulkText, isTrackingId), [bulkText]);
  const bulkReady = bulkParse.valid.length > 0 && bulkParse.invalid.length === 0 && bulkParse.valid.length <= BULK_MAX_ITEMS;
  const bulkTotal = price === undefined ? undefined : price * bulkParse.valid.length;
  const { polling, checkTicket } = useTicketPolling('/verification/ipe-clearance', asyncResult, ticketStatus, setTicketStatus);
  const { tickets, loading: loadingTickets, refresh: refreshTickets } = useServiceTickets('IPE_CLEARANCE');
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [ticketSearch, setTicketSearch] = useState('');

  async function checkTicketRow(ticketId: string | null) {
    if (!ticketId) return;
    setCheckingId(ticketId);
    try {
      await api.get(`/verification/ipe-clearance/${ticketId}`);
    } catch {
      // transient - the row just won't have updated this time
    } finally {
      setCheckingId(null);
      void refreshTickets();
    }
  }

  function prepare(event: FormEvent) {
    event.preventDefault();
    if (mode === 'bulk' && !bulkReady) return;
    setShowPin(true);
  }

  function switchMode(next: 'single' | 'bulk') {
    setMode(next);
    setMessage('');
  }

  async function submitBulk(pin: string) {
    setShowPin(false);
    setBusy(true);
    setMessage('');
    try {
      // IPE is pinned to K-Tech on the server; every tracking ID is debited and
      // submitted on its own. See submitIpeClearanceBulk in verification.service.ts.
      const result = await api.post<{ status: boolean; message: string; data: BulkSubmitSummary }>(
        '/verification/ipe-clearance/bulk',
        { tracking_ids: bulkParse.valid, pin },
        true,
        SLIP_REQUEST_TIMEOUT_MS,
        idempotency.current(bulkParse.valid.join(','))
      );
      if (!result.status) throw new Error(result.message);
      idempotency.reset();
      setBulkSummary(result.data);
      void refreshTickets();
    } catch (error) {
      if (wasInterrupted(error)) {
        setMessage(INTERRUPTED_MESSAGE);
      } else {
        idempotency.reset();
        setMessage(error instanceof Error ? error.message : 'Request failed.');
      }
    } finally {
      setBusy(false);
    }
  }

  function submit(pin: string) {
    return mode === 'bulk' ? submitBulk(pin) : submitSingle(pin);
  }

  async function submitSingle(pin: string) {
    setShowPin(false);
    setBusy(true);
    setMessage('');
    try {
      const result = await api.post<{ status: boolean; message: string; data?: { reference: string; ticket_id?: string } }>('/verification/ipe-clearance', {
        tracking_id: trackingId,
        pin,
      });
      if (!result.status) throw new Error(result.message);
      if (!result.data?.ticket_id) throw new Error('No ticket was returned - please contact support.');
      setAsyncResult({ ticket_id: result.data.ticket_id, reference: result.data.reference });
      setMessage("Request submitted. We'll check its status below - this is usually reviewed within a few minutes.");
      void refreshTickets();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl">
        <PageHeader title="IPE Clearance (Instant)" />

        <section className={FORM_SECTION_CLASSES}>
          {bulkSummary ? (
            <BulkSubmitResults
              summary={bulkSummary}
              onDone={() => {
                setBulkSummary(null);
                setBulkText('');
                setMessage('');
              }}
            />
          ) : !asyncResult ? (
            <form onSubmit={prepare}>
              <div className="rounded-xl border border-gold-500/40 bg-gold-50 p-4">
                <p className="flex items-start gap-2 font-body text-sm font-bold text-amber-900">
                  <TriangleAlert size={16} className="mt-0.5 shrink-0" />
                  NOTE: IPE IS NOT REFUNDABLE. Ensure all details are correct before submission.
                </p>
                <p className="mt-2 font-body text-sm text-amber-900">
                  After submitting, proceed to check history below. (Status usually updates within 10-30mins)
                </p>
                <p className="mt-2 flex items-center gap-1.5 font-body text-xs font-semibold text-amber-900">
                  <Clock size={13} /> Typical completion time: within 24hrs
                </p>
              </div>

              <BulkModeToggle mode={mode} onChange={switchMode} />

              <StepLabel n={1}>Service Type</StepLabel>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
                {SERVICE_TYPES.map((s) => (
                  <div key={s.id} className={`relative ${TILE_CLASSES} ${s.enabled ? '' : 'cursor-not-allowed opacity-50'} ${s.enabled ? TILE_SELECTED_CLASSES : TILE_UNSELECTED_CLASSES}`}>
                    {!s.enabled && <Lock size={12} className="absolute right-2 top-2" />}
                    <span className="block text-xs font-semibold leading-tight">{s.label}</span>
                    <span className="mt-1 block text-[10px] text-blue-100">{s.note}</span>
                    <span className="mt-1 block text-xs font-bold text-gold-300">{s.enabled ? money(price) : 'Coming soon'}</span>
                  </div>
                ))}
              </div>

              <StepLabel n={2}>Slip Type</StepLabel>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
                {SLIP_TYPES.map((s) => (
                  <button key={s} type="button" onClick={() => setSlipType(s)} className={`${TILE_CLASSES} ${slipType === s ? TILE_SELECTED_CLASSES : TILE_UNSELECTED_CLASSES}`}>
                    <span className="block text-xs font-semibold sm:text-sm">{SLIP_LABEL[s]}</span>
                    <span className="mt-1 block text-xs font-bold text-gold-300">{s === 'no-slip' ? money(0) : 'Coming soon'}</span>
                  </button>
                ))}
              </div>

              {mode === 'single' ? (
                <>
                  <StepLabel n={3}>Supply Tracking ID</StepLabel>
                  <input
                    required
                    maxLength={15}
                    placeholder="Tracking ID (15 characters)"
                    className={`mt-3 ${FORM_INPUT_CLASSES}`}
                    value={trackingId}
                    onChange={(e) => setTrackingId(e.target.value)}
                  />
                  <p className={`mt-1 ${FORM_HELP_CLASSES}`}>Enter your 15-character alphanumeric Tracking ID (e.g., ABC123456789012)</p>
                </>
              ) : (
                <>
                  <StepLabel n={3}>Supply Tracking IDs</StepLabel>
                  <textarea
                    required
                    rows={7}
                    placeholder={'Enter one Tracking ID per line\nTRACK001\nTRACK002\nTRACK003'}
                    className={`mt-3 min-h-[160px] resize-y font-mono text-sm ${FORM_INPUT_CLASSES}`}
                    value={bulkText}
                    onChange={(e) => setBulkText(e.target.value)}
                  />
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 font-body text-xs text-[#0b2f73]/70">
                    <span>
                      IDs entered: <b className={bulkParse.valid.length > BULK_MAX_ITEMS ? 'text-ember-600' : 'text-[#0b2f73]'}>{bulkParse.valid.length}</b> / {BULK_MAX_ITEMS} max
                      {bulkParse.duplicates > 0 && <span> · {bulkParse.duplicates} duplicate{bulkParse.duplicates > 1 ? 's' : ''} ignored</span>}
                    </span>
                    <span>Each ID is charged separately</span>
                  </div>
                  {bulkParse.invalid.length > 0 && (
                    <p className="mt-2 rounded-lg bg-ember-500/10 p-3 font-body text-xs text-ember-600">
                      Fix these entries before submitting (letters and numbers only, up to 15 characters): {bulkParse.invalid.slice(0, 5).join(', ')}
                      {bulkParse.invalid.length > 5 && ` and ${bulkParse.invalid.length - 5} more`}
                    </p>
                  )}
                  {bulkParse.valid.length > BULK_MAX_ITEMS && (
                    <p className="mt-2 rounded-lg bg-ember-500/10 p-3 font-body text-xs text-ember-600">
                      You can submit up to {BULK_MAX_ITEMS} tracking IDs at a time. Split the list and submit it in batches.
                    </p>
                  )}
                </>
              )}

              <ConsentCheckbox checked={consent} onChange={setConsent} />

              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="rounded-full bg-gold-500/15 px-4 py-2 text-center font-body text-sm font-bold text-gold-700">
                  {mode === 'bulk'
                    ? `Total: ${money(bulkTotal)} (${bulkParse.valid.length} × ${money(price)})`
                    : `Service cost: ${money(price)}`}
                </span>
                <button disabled={busy || !consent || (mode === 'bulk' && !bulkReady)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gold-500 px-6 py-3 font-display font-semibold text-ink disabled:opacity-60 sm:w-auto">
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
                setTrackingId('');
              }}
            />
          )}

          <TicketTrackingTable
            tickets={tickets}
            loading={loadingTickets}
            checkingId={checkingId}
            onCheck={checkTicketRow}
            search={ticketSearch}
            onSearchChange={setTicketSearch}
            serviceLabel="IPE Clearance"
            emptyMessage="No IPE Clearance requests found."
          />
        </section>
      </div>

      <PinConfirmDialog open={showPin} onClose={() => setShowPin(false)} onVerified={submit} />
    </AppShell>
  );
}
