import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Download, FileText, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { PinConfirmDialog } from '../components/PinConfirmDialog';
import { api, ApiError } from '../lib/api';
import { FORM_INPUT_CLASSES, FORM_LABEL_CLASSES, FORM_SECTION_CLASSES, money, PageHeader } from '../components/verification/shared';

type TinType = 'individual' | 'corporate';
type TinPrice = { type: TinType; title: string; unitPrice: number; isActive: boolean };
type TinHistoryEntry = {
  reference: string;
  status: string;
  tin_type: TinType | null;
  amount: number;
  progress_notes: string | null;
  certificate_pdf_base64: string | null;
  created_at: string;
  updated_at: string;
};
type OrganizationType = 'Business Name' | 'Company' | 'Incorporated Trustee' | 'Limited Partnership' | 'Limited Liability Partnership';

const STATUS_LABEL: Record<string, string> = { pending: 'Processing', success: 'Completed', failed: 'Rejected', reversed: 'Refunded' };
const ORGANIZATION_TYPES: OrganizationType[] = [
  'Business Name',
  'Company',
  'Incorporated Trustee',
  'Limited Partnership',
  'Limited Liability Partnership'
];

export default function TinCertificatePage() {
  const [tinType, setTinType] = useState<TinType>('individual');
  const [prices, setPrices] = useState<TinPrice[]>([]);
  const [history, setHistory] = useState<TinHistoryEntry[]>([]);
  const [firstName, setFirstName] = useState('');
  const [surname, setSurname] = useState('');
  const [ninNumber, setNinNumber] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [rcNumber, setRcNumber] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [organizationType, setOrganizationType] = useState<OrganizationType>('Company');
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const selectedPrice = prices.find((price) => price.type === tinType);

  async function loadPage() {
    setLoading(true);
    setError('');
    try {
      const [priceResult, historyResult] = await Promise.all([
        api.get<{ status: boolean; data: TinPrice[] }>('/verification/tin/prices'),
        api.get<{ status: boolean; data: TinHistoryEntry[] }>('/verification/tin/history')
      ]);
      setPrices(priceResult.data);
      setHistory(historyResult.data);
    } catch (loadError) {
      setError(loadError instanceof ApiError ? loadError.message : 'Unable to load TIN certificate information. Please refresh and try again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPage();
  }, []);

  function prepare(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!selectedPrice?.isActive) {
      setError('This TIN request type is currently unavailable.');
      return;
    }
    setShowPin(true);
  }

  async function submit(pin: string) {
    setShowPin(false);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const values = tinType === 'individual'
        ? {
            verification_type: 'individual' as const,
            nin_number: ninNumber,
            first_name: firstName,
            surname,
            date_of_birth: dateOfBirth
          }
        : {
            verification_type: 'corporate' as const,
            rc_number: rcNumber,
            company_name: companyName,
            organization_type: organizationType
          };
      const result = await api.post<{ status: boolean; data: { reference: string } }>('/verification/tin', { ...values, pin });
      setMessage(`TIN request submitted for admin processing — reference ${result.data.reference}.`);
      setFirstName('');
      setSurname('');
      setNinNumber('');
      setDateOfBirth('');
      setRcNumber('');
      setCompanyName('');
      await loadPage();
    } catch (submitError) {
      setError(submitError instanceof ApiError ? submitError.message : submitError instanceof Error ? submitError.message : 'Request failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl">
        <Link to="/dashboard" className="inline-flex items-center gap-1.5 font-body text-sm text-ink-600 transition hover:text-ink">
          <ArrowLeft size={15} /> Back to dashboard
        </Link>
        <PageHeader title="TIN Certificate" subtitle="Apply for an individual or corporate Tax Identification Number certificate. Our admin team will process your request and update its status here." />

        <section className={FORM_SECTION_CLASSES}>
          <div className="flex items-center gap-3 border-b border-blue-100 pb-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0b2f73] text-white"><FileText size={20} /></span>
            <div>
              <h2 className="font-display text-lg font-bold text-[#0b2f73]">TIN Certificate Request</h2>
              <p className="font-body text-sm text-[#0b2f73]/70">Requests are reviewed and completed by our admin team.</p>
            </div>
          </div>

          <div className="mt-4 rounded-xl bg-cyan-50 px-4 py-3 font-body text-sm text-[#0b2f73]">
            <p className="font-bold">Service Pricing</p>
            <p className="mt-1">Individual: <b>{money(prices.find((price) => price.type === 'individual')?.unitPrice)}</b> <span className="mx-1">|</span> Corporate: <b>{money(prices.find((price) => price.type === 'corporate')?.unitPrice)}</b></p>
          </div>

          <form onSubmit={prepare} className="mt-5">
            <div className="bg-purple-50 px-4 py-3 font-display text-sm font-bold text-[#0b2f73]">Select Verification Type</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setTinType('individual')} className={`rounded-xl border px-4 py-2.5 font-body text-sm font-semibold transition ${tinType === 'individual' ? 'border-[#191d20] bg-[#191d20] text-white' : 'border-slate-300 text-[#0b2f73]'}`}>
                Individual (NIN)
              </button>
              <button type="button" onClick={() => setTinType('corporate')} className={`rounded-xl border px-4 py-2.5 font-body text-sm font-semibold transition ${tinType === 'corporate' ? 'border-[#191d20] bg-[#191d20] text-white' : 'border-slate-300 text-[#0b2f73]'}`}>
                Corporate (RC)
              </button>
            </div>

            <h3 className="mt-5 bg-purple-50 px-4 py-3 font-display text-sm font-bold text-[#0b2f73]">Verification Details</h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {tinType === 'individual' ? (
                <>
                  <label className={`sm:col-span-2 ${FORM_LABEL_CLASSES}`}>NIN Number
                    <input required inputMode="numeric" maxLength={11} pattern="\d{11}" placeholder="Enter 11-digit NIN" className={`mt-1 ${FORM_INPUT_CLASSES}`} value={ninNumber} onChange={(event) => setNinNumber(event.target.value.replace(/\D/g, '').slice(0, 11))} />
                  </label>
                  <label className={FORM_LABEL_CLASSES}>First Name
                    <input required maxLength={100} placeholder="First Name" className={`mt-1 ${FORM_INPUT_CLASSES}`} value={firstName} onChange={(event) => setFirstName(event.target.value)} />
                  </label>
                  <label className={FORM_LABEL_CLASSES}>Surname
                    <input required maxLength={100} placeholder="Surname" className={`mt-1 ${FORM_INPUT_CLASSES}`} value={surname} onChange={(event) => setSurname(event.target.value)} />
                  </label>
                  <label className={`sm:col-span-2 ${FORM_LABEL_CLASSES}`}>Date of Birth
                    <input required type="date" className={`mt-1 ${FORM_INPUT_CLASSES}`} value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} />
                  </label>
                </>
              ) : (
                <>
                  <label className={`sm:col-span-2 ${FORM_LABEL_CLASSES}`}>RC Number
                    <input required maxLength={30} placeholder="Enter RC Number (e.g. 12345)" className={`mt-1 ${FORM_INPUT_CLASSES}`} value={rcNumber} onChange={(event) => setRcNumber(event.target.value)} />
                  </label>
                  <label className={`sm:col-span-2 ${FORM_LABEL_CLASSES}`}>Company Name
                    <input required maxLength={200} placeholder="Full Company Name" className={`mt-1 ${FORM_INPUT_CLASSES}`} value={companyName} onChange={(event) => setCompanyName(event.target.value)} />
                  </label>
                  <label className={`sm:col-span-2 ${FORM_LABEL_CLASSES}`}>Organization Type
                    <select className={`mt-1 ${FORM_INPUT_CLASSES}`} value={organizationType} onChange={(event) => setOrganizationType(event.target.value as OrganizationType)}>
                      {ORGANIZATION_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                    </select>
                  </label>
                </>
              )}
            </div>

            <div className="mt-5 flex flex-col gap-3 border-t border-blue-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <span className="rounded-full bg-gold-500/15 px-4 py-2 text-center font-body text-sm font-bold text-gold-700">
                Service cost: {loading ? 'Loading…' : money(selectedPrice?.unitPrice)}
              </span>
              <button disabled={busy || loading || !selectedPrice?.isActive} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gold-500 px-6 py-3 font-display font-semibold text-ink disabled:opacity-60 sm:w-auto">
                {busy ? <Loader2 size={16} className="animate-spin" /> : 'Submit TIN Request'}
              </button>
            </div>
          </form>
          {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 font-body text-sm text-rose-800">{error}</p>}
          {message && <p role="status" className="mt-3 rounded-lg bg-blue-50 p-3 font-body text-sm text-[#0b2f73]">{message}</p>}

          <div className="mt-8 border-t border-blue-100 pt-5">
            <h3 className="font-display text-base font-bold text-[#0b2f73]">My TIN Requests</h3>
            {loading ? (
              <p className="mt-3 font-body text-sm text-[#0b2f73]/70">Loading…</p>
            ) : history.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-blue-200 px-4 py-4 text-center font-body text-sm text-[#0b2f73]/70">No TIN requests recorded yet.</p>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-xl border border-blue-100 bg-blue-50">
                <table className="w-full text-left font-body text-xs">
                  <thead><tr className="border-b border-blue-100 text-[#0b2f73]/70">{['Reference', 'Type', 'Amount', 'Status', 'Progress Notes', 'Date', 'Certificate'].map((heading) => <th key={heading} className="whitespace-nowrap px-3 py-2 font-semibold">{heading}</th>)}</tr></thead>
                  <tbody>
                    {history.map((row) => (
                      <tr key={row.reference} className="border-b border-blue-100 last:border-0">
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-[#0b2f73]">{row.reference}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-[#0b2f73]">{row.tin_type === 'individual' ? 'Individual (NIN)' : row.tin_type === 'corporate' ? 'Corporate (RC)' : '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-[#0b2f73]">{money(row.amount)}</td>
                        <td className="whitespace-nowrap px-3 py-2"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${row.status === 'success' ? 'bg-success-500/15 text-success-600' : row.status === 'pending' ? 'bg-gold-500/15 text-gold-700' : 'bg-ember-500/15 text-ember-600'}`}>{STATUS_LABEL[row.status] ?? row.status}</span></td>
                        <td className="max-w-[220px] px-3 py-2 text-[#0b2f73]/70">{row.progress_notes ?? '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-[#0b2f73]/70">{new Date(row.created_at).toLocaleDateString()}</td>
                        <td className="whitespace-nowrap px-3 py-2">
                          {row.certificate_pdf_base64 ? <a href={`data:application/pdf;base64,${row.certificate_pdf_base64}`} download={`${row.reference}-certificate.pdf`} className="flex items-center gap-1 rounded-lg bg-gold-500 px-2 py-1.5 font-bold text-ink"><Download size={12} /> PDF</a> : <span className="text-[#0b2f73]/40">—</span>}
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
