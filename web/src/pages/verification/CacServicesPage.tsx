import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Building2, Download, Loader2, Plus, Upload } from 'lucide-react';
import AppShell from '../../components/AppShell';
import { api, ApiError } from '../../lib/api';
import { PinConfirmDialog } from '../../components/PinConfirmDialog';
import { PageHeader, money, FORM_SECTION_CLASSES, FORM_INPUT_CLASSES, FORM_LABEL_CLASSES } from '../../components/verification/shared';

type CacType = 'sole' | 'partnership' | 'llc';
type CacPriceRow = { type: CacType; title: string; unitPrice: number; isActive: boolean };
type CacHistoryEntry = {
  reference: string;
  status: string;
  cac_type: string | null;
  proposed_name_1: string | null;
  proposed_name_2: string | null;
  amount: number;
  progress_notes: string | null;
  submission_pdf_base64: string | null;
  certificate_pdf_base64: string | null;
  created_at: string;
  updated_at: string;
};

type Details = {
  business_nature: string;
  business_address: string;
  proprietor_full_name: string;
  proprietor_phone: string;
  proprietor_email: string;
  proprietor_residential_address: string;
  proprietor_date_of_birth: string;
  proprietor_gender: 'Male' | 'Female' | '';
  proprietor_nin: string;
};
type SupportingDocument = { label: string; name: string; mime_type: 'application/pdf' | 'image/jpeg' | 'image/png'; base64: string };
const EMPTY_DETAILS: Details = {
  business_nature: '', business_address: '', proprietor_full_name: '', proprietor_phone: '',
  proprietor_email: '', proprietor_residential_address: '', proprietor_date_of_birth: '',
  proprietor_gender: '', proprietor_nin: ''
};

const SERVICE_OPTIONS: { value: CacType; label: string }[] = [
  { value: 'sole', label: 'Business Name Sole Proprietorship' },
  { value: 'partnership', label: 'Business Name Partnership' },
  { value: 'llc', label: 'Limited Liability 1M Share' }
];

const STATUS_LABEL: Record<string, string> = { pending: 'Processing', success: 'Completed', failed: 'Rejected', reversed: 'Refunded' };

export default function CacServicesPage() {
  const [prices, setPrices] = useState<CacPriceRow[]>([]);
  const [service, setService] = useState<CacType | ''>('sole');
  const [registrationTab, setRegistrationTab] = useState<'business' | 'company'>('business');
  const [surname, setSurname] = useState('');
  const [firstName, setFirstName] = useState('');
  const [otherName, setOtherName] = useState('');
  const [extraDirector, setExtraDirector] = useState(false);
  const [documents, setDocuments] = useState<SupportingDocument[]>([]);
  const [uploadingLabel, setUploadingLabel] = useState<string | null>(null);
  const [name1, setName1] = useState('');
  const [name2, setName2] = useState('');
  const [details, setDetails] = useState<Details>(EMPTY_DETAILS);
  const [consent, setConsent] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<CacHistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const selectedPrice = useMemo(() => prices.find((p) => p.type === service)?.unitPrice, [prices, service]);

  function detailField<K extends keyof Details>(key: K, value: Details[K]) {
    setDetails((prev) => ({ ...prev, [key]: value }));
  }

  async function addDocument(label: string, file?: File) {
    if (!file) return;
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type) || file.size > 4 * 1024 * 1024) {
      setMessage('Use a PDF, JPG or PNG document under 4MB.'); return;
    }
    setUploadingLabel(label);
    try {
      const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.onerror = reject; reader.readAsDataURL(file); });
      setDocuments((current) => [...current.filter((document) => document.label !== label), { label, name: file.name, mime_type: file.type as SupportingDocument['mime_type'], base64 }]);
    } finally { setUploadingLabel(null); }
  }

  async function loadHistory() {
    setLoadingHistory(true);
    try {
      const result = await api.get<{ status: boolean; data: CacHistoryEntry[] }>('/verification/cac/history');
      setHistory(result.data ?? []);
    } catch {
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }

  useEffect(() => {
    api
      .get<{ status: boolean; data: CacPriceRow[] }>('/verification/cac/prices')
      .then((result) => setPrices(result.data ?? []))
      .catch(() => setPrices([]));
    void loadHistory();
  }, []);

  function prepare(event: FormEvent) {
    event.preventDefault();
    setShowPin(true);
  }

  async function submit(pin: string) {
    setShowPin(false);
    setBusy(true);
    setMessage('');
    try {
      const result = await api.post<{ status: boolean; message?: string; data?: { reference: string } }>('/verification/cac', {
        cac_type: service,
        proposed_name_1: name1,
        proposed_name_2: name2 || undefined,
        ...details,
        proprietor_full_name: [surname, firstName, otherName].filter(Boolean).join(' ') || details.proprietor_full_name,
        supporting_documents: documents.length ? documents : undefined,
        pin
      });
      if (!result.status) throw new Error(result.message);
      setMessage(`Request submitted — reference ${result.data?.reference}. We'll register your business and update the status below.`);
      setService('sole');
      setSurname(''); setFirstName(''); setOtherName(''); setExtraDirector(false);
      setDocuments([]);
      setName1('');
      setName2('');
      setDetails(EMPTY_DETAILS);
      setConsent(false);
      void loadHistory();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl">
        <PageHeader title="CAC Registration" subtitle="Register your business or company with the Corporate Affairs Commission. Complete the details below and our team will process the request." />

        <section className={FORM_SECTION_CLASSES}>
          <form onSubmit={prepare}>
            <div className="flex items-center gap-2 border-b border-blue-200">
              <Building2 size={20} className="text-[#0b2f73]" /><h2 className="font-display text-lg font-bold text-[#0b2f73]">CAC Registration</h2>
            </div>
            <div className="mt-4 flex gap-5 border-b border-blue-100">
              <button type="button" onClick={() => { setRegistrationTab('business'); setService('sole'); }} className={`border-b-2 px-3 pb-3 font-body text-sm font-semibold ${registrationTab === 'business' ? 'border-[#0b2f73] text-[#0b2f73]' : 'border-transparent text-[#0b2f73]/60'}`}>Business Name Registration</button>
              <button type="button" onClick={() => { setRegistrationTab('company'); setService('llc'); }} className={`border-b-2 px-3 pb-3 font-body text-sm font-semibold ${registrationTab === 'company' ? 'border-[#0b2f73] text-[#0b2f73]' : 'border-transparent text-[#0b2f73]/60'}`}>Company Registration</button>
            </div>
            <p className="mt-4 rounded-xl bg-blue-50 px-4 py-3 font-body text-sm text-[#0b2f73]">Service cost: <b>{money(selectedPrice)}</b>. NGO, incorporated trustees, and companies above ₦1m share capital are quoted individually.</p>

            {service && (
              <>
                <h3 className="mt-6 font-display font-bold text-[#0b2f73]">1. Proposed {registrationTab === 'business' ? 'Business' : 'Company'} Name(s)</h3>
                <div className="mt-3 grid gap-4 sm:grid-cols-2"><label className={FORM_LABEL_CLASSES}>Option 1
                  <input
                    required
                    maxLength={200}
                    placeholder="e.g. Amana Traders"
                    className={`mt-1 ${FORM_INPUT_CLASSES}`}
                    value={name1}
                    onChange={(e) => setName1(e.target.value)}
                  /></label><label className={FORM_LABEL_CLASSES}>Option 2
                  <input
                    maxLength={200}
                    placeholder="e.g. Amana Global Ventures"
                    className={`mt-1 ${FORM_INPUT_CLASSES}`}
                    value={name2}
                    onChange={(e) => setName2(e.target.value)}
                  /></label></div>

                {registrationTab === 'company' && <div className="mt-5"><p className="font-display font-bold text-[#0b2f73]">2. Type of Company</p><div className="mt-2 space-y-2 font-body text-sm text-[#0b2f73]"><label className="block"><input type="radio" checked readOnly className="mr-2" />Private Limited Company (Ltd)</label><label className="block"><input type="radio" disabled className="mr-2" />Public Limited Company (Plc)</label><label className="block"><input type="radio" disabled className="mr-2" />Incorporated Trustee / NGO</label></div></div>}
                <h3 className="mb-3 mt-5 border-t border-blue-100 pt-4 font-display text-sm font-bold text-[#0b2f73]">{registrationTab === 'company' ? '3. Nature of Business / Objects of the Company' : 'Business Details'}</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className={`sm:col-span-2 ${FORM_LABEL_CLASSES}`}>
                    Nature of Business
                    <textarea required maxLength={300} placeholder="Describe your business activities" className={`mt-1 ${FORM_INPUT_CLASSES}`} value={details.business_nature} onChange={(e) => detailField('business_nature', e.target.value)} />
                  </label>
                  <label className={`sm:col-span-2 ${FORM_LABEL_CLASSES}`}>
                    Business Address
                    <textarea required maxLength={300} placeholder="Enter your business address" className={`mt-1 ${FORM_INPUT_CLASSES}`} value={details.business_address} onChange={(e) => detailField('business_address', e.target.value)} />
                  </label>
                </div>

                <h3 className="mb-3 mt-5 border-t border-blue-100 pt-4 font-display text-sm font-bold text-[#0b2f73]">
                  {service === 'sole' ? 'Proprietor' : service === 'partnership' ? 'Lead Partner' : 'Applicant'} Details
                </h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className={FORM_LABEL_CLASSES}>Surname<input required className={`mt-1 ${FORM_INPUT_CLASSES}`} value={surname} onChange={(e) => setSurname(e.target.value)} /></label>
                  <label className={FORM_LABEL_CLASSES}>First Name<input required className={`mt-1 ${FORM_INPUT_CLASSES}`} value={firstName} onChange={(e) => setFirstName(e.target.value)} /></label>
                  <label className={FORM_LABEL_CLASSES}>Other Name<input className={`mt-1 ${FORM_INPUT_CLASSES}`} value={otherName} onChange={(e) => setOtherName(e.target.value)} /></label>
                  <label className={FORM_LABEL_CLASSES}>
                    Phone
                    <input required inputMode="numeric" maxLength={11} className={`mt-1 ${FORM_INPUT_CLASSES}`} value={details.proprietor_phone} onChange={(e) => detailField('proprietor_phone', e.target.value)} />
                  </label>
                  <label className={FORM_LABEL_CLASSES}>
                    Email
                    <input required type="email" className={`mt-1 ${FORM_INPUT_CLASSES}`} value={details.proprietor_email} onChange={(e) => detailField('proprietor_email', e.target.value)} />
                  </label>
                  <label className={`sm:col-span-2 ${FORM_LABEL_CLASSES}`}>
                    Residential Address
                    <input required maxLength={300} className={`mt-1 ${FORM_INPUT_CLASSES}`} value={details.proprietor_residential_address} onChange={(e) => detailField('proprietor_residential_address', e.target.value)} />
                  </label>
                  <label className={FORM_LABEL_CLASSES}>
                    Date of Birth
                    <input required type="date" className={`mt-1 ${FORM_INPUT_CLASSES}`} value={details.proprietor_date_of_birth} onChange={(e) => detailField('proprietor_date_of_birth', e.target.value)} />
                  </label>
                  <label className={FORM_LABEL_CLASSES}>
                    Gender
                    <select required className={`mt-1 ${FORM_INPUT_CLASSES}`} value={details.proprietor_gender} onChange={(e) => detailField('proprietor_gender', e.target.value as Details['proprietor_gender'])}>
                      <option value="">-- Select --</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                    </select>
                  </label>
                  <label className={`sm:col-span-2 ${FORM_LABEL_CLASSES}`}>
                    NIN
                    <input required inputMode="numeric" maxLength={11} className={`mt-1 ${FORM_INPUT_CLASSES}`} value={details.proprietor_nin} onChange={(e) => detailField('proprietor_nin', e.target.value)} />
                  </label>
                </div>

                {registrationTab === 'company' && <><button type="button" onClick={() => setExtraDirector(true)} className="mt-5 flex items-center gap-2 rounded-lg bg-[#0b2f73] px-4 py-2 font-body text-sm font-semibold text-white"><Plus size={16} /> Add Another Director/Proprietor</button>{extraDirector && <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4"><p className="font-display font-bold text-[#0b2f73]">Additional Director</p><p className="mt-1 font-body text-xs text-[#0b2f73]/70">Their information and valid ID can be supplied to our CAC team after this initial request is submitted.</p></div>}</>}

                <div className="mt-6 border-t border-blue-100 pt-5"><h3 className="font-display font-bold text-[#0b2f73]">Supporting Documents</h3><p className="mt-1 font-body text-xs text-[#0b2f73]/70">Upload PDF, JPG or PNG files (maximum 4MB each). Your files are stored securely and made available to the CAC admin.</p><div className="mt-3 grid gap-3 sm:grid-cols-2">{['Valid ID document(s)', 'Passport photograph(s)', 'Proof of address', 'Signature specimen(s)'].map((label) => { const uploaded = documents.find((document) => document.label === label); const uploading = uploadingLabel === label; return <label key={label} className={`rounded-xl border border-dashed border-blue-200 p-3 ${FORM_LABEL_CLASSES}`}>{label}<span className="mt-2 flex items-center gap-2 text-xs text-[#0b2f73]/70">{uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {uploading ? 'Preparing secure upload…' : uploaded ? `Ready: ${uploaded.name}` : 'Choose file'}</span><input disabled={uploading || Boolean(uploadingLabel)} type="file" accept="application/pdf,image/jpeg,image/png" className="mt-2 block w-full text-xs disabled:opacity-50" onChange={(event) => void addDocument(label, event.target.files?.[0])} /></label>; })}</div></div>

                <label className="mt-5 flex items-start gap-2 font-body text-xs text-[#0b2f73]/80">
                  <input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 rounded border-blue-300 text-[#0b2f73] focus:ring-[#0b2f73]" />
                  I confirm these business name(s) and details are accurate, and I authorise this registration on my behalf.
                </label>

                <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="rounded-full bg-gold-500/15 px-4 py-2 text-center font-body text-sm font-bold text-gold-700">Service cost: {money(selectedPrice)}</span>
                  <button disabled={busy || !consent} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gold-500 px-6 py-3 font-display font-semibold text-ink disabled:opacity-60 sm:w-auto">
                    {busy ? <Loader2 size={16} className="animate-spin" /> : 'Continue'}
                  </button>
                </div>
              </>
            )}
            {message && <p className="mt-3 rounded-lg bg-blue-50 p-3 font-body text-sm text-[#0b2f73]">{message}</p>}
          </form>

          <div className="mt-8 border-t border-blue-100 pt-5">
            <h3 className="font-display text-base font-bold text-[#0b2f73]">Transactions</h3>

            {loadingHistory ? (
              <p className="mt-3 font-body text-sm text-[#0b2f73]/70">Loading…</p>
            ) : history.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-blue-200 px-4 py-4 text-center font-body text-sm text-[#0b2f73]/70">No transactions recorded yet.</p>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-xl border border-blue-100 bg-blue-50">
                <table className="w-full text-left font-body text-xs">
                  <thead>
                    <tr className="border-b border-blue-100 text-[#0b2f73]/70">
                      {['Ref ID', 'Type', 'Proposed Nm 1', 'Proposed Nm 2', 'Amount', 'Status', 'Progress Notes', 'Date', 'Form', 'Certificate'].map((h) => (
                        <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((row) => (
                      <tr key={row.reference} className="border-b border-blue-100 last:border-0">
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-[#0b2f73]">{row.reference}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-[#0b2f73]">{SERVICE_OPTIONS.find((s) => s.value === row.cac_type)?.label ?? row.cac_type}</td>
                        <td className="px-3 py-2 text-[#0b2f73]">{row.proposed_name_1 ?? '—'}</td>
                        <td className="px-3 py-2 text-[#0b2f73]">{row.proposed_name_2 ?? '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-[#0b2f73]">{money(row.amount)}</td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <span
                            className={`rounded-full px-2 py-1 text-[10px] font-bold ${
                              row.status === 'success' ? 'bg-success-500/15 text-success-600' : row.status === 'pending' ? 'bg-gold-500/15 text-gold-700' : 'bg-ember-500/15 text-ember-600'
                            }`}
                          >
                            {STATUS_LABEL[row.status] ?? row.status}
                          </span>
                        </td>
                        <td className="max-w-[200px] px-3 py-2 text-[#0b2f73]/70">{row.progress_notes ?? '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-[#0b2f73]/70">{new Date(row.created_at).toLocaleDateString()}</td>
                        <td className="whitespace-nowrap px-3 py-2">
                          {row.submission_pdf_base64 ? (
                            <a
                              href={`data:application/pdf;base64,${row.submission_pdf_base64}`}
                              download={`${row.reference}-submission-form.pdf`}
                              className="flex items-center gap-1 rounded-lg border border-[#0b2f73]/30 px-2 py-1.5 font-bold text-[#0b2f73]"
                            >
                              <Download size={12} /> Form
                            </a>
                          ) : (
                            <span className="text-[#0b2f73]/40">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">
                          {row.certificate_pdf_base64 ? (
                            <a
                              href={`data:application/pdf;base64,${row.certificate_pdf_base64}`}
                              download={`${row.reference}-certificate.pdf`}
                              className="flex items-center gap-1 rounded-lg bg-gold-500 px-2 py-1.5 font-bold text-ink"
                            >
                              <Download size={12} /> PDF
                            </a>
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
