import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Loader2, PenLine, Upload } from 'lucide-react';
import AppShell from '../components/AppShell';
import { api, ApiError } from '../lib/api';
import { PinConfirmDialog } from '../components/PinConfirmDialog';
import { ModificationConsent } from '../components/ModificationConsent';

type FieldInput = 'text' | 'date' | 'phone' | 'nin' | 'select' | 'document';
type Field = { key: string; label: string; required: boolean; input: FieldInput; options: string[] | null };
type TypeConfig = { id: string; title: string; fields: Field[] };
type PriceRow = { type: string; title: string; unitPrice: number; isActive: boolean };
type HistoryEntry = { reference: string; status: string; created_at: string; pdf_base64: string | null; modification_type: string | null };

const money = (amount?: number) =>
  amount === undefined ? '…' : `₦${amount.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

// Order matches techhubltd.co/nin_modifications.php's own 2-row grid - "I
// wanted this the same" (see the screenshots this page was built from).
const TYPE_ORDER = ['update_name', 'update_phone', 'update_dob', 'update_address', 'update_name_dob', 'update_name_phone'];

export default function NinModificationPage() {
  const nav = useNavigate();
  const [consent, setConsent] = useState(true);
  const [types, setTypes] = useState<TypeConfig[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [documentName, setDocumentName] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [reference, setReference] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get<{ data: TypeConfig[] }>('/nin-modification/types'),
      api.get<{ data: PriceRow[] }>('/nin-modification/prices'),
    ])
      .then(([typesRes, pricesRes]) => {
        const ordered = [...typesRes.data].sort((a, b) => TYPE_ORDER.indexOf(a.id) - TYPE_ORDER.indexOf(b.id));
        setTypes(ordered);
        setPrices(Object.fromEntries(pricesRes.data.map((row) => [row.type, row.unitPrice])));
      })
      .catch(() => setMessage('Unable to load modification types. Please refresh and try again.'));
  }, []);

  const selected = useMemo(() => types.find((t) => t.id === selectedType) ?? null, [types, selectedType]);
  const selectedPrice = selectedType ? prices[selectedType] : undefined;

  function pickType(id: string) {
    setSelectedType(id);
    setValues({});
    setDocumentName('');
    setMessage('');
    setReference('');
  }

  async function loadHistory(type: string) {
    setLoadingHistory(true);
    try {
      const result = await api.get<{ data: HistoryEntry[] }>(`/nin-modification/history?type=${encodeURIComponent(type)}`);
      setHistory(result.data ?? []);
    } catch {
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }

  useEffect(() => {
    if (selectedType) void loadHistory(selectedType);
    else setHistory([]);
  }, [selectedType]);

  async function handleDocument(file: File | undefined) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setMessage('That file is too large - please keep supporting documents under 5MB.');
      return;
    }
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsDataURL(file);
    });
    setValues((v) => ({ ...v, document_base64: base64 }));
    setDocumentName(file.name);
  }

  function prepare(event: FormEvent) {
    event.preventDefault();
    setShowPin(true);
  }

  async function submit(pin: string) {
    if (!selected) return;
    setShowPin(false);
    setBusy(true);
    setMessage('');
    try {
      const body: Record<string, string> = { ...values, pin };
      const result = await api.post<{ status: boolean; message: string; data: { reference: string } }>(
        `/nin-modification/${selected.id}/submit`,
        body
      );
      setReference(result.data.reference);
      setMessage(result.message);
      setValues({});
      setDocumentName('');
      void loadHistory(selected.id);
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Request failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="verification-blue-page mx-auto max-w-5xl">
        <button
          onClick={() => (selected ? setSelectedType(null) : nav('/nin-services'))}
          className="font-body text-sm font-semibold text-gold-700"
        >
          ← {selected ? 'All modification types' : 'NIN Services'}
        </button>

        <header className="mt-5 rounded-2xl border border-parchment-line bg-parchment p-6">
          <p className="font-body text-sm font-semibold text-gold-700">Identity services</p>
          <h1 className="mt-1 font-display text-3xl font-bold text-ink">NIN Modification</h1>
          <p className="mt-2 font-body text-sm text-ink-600">
            Update your National Identity Number (NIN) information. Select the type of modification you need and provide
            the required details. Requests are reviewed and processed by an agent - this is not an instant, automatic
            update.
          </p>
        </header>

        {!selected ? (
          <section className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {types.map((type) => (
              <button
                key={type.id}
                onClick={() => pickType(type.id)}
                className="group flex min-h-32 flex-col items-center justify-center rounded-2xl border border-[#8b6914] bg-[#6b4f0b] p-4 text-center shadow-md shadow-[#6b4f0b]/20 transition hover:-translate-y-1 hover:bg-[#8a6712] hover:shadow-lg"
              >
                <span className="rounded-xl bg-[#f7d774] p-3 text-[#4a3505] shadow-sm">
                  <PenLine size={22} />
                </span>
                <span className="mt-3 font-body text-sm font-semibold text-white">{type.title}</span>
                <span className="mt-1 font-body text-sm font-bold text-[#ffe9a3]">{money(prices[type.id])}</span>
              </button>
            ))}
          </section>
        ) : (
          <section className="mt-6 rounded-2xl border border-parchment-line bg-parchment p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-xl font-bold text-ink">{selected.title}</h2>
              <span className="rounded-full bg-gold-500/15 px-4 py-2 font-body text-sm font-bold text-gold-700">
                Service cost: {money(selectedPrice)}
              </span>
            </div>

            {!reference ? (
              <form onSubmit={prepare} className="mt-5 grid gap-4 sm:grid-cols-2">
                {selected.fields.map((field) => (
                  <label
                    key={field.key}
                    className={`font-body text-sm font-medium text-ink-600 ${field.input === 'document' ? 'sm:col-span-2' : ''}`}
                  >
                    {field.label}
                    {!field.required && <span className="ml-1 text-xs font-normal text-ink-400">(optional)</span>}
                    {field.input === 'select' ? (
                      <select
                        required={field.required}
                        className="mt-1 w-full rounded-xl border border-parchment-line bg-cream p-3 text-ink outline-none focus:border-gold-500"
                        value={values[field.key] ?? ''}
                        onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                      >
                        <option value="">Select {field.label}</option>
                        {(field.options ?? []).map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : field.input === 'document' ? (
                      <div className="mt-1 flex items-center gap-3 rounded-xl border border-dashed border-parchment-line bg-cream p-3">
                        <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-gold-500/15 px-3 py-2 text-xs font-semibold text-gold-700">
                          <Upload size={14} />
                          Select Document (Optional)
                          <input
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png"
                            className="hidden"
                            onChange={(e) => void handleDocument(e.target.files?.[0])}
                          />
                        </label>
                        <span className="font-body text-xs text-ink-400">{documentName || 'No file chosen'}</span>
                      </div>
                    ) : (
                      <input
                        required={field.required}
                        type={field.input === 'date' ? 'date' : field.input === 'phone' || field.input === 'nin' ? 'tel' : 'text'}
                        inputMode={field.input === 'phone' || field.input === 'nin' ? 'numeric' : undefined}
                        maxLength={field.input === 'phone' || field.input === 'nin' ? 11 : undefined}
                        className="mt-1 w-full rounded-xl border border-parchment-line bg-cream p-3 text-ink outline-none focus:border-gold-500"
                        value={values[field.key] ?? ''}
                        onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                      />
                    )}
                  </label>
                ))}

                <div className="sm:col-span-2">
                  <button
                    disabled={busy}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-gold-500 py-3 font-display font-semibold text-ink disabled:opacity-60"
                  >
                    {busy ? <Loader2 size={16} className="animate-spin" /> : 'Continue to PIN confirmation'}
                  </button>
                  {message && <p className="mt-3 rounded-lg bg-cream p-3 font-body text-sm text-ink-600">{message}</p>}
                </div>
              </form>
            ) : (
              <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center">
                <p className="font-body text-sm font-semibold text-emerald-800">{message}</p>
                <p className="mt-1 font-body text-xs text-emerald-700">Reference: {reference}</p>
                <button
                  onClick={() => setReference('')}
                  className="mt-4 rounded-xl bg-gold-500 px-5 py-2.5 font-display text-sm font-semibold text-ink"
                >
                  Submit another request
                </button>
              </div>
            )}

            <div className="mt-8">
              <h3 className="font-body text-sm font-semibold text-ink-600">Recent requests</h3>
              {loadingHistory ? (
                <p className="mt-2 font-body text-xs text-ink-400">Loading…</p>
              ) : history.length === 0 ? (
                <p className="mt-2 font-body text-xs text-ink-400">No requests yet for this type.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {history.map((entry) => (
                    <li
                      key={entry.reference}
                      className="flex items-center justify-between rounded-xl border border-parchment-line bg-cream p-3 font-body text-xs text-ink-600"
                    >
                      <span>
                        {entry.reference} · {new Date(entry.created_at).toLocaleString()} ·{' '}
                        <span
                          className={
                            entry.status === 'success'
                              ? 'font-semibold text-emerald-700'
                              : entry.status === 'failed'
                                ? 'font-semibold text-rose-600'
                                : 'font-semibold text-amber-600'
                          }
                        >
                          {entry.status === 'pending' ? 'Under review' : entry.status}
                        </span>
                      </span>
                      {entry.pdf_base64 && (
                        <a
                          href={`data:application/pdf;base64,${entry.pdf_base64}`}
                          download={`${entry.reference}.pdf`}
                          className="flex items-center gap-1 font-semibold text-gold-700"
                        >
                          <Download size={12} /> PDF
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}
      </div>

      <ModificationConsent
        open={consent}
        onAgree={() => setConsent(false)}
        onClose={() => nav('/nin-services')}
      />
      <PinConfirmDialog open={showPin} onClose={() => setShowPin(false)} onVerified={submit} />
    </AppShell>
  );
}
