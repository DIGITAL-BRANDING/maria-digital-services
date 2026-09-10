import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Loader2 } from 'lucide-react';
import AppShell from '../components/AppShell';
import { api, ApiError } from '../lib/api';
import { PinConfirmDialog } from '../components/PinConfirmDialog';
import { PageHeader, FORM_SECTION_CLASSES, FORM_INPUT_CLASSES, FORM_LABEL_CLASSES, FORM_HELP_CLASSES, money } from '../components/verification/shared';

type HistoryEntry = { reference: string; status: string; created_at: string; pdf_base64: string | null };

export default function BvnCrmPage() {
  const nav = useNavigate();
  const [price, setPrice] = useState<number | undefined>(undefined);
  const [ticketId, setTicketId] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [reference, setReference] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  useEffect(() => {
    api
      .get<{ data: { unit_price: number } }>('/bvn-crm/price')
      .then((res) => setPrice(res.data.unit_price))
      .catch(() => setMessage('Unable to load this form. Please refresh and try again.'));
    loadHistory();
  }, []);

  async function loadHistory() {
    setLoadingHistory(true);
    try {
      const result = await api.get<{ data: HistoryEntry[] }>('/bvn-crm/history');
      setHistory(result.data ?? []);
    } catch {
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }

  function prepare(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{8}$/.test(ticketId.trim())) {
      setMessage('Please enter a valid 8-digit TicketID.');
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
      const result = await api.post<{ status: boolean; message: string; data: { reference: string } }>('/bvn-crm/submit', {
        ticket_id: ticketId.trim(),
        pin
      });
      setReference(result.data.reference);
      setMessage(result.message);
      setTicketId('');
      void loadHistory();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Request failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl">
        <button onClick={() => nav('/dashboard')} className="font-body text-sm font-semibold text-[#0b2f73]">
          ← Dashboard
        </button>

        <PageHeader title="BVN CRM" subtitle="Submit your BVN CRM TicketID for follow-up. Requests are reviewed and processed by an agent." />

        <section className={FORM_SECTION_CLASSES}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-lg font-bold text-[#0b2f73]">BVN CRM Ticket Follow-up</h2>
            <span className="rounded-full bg-gold-500/15 px-4 py-2 font-body text-sm font-bold text-gold-700">Service cost: {money(price)}</span>
          </div>
          <p className={`mt-1 ${FORM_HELP_CLASSES}`}>Your request will be processed within 24 - 48hrs.</p>

          {!reference ? (
            <form onSubmit={prepare} className="mt-5 space-y-6">
              <label className={FORM_LABEL_CLASSES}>
                Submit your 8 DIGITS TicketID looks like: 88248XXX
                <input
                  required
                  type="tel"
                  inputMode="numeric"
                  maxLength={8}
                  placeholder="e.g. 88248XXX"
                  className={`mt-1 ${FORM_INPUT_CLASSES}`}
                  value={ticketId}
                  onChange={(e) => setTicketId(e.target.value.replace(/\D/g, '').slice(0, 8))}
                />
              </label>

              <div>
                <button
                  disabled={busy}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0b2f73] py-3 font-display font-semibold text-white disabled:opacity-60"
                >
                  {busy ? <Loader2 size={16} className="animate-spin" /> : 'Submit'}
                </button>
                {message && <p className="mt-3 rounded-lg bg-blue-50 p-3 font-body text-sm text-[#0b2f73]">{message}</p>}
              </div>
            </form>
          ) : (
            <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center">
              <p className="font-body text-sm font-semibold text-emerald-800">{message}</p>
              <p className="mt-1 font-body text-xs text-emerald-700">Reference: {reference}</p>
              <button onClick={() => setReference('')} className="mt-4 rounded-xl bg-[#0b2f73] px-5 py-2.5 font-display text-sm font-semibold text-white">
                Submit another request
              </button>
            </div>
          )}

          <div className="mt-8">
            <h3 className={FORM_LABEL_CLASSES}>Recent requests</h3>
            {loadingHistory ? (
              <p className={`mt-2 ${FORM_HELP_CLASSES}`}>Loading…</p>
            ) : history.length === 0 ? (
              <p className={`mt-2 ${FORM_HELP_CLASSES}`}>No requests yet.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {history.map((entry) => (
                  <li key={entry.reference} className="flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50 p-3 font-body text-xs text-[#0b2f73]">
                    <span>
                      {entry.reference} · {new Date(entry.created_at).toLocaleString()} ·{' '}
                      <span
                        className={
                          entry.status === 'success' ? 'font-semibold text-emerald-700' : entry.status === 'failed' ? 'font-semibold text-rose-600' : 'font-semibold text-amber-600'
                        }
                      >
                        {entry.status === 'pending' ? 'Under review' : entry.status}
                      </span>
                    </span>
                    {entry.pdf_base64 && (
                      <a href={`data:application/pdf;base64,${entry.pdf_base64}`} download={`${entry.reference}.pdf`} className="flex items-center gap-1 font-semibold text-[#0b2f73]">
                        <Download size={12} /> PDF
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <PinConfirmDialog open={showPin} onClose={() => setShowPin(false)} onVerified={submit} />
    </AppShell>
  );
}
