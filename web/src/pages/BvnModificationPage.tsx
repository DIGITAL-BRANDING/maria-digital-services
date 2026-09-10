import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Download, HelpCircle, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import AppShell from '../components/AppShell';
import { api, ApiError } from '../lib/api';
import { PinConfirmDialog } from '../components/PinConfirmDialog';
import { BvnModificationConsent } from '../components/BvnModificationConsent';
import {
  PageHeader,
  FORM_SECTION_CLASSES,
  FORM_INPUT_CLASSES,
  FORM_LABEL_CLASSES,
  FORM_HELP_CLASSES,
  TILE_CLASSES,
  TILE_SELECTED_CLASSES,
  TILE_UNSELECTED_CLASSES,
  money,
} from '../components/verification/shared';

type FieldInput = 'text' | 'date' | 'phone' | 'email' | 'bvn' | 'nin' | 'image' | 'select';
type Field = { key: string; label: string; required: boolean; input: FieldInput; options?: string[]; dependsOn?: { key: string; value: string } };
type TypeConfig = { id: string; title: string; fields: Field[] };
type PriceRow = { type: string; title: string; unitPrice: number; isActive: boolean };
type HistoryEntry = { reference: string; status: string; created_at: string; pdf_base64: string | null; modification_type: string | null };
type MatchResult = {
  bvn_date_of_birth: string | null;
  nin_date_of_birth: string | null;
  comparable: boolean;
  dob_matches: boolean | null;
  suggested_types: string[];
};

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB raw file - keeps the base64'd body comfortably under the backend's 8mb JSON limit

function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

const TYPE_ORDER = [
  'update_name',
  'update_phone',
  'update_dob',
  'update_address',
  'update_name_dob',
  'update_name_phone',
  'update_name_address',
  'update_dob_phone'
];

type Stage = 'decide' | 'verify' | 'select' | 'form';

export default function BvnModificationPage() {
  const nav = useNavigate();
  const [consent, setConsent] = useState(true);
  const [stage, setStage] = useState<Stage>('decide');

  const [types, setTypes] = useState<TypeConfig[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [imageErrors, setImageErrors] = useState<Record<string, string>>({});
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [reference, setReference] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // "Not sure?" verify sub-flow
  const [verifyBvn, setVerifyBvn] = useState('');
  const [verifyNin, setVerifyNin] = useState('');
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState('');
  const [showVerifyPin, setShowVerifyPin] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get<{ data: TypeConfig[] }>('/bvn-modification/types'),
      api.get<{ data: PriceRow[] }>('/bvn-modification/prices')
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
    setImageErrors({});
    setMessage('');
    setReference('');
    setStage('form');
  }

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

  async function loadHistory(type: string) {
    setLoadingHistory(true);
    try {
      const result = await api.get<{ data: HistoryEntry[] }>(`/bvn-modification/history?type=${encodeURIComponent(type)}`);
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

  function prepareVerify(event: FormEvent) {
    event.preventDefault();
    setShowVerifyPin(true);
  }

  async function submitVerify(pin: string) {
    setShowVerifyPin(false);
    setVerifyBusy(true);
    setVerifyMessage('');
    try {
      const result = await api.post<{ status: boolean; message?: string; data: MatchResult }>('/bvn-modification/verify-match', {
        bvn: verifyBvn,
        nin: verifyNin,
        pin
      });
      setMatchResult(result.data);
    } catch (error) {
      setVerifyMessage(error instanceof ApiError ? error.message : 'Could not complete the check. Please try again.');
    } finally {
      setVerifyBusy(false);
    }
  }

  function prepare(event: FormEvent) {
    event.preventDefault();
    if (selected) {
      const missingImage = selected.fields.find(
        (f) => f.input === 'image' && f.required && (!f.dependsOn || values[f.dependsOn.key] === f.dependsOn.value) && !values[f.key]
      );
      if (missingImage) {
        setMessage(`Please attach a photo for "${missingImage.label}" before continuing.`);
        return;
      }
    }
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
        `/bvn-modification/${selected.id}/submit`,
        body
      );
      setReference(result.data.reference);
      setMessage(result.message);
      setValues({});
      void loadHistory(selected.id);
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Request failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl">
        <button
          onClick={() => {
            if (stage === 'form' || stage === 'select') return setStage('decide');
            if (stage === 'verify') return setStage('decide');
            nav('/bvn-services');
          }}
          className="font-body text-sm font-semibold text-[#0b2f73]"
        >
          ← {stage === 'decide' ? 'BVN Services' : 'Start over'}
        </button>

        <PageHeader
          title="BVN Modification"
          subtitle="Update your Bank Verification Number (BVN) information. Requests are reviewed and processed by an agent - this is not an instant, automatic update."
        />

        {stage === 'decide' && (
          <section className={FORM_SECTION_CLASSES}>
            <h2 className="font-display text-lg font-bold text-[#0b2f73]">Do you already know exactly what needs fixing?</h2>
            <p className={`mt-2 ${FORM_HELP_CLASSES}`}>
              A single BVN can need more than one correction at once (for example, both the name and the date of
              birth). If you're not certain, we can check your BVN and NIN records against each other first, so you
              don't submit the wrong type of request.
            </p>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <button
                onClick={() => setStage('select')}
                className={`${TILE_CLASSES} ${TILE_UNSELECTED_CLASSES} flex flex-col items-center gap-2 p-6`}
              >
                <CheckCircle2 size={28} />
                <span className="font-display text-base font-bold">I know exactly what to fix</span>
                <span className="text-xs text-white/80">Go straight to picking a modification type</span>
              </button>
              <button
                onClick={() => setStage('verify')}
                className={`${TILE_CLASSES} ${TILE_UNSELECTED_CLASSES} flex flex-col items-center gap-2 p-6`}
              >
                <HelpCircle size={28} />
                <span className="font-display text-base font-bold">I'm not sure — check first</span>
                <span className="text-xs text-white/80">Compare your BVN &amp; NIN date of birth</span>
              </button>
            </div>
          </section>
        )}

        {stage === 'verify' && (
          <section className={FORM_SECTION_CLASSES}>
            <h2 className="font-display text-lg font-bold text-[#0b2f73]">Check BVN &amp; NIN together</h2>
            <p className={`mt-2 ${FORM_HELP_CLASSES}`}>
              We'll pull your BVN slip and your NIN record and compare the date of birth on each. This uses the same
              BVN Verification and NIN Verification lookups as elsewhere in the app, so it's charged at their normal
              price — not an extra fee.
            </p>

            {!matchResult ? (
              <form onSubmit={prepareVerify} className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className={FORM_LABEL_CLASSES}>
                  BVN Number
                  <input required inputMode="numeric" maxLength={11} className={`mt-1 ${FORM_INPUT_CLASSES}`} value={verifyBvn} onChange={(e) => setVerifyBvn(e.target.value)} />
                </label>
                <label className={FORM_LABEL_CLASSES}>
                  NIN Number
                  <input required inputMode="numeric" maxLength={11} className={`mt-1 ${FORM_INPUT_CLASSES}`} value={verifyNin} onChange={(e) => setVerifyNin(e.target.value)} />
                </label>
                <div className="sm:col-span-2">
                  <button disabled={verifyBusy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0b2f73] py-3 font-display font-semibold text-white disabled:opacity-60 sm:w-auto sm:px-8">
                    {verifyBusy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                    Run the check
                  </button>
                  {verifyMessage && <p className="mt-3 rounded-lg bg-blue-50 p-3 font-body text-sm text-[#0b2f73]">{verifyMessage}</p>}
                </div>
              </form>
            ) : (
              <div className="mt-5">
                {!matchResult.comparable ? (
                  <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-600" />
                    <div>
                      <p className="font-body text-sm font-semibold text-amber-800">Couldn't compare automatically</p>
                      <p className="mt-1 font-body text-xs text-amber-700">
                        Both records were retrieved, but we couldn't find a recognisable date of birth field on one or
                        both. Please pick the modification type yourself below.
                      </p>
                    </div>
                  </div>
                ) : matchResult.dob_matches ? (
                  <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                    <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-emerald-600" />
                    <div>
                      <p className="font-body text-sm font-semibold text-emerald-800">Date of birth matches on both records</p>
                      <p className="mt-1 font-body text-xs text-emerald-700">
                        BVN: {matchResult.bvn_date_of_birth} · NIN: {matchResult.nin_date_of_birth}. Your date of birth
                        is not the issue — pick whichever other field needs correcting below.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4">
                    <XCircle size={20} className="mt-0.5 shrink-0 text-rose-600" />
                    <div>
                      <p className="font-body text-sm font-semibold text-rose-800">Date of birth does not match</p>
                      <p className="mt-1 font-body text-xs text-rose-700">
                        BVN: {matchResult.bvn_date_of_birth} · NIN: {matchResult.nin_date_of_birth}. You likely need a
                        Date of Birth correction — highlighted below.
                      </p>
                    </div>
                  </div>
                )}

                <button onClick={() => setStage('select')} className="mt-5 w-full rounded-xl bg-[#0b2f73] py-3 font-display font-semibold text-white sm:w-auto sm:px-8">
                  Continue to pick a modification type
                </button>
              </div>
            )}
          </section>
        )}

        {stage === 'select' && (
          <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {types.map((type) => {
              const suggested = matchResult?.suggested_types?.includes(type.id);
              return (
                <button
                  key={type.id}
                  onClick={() => pickType(type.id)}
                  className={`${TILE_CLASSES} ${suggested ? TILE_SELECTED_CLASSES : TILE_UNSELECTED_CLASSES} relative flex min-h-28 flex-col items-center justify-center text-center`}
                >
                  {suggested && <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-gold-400 px-2 py-0.5 text-[10px] font-bold text-[#4a3505]">Suggested</span>}
                  <span className="font-body text-sm font-semibold">{type.title}</span>
                  <span className="mt-1 text-xs font-bold text-gold-300">{money(prices[type.id])}</span>
                </button>
              );
            })}
          </section>
        )}

        {stage === 'form' && selected && (
          <section className={FORM_SECTION_CLASSES}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-xl font-bold text-[#0b2f73]">{selected.title}</h2>
              <span className="rounded-full bg-gold-500/15 px-4 py-2 font-body text-sm font-bold text-gold-700">
                Service cost: {money(selectedPrice)}
              </span>
            </div>

            {!reference ? (
              <form onSubmit={prepare} className="mt-5 grid gap-4 sm:grid-cols-2">
                {selected.fields.map((field) => {
                  if (field.dependsOn && values[field.dependsOn.key] !== field.dependsOn.value) return null;
                  return (
                    <label key={field.key} className={FORM_LABEL_CLASSES}>
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
                              <button
                                type="button"
                                onClick={() => setValues((v) => ({ ...v, [field.key]: '' }))}
                                className="font-body text-xs font-semibold text-rose-600"
                              >
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
                          type={field.input === 'date' ? 'date' : field.input === 'email' ? 'email' : field.input === 'phone' || field.input === 'bvn' || field.input === 'nin' ? 'tel' : 'text'}
                          inputMode={field.input === 'phone' || field.input === 'bvn' || field.input === 'nin' ? 'numeric' : undefined}
                          maxLength={field.input === 'phone' || field.input === 'bvn' || field.input === 'nin' ? 11 : undefined}
                          className={`mt-1 ${FORM_INPUT_CLASSES}`}
                          value={values[field.key] ?? ''}
                          onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                        />
                      )}
                    </label>
                  );
                })}

                <div className="sm:col-span-2">
                  <button
                    disabled={busy}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0b2f73] py-3 font-display font-semibold text-white disabled:opacity-60"
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
                <button
                  onClick={() => setReference('')}
                  className="mt-4 rounded-xl bg-[#0b2f73] px-5 py-2.5 font-display text-sm font-semibold text-white"
                >
                  Submit another request
                </button>
              </div>
            )}

            <div className="mt-8">
              <h3 className={FORM_LABEL_CLASSES}>Recent requests</h3>
              {loadingHistory ? (
                <p className={`mt-2 ${FORM_HELP_CLASSES}`}>Loading…</p>
              ) : history.length === 0 ? (
                <p className={`mt-2 ${FORM_HELP_CLASSES}`}>No requests yet for this type.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {history.map((entry) => (
                    <li key={entry.reference} className="flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50 p-3 font-body text-xs text-[#0b2f73]">
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
        )}
      </div>

      <PinConfirmDialog open={showVerifyPin} onClose={() => setShowVerifyPin(false)} onVerified={submitVerify} />
      <PinConfirmDialog open={showPin} onClose={() => setShowPin(false)} onVerified={submit} />
      <BvnModificationConsent open={consent} onAgree={() => setConsent(false)} onClose={() => nav('/bvn-services')} />
    </AppShell>
  );
}
