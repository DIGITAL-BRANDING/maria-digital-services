import { useState, type FormEvent } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
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

const SERVICE_KEY = 'BVN_RETRIEVAL';

export default function BvnRetrievalPage() {
  const { prices } = useVerificationPrices();
  const { tickets, loading: loadingTickets, refresh } = useServiceTickets(SERVICE_KEY);

  const [chosen, setChosen] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  function prepare(event: FormEvent) {
    event.preventDefault();
    setShowPin(true);
  }

  async function submit(pin: string) {
    setShowPin(false);
    setBusy(true);
    setMessage('');
    try {
      const result = await api.post<{ status: boolean; message?: string; data?: { reference: string } }>('/verification/bvn-retrieval', {
        first_name: firstName,
        last_name: lastName,
        phone_number: phone,
        pin
      });
      if (!result.status) throw new Error(result.message);
      setMessage(`Request submitted — reference ${result.data?.reference}. Track its progress below.`);
      setChosen(false);
      setFirstName('');
      setLastName('');
      setPhone('');
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
      await api.get(`/verification/bvn-retrieval/${ticketId}`);
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
    return t.reference.toLowerCase().includes(q) || t.status.includes(q) || String(t.amount).includes(q);
  });

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl">
        <PageHeader title="BVN Retrieval" subtitle="Forgotten your BVN? We look it up with NIBSS using your name and registered phone number." />

        <section className={FORM_SECTION_CLASSES}>
          <form onSubmit={prepare}>
            <label className={FORM_LABEL_CLASSES}>
              Choose Service
              <select
                required
                value={chosen ? SERVICE_KEY : ''}
                onChange={(e) => setChosen(e.target.value === SERVICE_KEY)}
                className={`mt-1 ${FORM_INPUT_CLASSES}`}
              >
                <option value="">-- Select Service --</option>
                <option value={SERVICE_KEY}>BVN Retrieval (Within 2 working hours) ({money(prices[SERVICE_KEY])})</option>
              </select>
            </label>

            {chosen && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className={FORM_LABEL_CLASSES}>
                  First Name
                  <input required maxLength={100} className={`mt-1 ${FORM_INPUT_CLASSES}`} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </label>
                <label className={FORM_LABEL_CLASSES}>
                  Last Name
                  <input required maxLength={100} className={`mt-1 ${FORM_INPUT_CLASSES}`} value={lastName} onChange={(e) => setLastName(e.target.value)} />
                </label>
                <label className={`sm:col-span-2 ${FORM_LABEL_CLASSES}`}>
                  Registered Phone Number
                  <input required inputMode="numeric" maxLength={11} placeholder="08012345678" className={`mt-1 ${FORM_INPUT_CLASSES}`} value={phone} onChange={(e) => setPhone(e.target.value)} />
                </label>
              </div>
            )}

            <label className="mt-5 flex items-start gap-2 font-body text-xs text-[#0b2f73]/80">
              <input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 rounded border-blue-300 text-[#0b2f73] focus:ring-[#0b2f73]" />
              I confirm the ID owner granted consent to retrieve this information.
            </label>

            <button disabled={busy || !consent || !chosen} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#0b2f73] px-6 py-3 font-display font-semibold text-white disabled:opacity-60">
              {busy ? <Loader2 size={16} className="animate-spin" /> : 'Submit Request'}
            </button>
            {message && <p className="mt-3 rounded-lg bg-blue-50 p-3 font-body text-sm text-[#0b2f73]">{message}</p>}
          </form>

          <div className="mt-8 border-t border-blue-100 pt-5">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input placeholder="Search by Reference ID or Details..." value={search} onChange={(e) => setSearch(e.target.value)} className={FORM_INPUT_CLASSES} />
              <button type="button" onClick={() => void refresh()} className="flex items-center justify-center gap-2 rounded-xl bg-[#0b2f73] px-5 py-3 font-body text-sm font-bold text-white sm:w-auto">
                <RefreshCw size={14} /> Search
              </button>
            </div>

            {loadingTickets ? (
              <p className="mt-4 font-body text-sm text-[#0b2f73]/70">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="mt-4 rounded-xl border border-dashed border-blue-200 px-4 py-4 text-center font-body text-sm text-[#0b2f73]/70">No BVN retrieval requests found.</p>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-xl border border-blue-100 bg-blue-50">
                <table className="w-full text-left font-body text-xs">
                  <thead>
                    <tr className="border-b border-blue-100 text-[#0b2f73]/70">
                      {['ID', 'Message', 'Amount', 'Status', 'Date', 'Action'].map((h) => (
                        <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((t) => (
                      <tr key={t.reference} className="border-b border-blue-100 last:border-0">
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-[#0b2f73]">{t.reference}</td>
                        <td className="px-3 py-2 text-[#0b2f73]/70">{t.message}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-[#0b2f73]">{money(t.amount)}</td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <StatusBadge status={t.status} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-[#0b2f73]/70">{new Date(t.created_at).toLocaleDateString()}</td>
                        <td className="whitespace-nowrap px-3 py-2">
                          {t.status === 'pending' ? (
                            <button
                              onClick={() => void checkStatus(t.ticket_id)}
                              disabled={checkingId === t.ticket_id}
                              className="flex items-center gap-1 rounded-lg bg-[#0b2f73] px-2 py-1.5 font-bold text-white disabled:opacity-60"
                            >
                              {checkingId === t.ticket_id ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Check
                            </button>
                          ) : (
                            <span className="text-[#0b2f73]/40">—</span>
                          )}
                        </td>
                      </tr>
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
