import { useEffect, useState, type FormEvent } from 'react';
import { Download, Loader2 } from 'lucide-react';
import AppShell from '../../components/AppShell';
import { api, ApiError } from '../../lib/api';
import { PinConfirmDialog } from '../../components/PinConfirmDialog';
import { PageHeader, FORM_SECTION_CLASSES, FORM_INPUT_CLASSES, FORM_LABEL_CLASSES, money } from '../../components/verification/shared';

const ZONES = ['North Central', 'North East', 'North West', 'South East', 'South South', 'South West'] as const;
const FLAT_PRICE = 10000; // Hardcoded server-side too (bvn-license-onboarding.service.ts) - not a ServicePricing row.

type FormState = {
  agent_location: string;
  bvn: string;
  nin: string;
  first_name: string;
  last_name: string;
  middle_name: string;
  phone_number: string;
  date_of_birth: string;
  email: string;
  alternative_email: string;
  account_number: string;
  bank_name: string;
  account_name: string;
  address: string;
  city: string;
  lga: string;
  state_of_residence: string;
  geo_political_zone: (typeof ZONES)[number] | '';
};

const EMPTY: FormState = {
  agent_location: '', bvn: '', nin: '', first_name: '', last_name: '', middle_name: '',
  phone_number: '', date_of_birth: '', email: '', alternative_email: '', account_number: '',
  bank_name: '', account_name: '', address: '', city: '', lga: '', state_of_residence: '', geo_political_zone: ''
};

type HistoryEntry = { reference: string; tracking_id: string | null; status: string; amount: number; pdf_base64: string | null; created_at: string };

export default function BvnLicensePage() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [consent, setConsent] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<{ reference: string; trackingId: string } | null>(null);

  function field<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function prepare(event: FormEvent) {
    event.preventDefault();
    setShowPin(true);
  }

  async function submit(pin: string) {
    setShowPin(false);
    setBusy(true);
    setMessage('');
    try {
      const body = { ...form, alternative_email: form.alternative_email || undefined, consent: true, pin };
      const res = await api.post<{ status: boolean; message?: string; data?: { reference: string; trackingId: string } }>('/verification/bvn/license-onboarding', body);
      if (!res.status || !res.data) throw new Error(res.message);
      setResult({ reference: res.data.reference, trackingId: res.data.trackingId });
      setMessage('Enrollment request submitted. Your submission PDF is ready below.');
      setForm(EMPTY);
      setConsent(false);
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl">
        <PageHeader
          title="BVN Agent Enrollment"
          subtitle="Submit an agent's full BVN license enrollment details for manual processing. Zaka iya duba enrollment report da kanka daga tarihin da ke ƙasa."
        />

        <section className={FORM_SECTION_CLASSES}>
          {!result ? (
            <form onSubmit={prepare} className="space-y-5">
              <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-white p-4 sm:p-5">
                <h3 className="mb-1 font-display text-base font-bold text-[#0b2f73]">1. Agent identity</h3>
                <p className="mb-4 font-body text-xs text-[#0b2f73]/65">Enter the identity information exactly as it appears on the applicant’s records.</p>
                <label className={FORM_LABEL_CLASSES}>
                  Agent Location
                  <input required placeholder="Where the agent operates" className={`mt-1 ${FORM_INPUT_CLASSES}`} value={form.agent_location} onChange={(e) => field('agent_location', e.target.value)} />
                </label>
              </div>

              <div className="rounded-2xl border border-blue-100 bg-white p-4 sm:p-5"><h3 className="mb-1 font-display text-base font-bold text-[#0b2f73]">2. Personal and contact details</h3><p className="mb-4 font-body text-xs text-[#0b2f73]/65">A valid phone number and email help us process the request.</p><div className="grid gap-4 sm:grid-cols-2">
                <label className={FORM_LABEL_CLASSES}>
                  BVN
                  <input required inputMode="numeric" maxLength={11} className={`mt-1 ${FORM_INPUT_CLASSES}`} value={form.bvn} onChange={(e) => field('bvn', e.target.value)} />
                </label>
                <label className={FORM_LABEL_CLASSES}>
                  NIN No
                  <input required inputMode="numeric" maxLength={11} className={`mt-1 ${FORM_INPUT_CLASSES}`} value={form.nin} onChange={(e) => field('nin', e.target.value)} />
                </label>
                <label className={FORM_LABEL_CLASSES}>
                  First Name
                  <input required className={`mt-1 ${FORM_INPUT_CLASSES}`} value={form.first_name} onChange={(e) => field('first_name', e.target.value)} />
                </label>
                <label className={FORM_LABEL_CLASSES}>
                  Last Name
                  <input required className={`mt-1 ${FORM_INPUT_CLASSES}`} value={form.last_name} onChange={(e) => field('last_name', e.target.value)} />
                </label>
                <label className={FORM_LABEL_CLASSES}>
                  Middle Name <span className="font-normal text-[#0b2f73]/50">(optional)</span>
                  <input className={`mt-1 ${FORM_INPUT_CLASSES}`} value={form.middle_name} onChange={(e) => field('middle_name', e.target.value)} />
                </label>
                <label className={FORM_LABEL_CLASSES}>
                  Phone
                  <input required inputMode="numeric" maxLength={11} className={`mt-1 ${FORM_INPUT_CLASSES}`} value={form.phone_number} onChange={(e) => field('phone_number', e.target.value)} />
                </label>
                <label className={FORM_LABEL_CLASSES}>
                  Date of Birth
                  <input required type="date" className={`mt-1 ${FORM_INPUT_CLASSES}`} value={form.date_of_birth} onChange={(e) => field('date_of_birth', e.target.value)} />
                </label>
                <div />
                <label className={FORM_LABEL_CLASSES}>
                  Email
                  <input required type="email" className={`mt-1 ${FORM_INPUT_CLASSES}`} value={form.email} onChange={(e) => field('email', e.target.value)} />
                </label>
                <label className={FORM_LABEL_CLASSES}>
                  Alternative New Email <span className="font-normal text-[#0b2f73]/50">(optional)</span>
                  <input type="email" className={`mt-1 ${FORM_INPUT_CLASSES}`} value={form.alternative_email} onChange={(e) => field('alternative_email', e.target.value)} />
                </label>
              </div></div>

              <div className="rounded-2xl border border-blue-100 bg-white p-4 sm:p-5"><h3 className="mb-1 font-display text-base font-bold text-[#0b2f73]">3. Bank account details</h3><p className="mb-4 font-body text-xs text-[#0b2f73]/65">Use the account details connected to the BVN licence request.</p><div className="grid gap-4 sm:grid-cols-2">
                <label className={FORM_LABEL_CLASSES}>
                  Acct No
                  <input required inputMode="numeric" minLength={10} maxLength={12} className={`mt-1 ${FORM_INPUT_CLASSES}`} value={form.account_number} onChange={(e) => field('account_number', e.target.value)} />
                </label>
                <label className={FORM_LABEL_CLASSES}>
                  Bank Name
                  <input required className={`mt-1 ${FORM_INPUT_CLASSES}`} value={form.bank_name} onChange={(e) => field('bank_name', e.target.value)} />
                </label>
                <label className={`sm:col-span-2 ${FORM_LABEL_CLASSES}`}>
                  Account Name
                  <input required className={`mt-1 ${FORM_INPUT_CLASSES}`} value={form.account_name} onChange={(e) => field('account_name', e.target.value)} />
                </label>
              </div></div>

              <div className="rounded-2xl border border-blue-100 bg-white p-4 sm:p-5"><h3 className="mb-1 font-display text-base font-bold text-[#0b2f73]">4. Address and location</h3><p className="mb-4 font-body text-xs text-[#0b2f73]/65">Tell us where the agent is based.</p><div className="grid gap-4 sm:grid-cols-2">
                <label className={`sm:col-span-2 ${FORM_LABEL_CLASSES}`}>
                  Address
                  <input required className={`mt-1 ${FORM_INPUT_CLASSES}`} value={form.address} onChange={(e) => field('address', e.target.value)} />
                </label>
                <label className={FORM_LABEL_CLASSES}>
                  City
                  <input required className={`mt-1 ${FORM_INPUT_CLASSES}`} value={form.city} onChange={(e) => field('city', e.target.value)} />
                </label>
                <label className={FORM_LABEL_CLASSES}>
                  LGA
                  <input required className={`mt-1 ${FORM_INPUT_CLASSES}`} value={form.lga} onChange={(e) => field('lga', e.target.value)} />
                </label>
                <label className={FORM_LABEL_CLASSES}>
                  State
                  <input required className={`mt-1 ${FORM_INPUT_CLASSES}`} value={form.state_of_residence} onChange={(e) => field('state_of_residence', e.target.value)} />
                </label>
                <label className={FORM_LABEL_CLASSES}>
                  Zone
                  <select required className={`mt-1 ${FORM_INPUT_CLASSES}`} value={form.geo_political_zone} onChange={(e) => field('geo_political_zone', e.target.value as FormState['geo_political_zone'])}>
                    <option value="">-- Select Zone --</option>
                    {ZONES.map((z) => (
                      <option key={z} value={z}>
                        {z}
                      </option>
                    ))}
                  </select>
                </label>
              </div></div>

              <label className="flex items-start gap-2 border-t border-blue-100 pt-4 font-body text-xs text-[#0b2f73]/80">
                <input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 rounded border-blue-300 text-[#0b2f73] focus:ring-[#0b2f73]" />
                I confirm the details above are accurate and the applicant has consented to this enrollment.
              </label>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="rounded-full bg-gold-500/15 px-4 py-2 text-center font-body text-sm font-bold text-gold-700">Service cost: {money(FLAT_PRICE)}</span>
                <button disabled={busy || !consent} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0b2f73] px-6 py-3 font-display font-semibold text-white disabled:opacity-60 sm:w-auto">
                  {busy ? <Loader2 size={16} className="animate-spin" /> : 'Submit Enrollment'}
                </button>
              </div>
              {message && <p className="rounded-lg bg-blue-50 p-3 font-body text-sm text-[#0b2f73]">{message}</p>}
            </form>
          ) : (
            <div>
              <p className="rounded-lg bg-blue-50 p-3 font-body text-sm text-[#0b2f73]">{message}</p>
              <div className="mt-4 rounded-xl bg-blue-50 p-4 font-body text-sm text-[#0b2f73]">
                <p>
                  Reference: <span className="font-mono font-semibold">{result.reference}</span>
                </p>
                <p className="mt-1">
                  Tracking ID: <span className="font-mono font-semibold">{result.trackingId}</span>
                </p>
              </div>
              <button
                onClick={() => {
                  setResult(null);
                  setMessage('');
                }}
                className="mt-4 w-full rounded-xl border border-blue-200 py-2.5 font-body text-sm text-[#0b2f73]"
              >
                Submit another
              </button>
            </div>
          )}
        </section>

        <HistorySection />
      </div>

      <PinConfirmDialog open={showPin} onClose={() => setShowPin(false)} onVerified={submit} />
    </AppShell>
  );
}

function HistorySection() {
  const [rows, setRows] = useState<HistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ status: boolean; data: HistoryEntry[] }>('/verification/bvn/license-onboarding/history')
      .then((r) => setRows(r.data ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className={`${FORM_SECTION_CLASSES} mt-6`}>
      <h3 className="font-display text-base font-bold text-[#0b2f73]">Recent enrollment requests</h3>
      {loading ? (
        <p className="mt-3 font-body text-sm text-[#0b2f73]/70">Loading…</p>
      ) : !rows || rows.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-blue-200 px-4 py-4 text-center font-body text-sm text-[#0b2f73]/70">No enrollment requests in the last 30 days.</p>
      ) : (
        <div className="mt-3 divide-y divide-blue-100 overflow-hidden rounded-xl border border-blue-100 bg-blue-50">
          {rows.map((row) => {
            const base64 = row.pdf_base64?.replace(/^data:application\/pdf;base64,/i, '');
            return (
              <div key={row.reference} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="break-all font-mono text-xs font-semibold text-[#0b2f73]">{row.tracking_id ?? row.reference}</p>
                  <p className="mt-1 font-body text-xs capitalize text-[#0b2f73]/70">
                    {row.status} · {new Date(row.created_at).toLocaleDateString()} · {money(row.amount)}
                  </p>
                </div>
                {base64 && (
                  <a href={`data:application/pdf;base64,${base64}`} download={`${row.reference}.pdf`} className="flex shrink-0 items-center gap-2 rounded-lg bg-gold-500 px-3 py-2 font-body text-xs font-bold text-ink">
                    <Download size={14} /> Submission PDF
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
