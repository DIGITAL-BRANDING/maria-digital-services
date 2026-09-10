import { useState, type FormEvent, Fragment } from 'react';
import { Loader2, RefreshCw, Eye, EyeOff } from 'lucide-react';
import AppShell from '../../components/AppShell';
import { api, ApiError } from '../../lib/api';
import { PinConfirmDialog } from '../../components/PinConfirmDialog';
import {
  PageHeader,
  StatusBadge,
  money,
  useVerificationPrices,
  useServiceTickets,
  FORM_SECTION_CLASSES,
  FORM_INPUT_CLASSES,
  FORM_LABEL_CLASSES,
} from '../../components/verification/shared';

type ServiceOption = 'recover' | 'unlink';
const SERVICE_KEY = 'NIN_DELINKING';

export default function DelinkPage() {
  const { prices } = useVerificationPrices();
  const { tickets, loading: loadingTickets, refresh } = useServiceTickets(SERVICE_KEY);

  const [option, setOption] = useState<ServiceOption | ''>('');
  const [nin, setNin] = useState('');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  function prepare(event: FormEvent) {
    event.preventDefault();
    // "Recover Email" isn't wired to a provider yet - see the note below the
    // dropdown - so the form can't be submitted for that option.
    if (option !== 'unlink') return;
    setShowPin(true);
  }

  async function submit(pin: string) {
    setShowPin(false);
    setBusy(true);
    setMessage('');
    try {
      const result = await api.post<{ status: boolean; message?: string; data?: { reference: string } }>('/verification/delinking', {
        nin,
        email,
        pin
      });
      if (!result.status) throw new Error(result.message);
      setMessage(`Request submitted — reference ${result.data?.reference}. Track its progress below.`);
      setOption('');
      setNin('');
      setEmail('');
      setConsent(false);
      void refresh();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  }

  async function checkStatus(ticketId: string | null) {
    if (!ticketId) return;
    setCheckingId(ticketId);
    try {
      await api.get(`/verification/delinking/${ticketId}`);
    } catch {
      // status check failures are transient - the row just won't have updated this time
    } finally {
      setCheckingId(null);
      void refresh();
    }
  }

  const filtered = tickets.filter((t) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return t.reference.toLowerCase().includes(q) || (t.nin ?? '').includes(q) || t.status.includes(q);
  });

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl">
        <PageHeader title="NIMC Self-Service (Email)" subtitle="Recover or unlink the email address tied to a NIN on the NIMC self-service portal." />

        <section className={FORM_SECTION_CLASSES}>
          <form onSubmit={prepare}>
            <label className={FORM_LABEL_CLASSES}>
              Choose Service
              <select
                required
                value={option}
                onChange={(e) => {
                  setOption(e.target.value as ServiceOption | '');
                  setMessage('');
                }}
                className={`mt-1 ${FORM_INPUT_CLASSES}`}
              >
                <option value="">-- Select Service --</option>
                <option value="recover">Recover Email ({money(prices['NIN_EMAIL_RECOVERY'])})</option>
                <option value="unlink">Unlink Email ({money(prices[SERVICE_KEY])})</option>
              </select>
            </label>

            {option === 'recover' && (
              <>
                <label className={`mt-4 block ${FORM_LABEL_CLASSES}`}>
                  NIN Number
                  <input required inputMode="numeric" maxLength={11} placeholder="Enter your 11-digit NIN" className={`mt-1 ${FORM_INPUT_CLASSES}`} value={nin} onChange={(e) => setNin(e.target.value)} />
                  <span className="mt-1 block font-body text-xs text-[#0b2f73]/70">Enter your 11-digit NIN (e.g., 12345678901)</span>
                </label>
                <p className="mt-3 rounded-lg border border-dashed border-blue-200 bg-blue-50 p-3 font-body text-xs text-[#0b2f73]/80">
                  Email recovery isn't available through this portal yet — our provider doesn't offer this lookup. Please contact support directly for help recovering a lost NIMC
                  self-service email.
                </p>
              </>
            )}

            {option === 'unlink' && (
              <>
                <label className={`mt-4 block ${FORM_LABEL_CLASSES}`}>
                  NIN Number
                  <input required inputMode="numeric" maxLength={11} placeholder="Enter your 11-digit NIN" className={`mt-1 ${FORM_INPUT_CLASSES}`} value={nin} onChange={(e) => setNin(e.target.value)} />
                  <span className="mt-1 block font-body text-xs text-[#0b2f73]/70">Enter your 11-digit NIN (e.g., 12345678901)</span>
                </label>
                <label className={`mt-4 block ${FORM_LABEL_CLASSES}`}>
                  Email Address <span className="text-ember-500">*</span>
                  <input required type="email" placeholder="Enter your email address" className={`mt-1 ${FORM_INPUT_CLASSES}`} value={email} onChange={(e) => setEmail(e.target.value)} />
                  <span className="mt-1 block font-body text-xs text-[#0b2f73]/70">Email is required for unlinking process</span>
                </label>
              </>
            )}

            <label className="mt-5 flex items-start gap-2 font-body text-xs text-[#0b2f73]/80">
              <input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 rounded border-blue-300 text-[#0b2f73] focus:ring-[#0b2f73]" />
              I confirm the ID owner granted consent.
            </label>

            <button
              disabled={busy || !consent || option !== 'unlink'}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#0b2f73] px-6 py-3 font-display font-semibold text-white disabled:opacity-60"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : 'Submit Request'}
            </button>
            {message && <p className="mt-3 rounded-lg bg-blue-50 p-3 font-body text-sm text-[#0b2f73]">{message}</p>}
          </form>

          <div className="mt-8 border-t border-blue-100 pt-5">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input placeholder="Search by Reference ID or NIN..." value={search} onChange={(e) => setSearch(e.target.value)} className={FORM_INPUT_CLASSES} />
              <button type="button" onClick={() => void refresh()} className="flex items-center justify-center gap-2 rounded-xl bg-[#0b2f73] px-5 py-3 font-body text-sm font-bold text-white sm:w-auto">
                <RefreshCw size={14} /> Search
              </button>
            </div>

            {loadingTickets ? (
              <p className="mt-4 font-body text-sm text-[#0b2f73]/70">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="mt-4 rounded-xl border border-dashed border-blue-200 px-4 py-4 text-center font-body text-sm text-[#0b2f73]/70">No unlinking requests found.</p>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-xl border border-blue-100 bg-blue-50">
                <table className="w-full text-left font-body text-xs">
                  <thead>
                    <tr className="border-b border-blue-100 text-[#0b2f73]/70">
                      {['Check', 'View', 'NIN', 'Type', 'Status', 'Amount', 'Date'].map((h) => (
                        <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((t) => (
                      <Fragment key={t.reference}>
                        <tr className="border-b border-blue-100 last:border-0">
                          <td className="whitespace-nowrap px-3 py-2">
                            {t.status === 'pending' ? (
                              <button
                                onClick={() => void checkStatus(t.ticket_id)}
                                disabled={checkingId === t.ticket_id}
                                className="flex items-center gap-1 rounded-lg bg-[#0b2f73] px-2 py-1.5 font-bold text-white disabled:opacity-60"
                              >
                                {checkingId === t.ticket_id ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                              </button>
                            ) : (
                              <span className="text-[#0b2f73]/40">—</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2">
                            <button onClick={() => setExpanded(expanded === t.reference ? null : t.reference)} className="flex items-center gap-1 text-[#0b2f73]">
                              {expanded === t.reference ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 font-mono text-[#0b2f73]">{t.nin ?? '—'}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-[#0b2f73]">Unlink Email</td>
                          <td className="whitespace-nowrap px-3 py-2">
                            <StatusBadge status={t.status} />
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-[#0b2f73]">{money(t.amount)}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-[#0b2f73]/70">{new Date(t.created_at).toLocaleDateString()}</td>
                        </tr>
                        {expanded === t.reference && (
                          <tr className="border-b border-blue-100 bg-white/40 last:border-0">
                            <td colSpan={7} className="px-3 py-2 text-[#0b2f73]/80">
                              Reference: <span className="font-mono">{t.reference}</span> · Email on file: <span className="font-mono">{t.email ?? '—'}</span> · {t.message}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>

      <PinConfirmDialog open={showPin} onClose={() => setShowPin(false)} onVerified={submit} />
    </AppShell>
  );
}
