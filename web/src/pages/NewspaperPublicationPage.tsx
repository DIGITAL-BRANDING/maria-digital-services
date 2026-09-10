import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Loader2 } from 'lucide-react';
import AppShell from '../components/AppShell';
import { api, ApiError } from '../lib/api';
import { PinConfirmDialog } from '../components/PinConfirmDialog';
import { PageHeader, FORM_SECTION_CLASSES, FORM_INPUT_CLASSES, FORM_LABEL_CLASSES, FORM_HELP_CLASSES, money } from '../components/verification/shared';

type Field = { key: string; label: string; required: boolean };
type HistoryEntry = { reference: string; status: string; created_at: string; pdf_base64: string | null };

// Only one real service exists today ("Name only or Name & DoB Publication"),
// but the reference design still gates the form behind a native <select>
// "Choose Service" dropdown rather than showing the fields immediately -
// this mirrors that exact UX (see the reference screenshots).
const SERVICE_OPTION_VALUE = 'name_or_name_dob';

export default function NewspaperPublicationPage() {
  const nav = useNavigate();
  const [fields, setFields] = useState<Field[]>([]);
  const [price, setPrice] = useState<number | undefined>(undefined);
  const [selectedService, setSelectedService] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [reference, setReference] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  useEffect(() => {
    Promise.all([api.get<{ data: Field[] }>('/newspaper-publication/fields'), api.get<{ data: { unit_price: number } }>('/newspaper-publication/price')])
      .then(([fieldsRes, priceRes]) => {
        setFields(fieldsRes.data);
        setPrice(priceRes.data.unit_price);
      })
      .catch(() => setMessage('Unable to load this form. Please refresh and try again.'));
    loadHistory();
  }, []);

  async function loadHistory() {
    setLoadingHistory(true);
    try {
      const result = await api.get<{ data: HistoryEntry[] }>('/newspaper-publication/history');
      setHistory(result.data ?? []);
    } catch {
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }

  function prepare(event: FormEvent) {
    event.preventDefault();
    if (!confirmed) {
      setMessage('Please confirm the details and affidavit are correct before continuing.');
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
      const body: Record<string, string> = { ...values, pin };
      const result = await api.post<{ status: boolean; message: string; data: { reference: string } }>('/newspaper-publication/submit', body);
      setReference(result.data.reference);
      setMessage(result.message);
      setValues({});
      setConfirmed(false);
      void loadHistory();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Request failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const oldFields = fields.filter((f) => f.key.startsWith('old_'));
  const newFields = fields.filter((f) => f.key.startsWith('new_'));

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl">
        <button onClick={() => nav('/dashboard')} className="font-body text-sm font-semibold text-[#0b2f73]">
          ← Dashboard
        </button>

        <PageHeader title="Newspaper Publication" subtitle="Submit newspaper name change requests and download completed publication files." />

        <section className={FORM_SECTION_CLASSES}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-lg font-bold text-[#0b2f73]">Name only or Name &amp; DoB Publication</h2>
            <span className="rounded-full bg-gold-500/15 px-4 py-2 font-body text-sm font-bold text-gold-700">Service cost: {money(price)}</span>
          </div>
          <p className={`mt-1 ${FORM_HELP_CLASSES}`}>BluePrint or DailyTrust only. Submit before 5:30pm Monday to Friday only. Duration is 20hrs.</p>

          {!reference ? (
            <div className="mt-5">
              <label className={FORM_LABEL_CLASSES}>
                Choose Service:
                <select
                  className={`mt-1 ${FORM_INPUT_CLASSES}`}
                  value={selectedService}
                  onChange={(e) => setSelectedService(e.target.value)}
                >
                  <option value="">-- Select Service --</option>
                  <option value={SERVICE_OPTION_VALUE}>
                    Name only or Name &amp; DoB Publication (BluePrint or DailyTrust only) Submit bfre 5:30pm Monday to Fri. only. Duration is 20hrs ({money(price)})
                  </option>
                </select>
              </label>

              {selectedService === SERVICE_OPTION_VALUE && (
                <form onSubmit={prepare} className="mt-6 space-y-6">
                  <div>
                    <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-[#0b2f73]/70">Old Details</h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {oldFields.map((field) => (
                        <label key={field.key} className={FORM_LABEL_CLASSES}>
                          {field.label}
                          {!field.required && <span className="ml-1 text-xs font-normal text-[#0b2f73]/40">(optional)</span>}
                          <input
                            required={field.required}
                            className={`mt-1 ${FORM_INPUT_CLASSES}`}
                            value={values[field.key] ?? ''}
                            onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                          />
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-[#0b2f73]/70">New Details</h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {newFields.map((field) => (
                        <label key={field.key} className={FORM_LABEL_CLASSES}>
                          {field.label}
                          {!field.required && <span className="ml-1 text-xs font-normal text-[#0b2f73]/40">(optional)</span>}
                          <input
                            required={field.required}
                            className={`mt-1 ${FORM_INPUT_CLASSES}`}
                            value={values[field.key] ?? ''}
                            onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                          />
                        </label>
                      ))}
                    </div>
                  </div>

                  <label className="flex items-start gap-2 font-body text-sm text-[#0b2f73]">
                    <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                    I confirm that the newspaper publication details and affidavit are correct.
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
              )}
            </div>
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
