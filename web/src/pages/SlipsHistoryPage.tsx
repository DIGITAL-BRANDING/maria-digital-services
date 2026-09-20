import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, Eye, FileText, Loader2, Printer, Search } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { api } from '../lib/api';
import { DigitalSlipPreview } from '../components/verification/shared';
type Identity = { full_name: string | null; nin: string | null; bvn: string | null; phone: string | null; gender: string | null; dob: string | null; photo: string | null };
type Entry = { id: string; reference: string; status: string; type: string; service: string | null; amount: number; created_at: string; progress_notes: string | null; ticket_id: string | null; pdf_base64?: string | null; pdf_url?: string | null; identity?: Identity | null; failure_message?: string | null };
const label = (entry: Entry) => (entry.service ?? entry.type).toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const money = (amount: number) => `₦${amount.toLocaleString('en-NG')}`;
const documentUrl = (entry: Entry) => entry.pdf_url ?? (entry.pdf_base64 ? `data:application/pdf;base64,${entry.pdf_base64.replace(/^data:application\/pdf;base64,/i, '')}` : null);
// Matches the server's own "a customer can retrieve a completed
// verification result for seven days" window (see the comment above
// GET /history in verification.routes.ts) - shown here as a countdown so
// the reference-app-style "days left" badge means the same seven days the
// backend actually honours, not an arbitrary UI number.
const REPRINT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
function reprintWindow(createdAt: string) {
  const expiresAt = new Date(new Date(createdAt).getTime() + REPRINT_WINDOW_MS);
  const msLeft = expiresAt.getTime() - Date.now();
  if (msLeft <= 0) return null;
  const days = Math.floor(msLeft / (24 * 60 * 60 * 1000));
  const hours = Math.floor((msLeft % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  return { days, hours, expiresAt };
}
const shortDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const dateTime = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
// The identity preview for a *successful* request; for failed/reversed we
// only ever have the submitted NIN/BVN (no user_data), which is why this is
// split out rather than reusing DigitalSlipPreview for both cases below.
function FailedRequestPreview({ entry }: { entry: Entry }) {
  const idValue = entry.identity?.nin || entry.identity?.bvn || null;
  const idLabel = entry.identity?.nin ? 'NIN' : entry.identity?.bvn ? 'BVN' : null;
  return (
    <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4">
      <div className="flex items-center gap-2 text-rose-700"><AlertTriangle size={16} /><span className="text-sm font-bold capitalize">{entry.status}</span></div>
      {idValue && <p className="mt-3 break-all text-sm text-[#0b2f73]">{idLabel}: <b>{idValue}</b></p>}
      <p className="mt-1 break-all text-sm text-[#0b2f73]">Request ID: <b>{entry.reference}</b></p>
      <p className="mt-3 text-sm text-[#0b2f73]/80">{entry.failure_message ?? 'This request did not complete successfully.'}</p>
    </div>
  );
}
// Card for a successful NIN/BVN slip - photo, name, ID, type, date and a
// "days left" badge, matching the reference mobile-app design: a portrait
// (or initials) up top, everything else centered below it, two actions
// (Reprint / Details) at the bottom. Falls back to the plainer OtherCard
// look below when there's no photo/name to show (e.g. a non-identity
// service that still came back SUCCESS, like CAC or Newspaper Publication).
function SuccessCard({ entry, onDetails }: { entry: Entry; onDetails: () => void }) {
  const identity = entry.identity;
  const name = identity?.full_name;
  const idValue = identity?.nin || identity?.bvn || null;
  if (!name && !idValue) return <OtherCard entry={entry} onDetails={onDetails} />;

  const idType = identity?.nin ? 'NIN' : identity?.bvn ? 'BVN' : 'ID';
  const photoSrc = identity?.photo ? (identity.photo.startsWith('data:') ? identity.photo : `data:image/jpeg;base64,${identity.photo}`) : '';
  const initials = (name ?? label(entry)).split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const countdown = reprintWindow(entry.created_at);
  const doc = documentUrl(entry);

  return (
    <article className="rounded-2xl border border-blue-200 bg-white p-5 text-center shadow-sm">
      {photoSrc ? (
        <img src={photoSrc} alt={name ?? idType} className="mx-auto h-20 w-20 rounded-full border-2 border-[#0b2f73]/20 object-cover" />
      ) : (
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[#0b2f73] font-display text-xl font-bold text-white">{initials}</div>
      )}
      <h2 className="mt-3 font-display text-lg font-bold leading-tight text-[#0b2f73]">
        {name ?? label(entry)} <span className="ml-1 inline-block rounded bg-[#0b6c9d] px-2 py-1 align-middle text-[10px] font-bold text-white">{idType}</span>
      </h2>
      {idValue && <p className="mt-2 text-sm text-[#0b2f73]/70">ID: {idValue}</p>}
      <p className="text-sm text-[#0b2f73]/70">Type: {label(entry)}</p>
      <p className="text-sm text-[#0b2f73]/70">Date: {dateTime(entry.created_at)}</p>
      {countdown && (
        <p className="mx-auto mt-3 inline-block rounded-full bg-emerald-100 px-4 py-1.5 text-xs font-semibold text-emerald-700">
          {countdown.days}d {countdown.hours}h left — Expires {shortDate(countdown.expiresAt)}
        </p>
      )}
      <div className="mt-4 flex justify-center gap-3">
        {doc ? (
          <a href={doc} target="_blank" rel="noreferrer" download={`${entry.reference}.pdf`} className="flex items-center gap-1.5 rounded-xl border border-blue-200 px-4 py-2 text-sm font-semibold text-[#0b2f73]">
            <Printer size={15} /> Reprint
          </a>
        ) : null}
        <button onClick={onDetails} className="flex items-center gap-1.5 rounded-xl border border-blue-200 px-4 py-2 text-sm font-semibold text-[#0b2f73]">
          <Eye size={15} /> Details
        </button>
      </div>
    </article>
  );
}
// Plainer horizontal card for anything that isn't a completed NIN/BVN slip -
// pending/failed/reversed requests, or a SUCCESS on a service with no
// photo/name to show (CAC, Newspaper Publication, etc).
function OtherCard({ entry, onDetails }: { entry: Entry; onDetails: () => void }) {
  const doc = documentUrl(entry);
  return (
    <article className="flex flex-wrap items-center gap-4 rounded-2xl border border-blue-200 bg-white p-4 shadow-sm">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#0b2f73] font-display text-lg font-bold text-white">
        {label(entry).split(' ').slice(0, 2).map((word) => word[0]).join('')}
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="font-display font-bold text-[#0b2f73]">
          {label(entry)} <span className="ml-2 rounded bg-[#0b6c9d] px-2 py-1 text-[10px] text-white">{entry.type.startsWith('BVN') ? 'BVN' : entry.type.startsWith('NIN') ? 'NIN' : 'SERVICE'}</span>
        </h2>
        <p className="mt-1 text-xs text-[#0b2f73]/70">ID: {entry.reference} · Date: {dateTime(entry.created_at)} · {money(entry.amount)}</p>
        <span className={`mt-2 inline-block rounded px-2 py-1 text-[10px] font-bold ${entry.status === 'success' ? 'bg-emerald-100 text-emerald-700' : entry.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>{entry.status}</span>
      </div>
      <div className="flex gap-2">
        <button onClick={onDetails} className="flex items-center gap-1 rounded-xl border border-blue-200 px-3 py-2 text-sm font-semibold text-[#0b2f73]"><Eye size={15}/> Details</button>
        {entry.status === 'success' && doc && <a href={doc} target="_blank" rel="noreferrer" download={`${entry.reference}.pdf`} className="flex items-center gap-1 rounded-xl border border-blue-200 px-3 py-2 text-sm font-semibold text-[#0b2f73]"><Download size={15}/> Document</a>}
      </div>
    </article>
  );
}
export default function SlipsHistoryPage() {
  const [items, setItems] = useState<Entry[]>([]); const [loading, setLoading] = useState(true); const [selected, setSelected] = useState<Entry | null>(null); const [search, setSearch] = useState(''); const [params] = useSearchParams(); const group = params.get('group') ?? '';
  useEffect(() => { api.get<{ data: Entry[] }>('/verification/service-history').then((r) => setItems(r.data ?? [])).finally(() => setLoading(false)); }, []);
  const visible = useMemo(() => items.filter((entry) => { const haystack = `${label(entry)} ${entry.reference} ${entry.type} ${entry.identity?.full_name ?? ''} ${entry.identity?.nin ?? ''} ${entry.identity?.bvn ?? ''}`.toLowerCase(); return (!group || haystack.includes(group.toLowerCase().replace(/_/g, ' ')) || (group === 'OTHER' && !/(nin|bvn|cac|ipe)/i.test(haystack))) && haystack.includes(search.toLowerCase()); }), [items, group, search]);
  return <AppShell><div className="mx-auto max-w-5xl"><header className="rounded-2xl border border-[#3b73c5] bg-[#0b2f73] p-6 text-white"><p className="text-sm font-semibold text-gold-300">Account resources</p><h1 className="mt-1 text-3xl font-bold">{group ? `${group.replace(/_/g, ' ')} History` : 'All Service History'}</h1><p className="mt-2 text-sm text-blue-100">Search, open details, and download completed service documents.</p></header><div className="relative mt-6"><Search className="absolute left-4 top-3 text-[#0b2f73]/50" size={19}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, NIN, BVN or type..." className="w-full rounded-xl border border-blue-200 bg-white py-3 pl-11 pr-4 text-[#0b2f73] outline-none focus:border-[#0b2f73]" /></div><section className="mt-5 grid gap-3 sm:grid-cols-2">{loading && <Loader2 className="col-span-full mx-auto my-10 animate-spin text-[#0b2f73]" />}{!loading && !visible.length && <p className="col-span-full rounded-xl border border-dashed border-blue-200 p-8 text-center text-[#0b2f73]/70">No matching service request found.</p>}{visible.map((entry) => entry.status === 'success' ? <SuccessCard key={entry.id} entry={entry} onDetails={() => setSelected(entry)} /> : <OtherCard key={entry.id} entry={entry} onDetails={() => setSelected(entry)} />)}</section>{selected && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onClick={() => setSelected(null)}><div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6" onClick={(event) => event.stopPropagation()}><h2 className="font-display text-xl font-bold text-[#0b2f73]">{label(selected)}</h2><p className="mt-4 text-sm">Status: <b className="capitalize">{selected.status}</b></p><p className="mt-2 text-sm">Amount: <b>{money(selected.amount)}</b></p><p className="mt-2 break-all text-sm">Reference: <b>{selected.reference}</b></p>{selected.progress_notes && <p className="mt-4 rounded-xl bg-blue-50 p-3 text-sm text-[#0b2f73]"><b>Progress update:</b> {selected.progress_notes}</p>}{selected.status === 'success' && selected.identity ? <DigitalSlipPreview data={{ user_data: selected.identity }} /> : (selected.status === 'failed' || selected.status === 'reversed') && <FailedRequestPreview entry={selected} />}{selected.status === 'success' && documentUrl(selected) && <a href={documentUrl(selected)!} target="_blank" rel="noreferrer" download={`${selected.reference}.pdf`} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#0b2f73] py-3 font-semibold text-white"><FileText size={17}/> Open or download document</a>}<button onClick={() => setSelected(null)} className="mt-3 w-full rounded-xl border border-blue-200 py-3 font-semibold text-[#0b2f73]">Close</button></div></div>}</div></AppShell>;
}
