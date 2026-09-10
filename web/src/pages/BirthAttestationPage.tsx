import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Download, Loader2 } from 'lucide-react';
import AppShell from '../components/AppShell';
import { api, ApiError } from '../lib/api';
import { PinConfirmDialog } from '../components/PinConfirmDialog';
import { PageHeader, FORM_SECTION_CLASSES, FORM_INPUT_CLASSES, FORM_LABEL_CLASSES, FORM_HELP_CLASSES, money } from '../components/verification/shared';

type FieldInput = 'text' | 'date' | 'nin' | 'select' | 'image';
type Field = { key: string; label: string; required: boolean; input: FieldInput; options: string[] | null; section: string | null };
type HistoryEntry = { reference: string; status: string; created_at: string; pdf_base64: string | null };

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB raw file - keeps the base64'd body comfortably under the backend's 8mb JSON limit

// Only one real service exists today ("NPC Birth Attestation & Instant
// approval"), but the reference design still gates the form behind a
// native <select> "Choose Service" dropdown, and shows a red NOTE banner
// once that one option is picked - this mirrors that exact UX (see the
// reference screenshots).
const SERVICE_OPTION_VALUE = 'npc_birth_attestation';

function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

export default function BirthAttestationPage() {
  const nav = useNavigate();
  const [fields, setFields] = useState<Field[]>([]);
  const [price, setPrice] = useState<number | undefined>(undefined);
  const [selectedService, setSelectedService] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [imageErrors, setImageErrors] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [reference, setReference] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  useEffect(() => {
    Promise.all([api.get<{ data: Field[] }>('/birth-attestation/fields'), api.get<{ data: { unit_price: number } }>('/birth-attestation/price')])
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
      const result = await api.get<{ data: HistoryEntry[] }>('/birth-attestation/history');
      setHistory(result.data ?? []);
    } catch {
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }

  const sections = useMemo(() => {
    const order: string[] = [];
    const byName: Record<string, Field[]> = {};
    for (const field of fields) {
      const name = field.section ?? '';
      if (!byName[name]) {
        byName[name] = [];
        order.push(name);
      }
      byName[name].push(field);
    }
    return order.map((name) => ({ name, fields: byName[name] }));
  }, [fields]);

  async function handleImageSelect(fieldKey: string, file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setImageErrors((e) => ({ ...e, [fieldKey]: 'Please choose an image file (PNG, JPEG, or WEBP).' }));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageErrors((e) => ({ ...e, [fieldKey]: 'That photo is too large - please use one under 4MB.' }));
      return;
    }
    try {
      const dataUrl = await readImageAsDataUrl(file);
      setValues((v) => ({ ...v, [fieldKey]: dataUrl }));
      setImageErrors((e) => ({ ...e, [fieldKey]: '' }));
    } catch {
      setImageErrors((e) => ({ ...e, [fieldKey]: 'Could not read that file - please try again.' }));
    }
  }

  function prepare(event: FormEvent) {
    event.preventDefault();
    if (!consent) {
      setMessage('Please check the consent box before continuing.');
      return;
    }
    const missingImage = fields.find((f) => f.input === 'image' && f.required && !values[f.key]);
    if (missingImage) {
      setMessage(`Please attach a photo for "${missingImage.label}" before continuing.`);
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
      const result = await api.post<{ status: boolean; message: string; data: { reference: string } }>('/birth-attestation/submit', body);
      setReference(result.data.reference);
      setMessage(result.message);
      setValues({});
      setConsent(false);
      void loadHistory();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Request failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl">
        <button onClick={() => nav('/dashboard')} className="font-body text-sm font-semibold text-[#0b2f73]">
          ← Dashboard
        </button>

        <PageHeader
          title="Birth Attestation"
          subtitle="NPC Birth Attestation & Instant approval. Requests are reviewed and processed by an agent."
        />

        <section className={FORM_SECTION_CLASSES}>
          <label className={FORM_LABEL_CLASSES}>
            Choose Service:
            <select
              className={`mt-1 ${FORM_INPUT_CLASSES}`}
              value={selectedService}
              onChange={(e) => setSelectedService(e.target.value)}
            >
              <option value="">-- Select Service --</option>
              <option value={SERVICE_OPTION_VALUE}>
                NPC Birth Attestation &amp; Instant approval (max. of 5 hrs) ({money(price)})
              </option>
            </select>
          </label>

          {selectedService === SERVICE_OPTION_VALUE && (
            <>
              <div className="mt-4 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4">
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-rose-600" />
                <div>
                  <p className="font-display text-sm font-bold text-rose-700">NOTE</p>
                  <p className="mt-0.5 font-body text-sm text-rose-700">
                    Dear customers, please be informed that only modifications between 1 day and 5 years are allowed.
                  </p>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-display text-lg font-bold text-[#0b2f73]">NPC Birth Attestation &amp; Instant approval</h2>
                <span className="rounded-full bg-gold-500/15 px-4 py-2 font-body text-sm font-bold text-gold-700">Service cost: {money(price)}</span>
              </div>

              {!reference ? (
                <form onSubmit={prepare} className="mt-5 space-y-8">
                  {sections.map((section) => (
                    <div key={section.name}>
                      {section.name && <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-[#0b2f73]/70">{section.name}</h3>}
                      <div className="grid gap-4 sm:grid-cols-2">
                        {section.fields.map((field) => (
                          <label key={field.key} className={field.input === 'image' ? `${FORM_LABEL_CLASSES} sm:col-span-2` : FORM_LABEL_CLASSES}>
                            {field.label}
                            {!field.required && <span className="ml-1 text-xs font-normal text-[#0b2f73]/40">(optional)</span>}
                            {field.input === 'select' ? (
                              <select
                                required={field.required}
                                className={`mt-1 ${FORM_INPUT_CLASSES}`}
                                value={values[field.key] ?? ''}
                                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                              >
                                <option value="">-- Select {field.label} --</option>
                                {field.options?.map((opt) => (
                                  <option key={opt} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
                            ) : field.input === 'image' ? (
                              <div className="mt-1">
                                {values[field.key] ? (
                                  <div className="flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 p-2">
                                    <img src={values[field.key]} alt={field.label} className="h-16 w-16 rounded-lg object-cover" />
                                    <div className="flex-1">
                                      <p className="font-body text-xs text-[#0b2f73]">Photo selected</p>
                                      <label className="cursor-pointer font-body text-xs font-semibold text-[#0b2f73] underline">
                                        Change photo
                                        <input
                                          type="file"
                                          accept="image/png,image/jpeg,image/webp"
                                          className="hidden"
                                          onChange={(e) => void handleImageSelect(field.key, e.target.files?.[0])}
                                        />
                                      </label>
                                    </div>
                                    <button type="button" onClick={() => setValues((v) => ({ ...v, [field.key]: '' }))} className="font-body text-xs font-semibold text-rose-600">
                                      Remove
                                    </button>
                                  </div>
                                ) : (
                                  <label className={`flex cursor-pointer items-center justify-center rounded-xl border border-dashed p-4 text-center ${FORM_INPUT_CLASSES}`}>
                                    <span className="font-body text-xs text-[#0b2f73]/70">Tap to take a photo or upload one from your device</span>
                                    <input
                                      required={field.required}
                                      type="file"
                                      accept="image/png,image/jpeg,image/webp"
                                      className="hidden"
                                      onChange={(e) => void handleImageSelect(field.key, e.target.files?.[0])}
                                    />
                                  </label>
                                )}
                                {imageErrors[field.key] && <p className="mt-1 font-body text-xs text-rose-600">{imageErrors[field.key]}</p>}
                              </div>
                            ) : (
                              <input
                                required={field.required}
                                type={field.input === 'date' ? 'date' : field.input === 'nin' ? 'tel' : 'text'}
                                inputMode={field.input === 'nin' ? 'numeric' : undefined}
                                maxLength={field.input === 'nin' ? 11 : undefined}
                                className={`mt-1 ${FORM_INPUT_CLASSES}`}
                                value={values[field.key] ?? ''}
                                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                              />
                            )}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}

                  <label className="flex items-start gap-2 font-body text-sm text-[#0b2f73]">
                    <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                    By checking this box, you agree that the owner of the ID has granted you consent to verify his/her identity.
                  </label>

                  <div>
                    <button
                      disabled={busy}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0b2f73] py-3 font-display font-semibold text-white disabled:opacity-60 sm:w-auto sm:px-8"
                    >
                      {busy ? <Loader2 size={16} className="animate-spin" /> : 'Continue to PIN confirmation'}
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
            </>
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
