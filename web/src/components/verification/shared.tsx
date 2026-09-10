import { Download, Loader2, RefreshCw, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

// ── Shared types ────────────────────────────────────────────────
export type PriceRow = { service: string; unitPrice: number; isActive: boolean };
export type SlipResult = { user_data?: Record<string, unknown>; pdf_base64?: string; pdf_url?: string; reference: string };
export type AsyncResult = { ticket_id: string; reference: string };
export type TicketStatus = { ticket_id: string; status: 'pending' | 'success' | 'failed'; response: Record<string, unknown> | null };
export type VerificationHistory = {
  reference: string;
  status: string;
  created_at: string;
  pdf_base64: string | null;
  pdf_url: string | null;
  ticket_id: string | null;
};

export const money = (amount?: number) =>
  amount === undefined ? 'Price loading…' : `₦${amount.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

// ── Shared "NIN by Phone" tier definitions ──────────────────────
// Used by both NinPhoneVerificationPage's "Phone No" method and the
// dedicated PhoneMultiplePage, since they hit the exact same
// POST /verification/nin/by-phone endpoint and NIN_PHONE_SLIP_* prices —
// kept in one place so the two pages can't drift apart.
export const PHONE_TIERS = ['regular', 'standard', 'premium'] as const;
export type PhoneTier = (typeof PHONE_TIERS)[number];
export const PHONE_TIER_LABELS: Record<PhoneTier, string> = {
  regular: 'Regular Slip',
  standard: 'Standard Slip',
  premium: 'Premium Slip',
};
export const PHONE_TIER_ICON: Record<PhoneTier, SlipIconVariant> = { regular: 'regular', standard: 'standard', premium: 'premium' };
export const PHONE_TIER_IMAGE: Record<PhoneTier, string> = {
  regular: '/branding/regular slip.jpg',
  standard: '/branding/standard slip.jpg',
  premium: '/branding/premium slip.jpg',
};
export const PHONE_KEY: Record<PhoneTier, string> = {
  regular: 'NIN_PHONE_SLIP_REGULAR',
  standard: 'NIN_PHONE_SLIP_STANDARD',
  premium: 'NIN_PHONE_SLIP_PREMIUM',
};

/**
 * Two-tone palette used across every split-out verification page:
 *   - "Tiles" (the intro banner + selectable option cards) are filled solid
 *     royal blue with white text, for high contrast against the blue.
 *   - "Forms" (the card holding the actual inputs) are white with royal
 *     blue text, so the blue reads as an accent, not a wash the labels
 *     disappear into.
 * Kept as exported class-string constants (rather than a Tailwind color
 * token) so every page and shared component stays visually consistent
 * without having to remember the exact hex each time.
 */
export const ROYAL_BLUE = '#0b2f73';
// IMPORTANT: TILE_CLASSES deliberately does NOT include a border-color
// utility (border-transparent, etc). Every call site must add exactly one
// of TILE_SELECTED_CLASSES / TILE_UNSELECTED_CLASSES itself. Baking
// `border-transparent` into TILE_CLASSES and then trying to override it by
// appending TILE_SELECTED_CLASSES's `border-gold-400` used to silently fail:
// both are `border-color` utilities of equal specificity, so which one wins
// is decided by their order in Tailwind's *compiled stylesheet*, not by
// their order in the className string - and border-transparent happened to
// win, so a selected slip/service tile never visibly looked selected
// anywhere in the app. Keeping the two states mutually exclusive (one or
// the other, never both) sidesteps that class-order footgun entirely.
export const TILE_CLASSES =
  'rounded-xl border-2 bg-[#0b2f73] p-3 text-center text-white shadow-sm transition hover:-translate-y-0.5 hover:brightness-110 sm:p-4';
export const TILE_SELECTED_CLASSES = 'border-gold-400 ring-2 ring-gold-400/50 shadow-lg';
export const TILE_UNSELECTED_CLASSES = 'border-transparent';
export const FORM_SECTION_CLASSES = 'mt-6 rounded-2xl border border-blue-100 bg-white p-4 shadow-sm sm:p-6';
export const FORM_INPUT_CLASSES =
  'w-full rounded-xl border border-blue-200 bg-white p-3 text-[#0b2f73] outline-none placeholder:text-blue-300 focus:border-[#0b2f73]';
export const FORM_LABEL_CLASSES = 'font-body text-sm font-medium text-[#0b2f73]';
export const FORM_HELP_CLASSES = 'font-body text-xs text-[#0b2f73]/70';

// ── Prices ──────────────────────────────────────────────────────
export function useVerificationPrices() {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  useEffect(() => {
    api
      .get<{ data?: PriceRow[] } | PriceRow[]>('/verification/prices')
      .then((result) => {
        const rows = Array.isArray(result) ? result : (result.data ?? []);
        setPrices(Object.fromEntries(rows.map((row) => [row.service, Number(row.unitPrice)])));
      })
      .catch(() => setError('Unable to load current prices. Please refresh and try again.'));
  }, []);
  return { prices, error };
}

// ── Recent request history for one service key ─────────────────
export function useVerificationHistory(serviceKey: string) {
  const [history, setHistory] = useState<VerificationHistory[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!serviceKey) {
      setHistory([]);
      return;
    }
    let active = true;
    setLoading(true);
    api
      .get<{ status: boolean; data: VerificationHistory[] }>(`/verification/history?service=${encodeURIComponent(serviceKey)}`)
      .then((result) => {
        if (active) setHistory(result.data ?? []);
      })
      .catch(() => {
        if (active) setHistory([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [serviceKey]);
  return { history, loading };
}

// ── Polling for async (ticketed) services ───────────────────────
export function useTicketPolling(
  path: string,
  asyncResult: AsyncResult | null,
  ticketStatus: TicketStatus | null,
  setTicketStatus: (s: TicketStatus) => void
) {
  const [polling, setPolling] = useState(false);

  async function checkTicket(silent = false) {
    if (!asyncResult) return;
    if (!silent) setPolling(true);
    try {
      const result = await api.get<{ status: boolean; data: TicketStatus }>(`${path}/${asyncResult.ticket_id}`);
      setTicketStatus(result.data);
    } catch {
      // transient failures just mean "still can't tell yet" - the poll loop will retry
    } finally {
      if (!silent) setPolling(false);
    }
  }

  useEffect(() => {
    if (!asyncResult || ticketStatus?.status === 'success' || ticketStatus?.status === 'failed') return;
    void checkTicket(true);
    const id = setInterval(() => void checkTicket(true), 6000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asyncResult, ticketStatus?.status]);

  return { polling, checkTicket };
}

// ── Slip Type card grid (used by NIN, BVN, IPE, Validation pages) ─
export function TierCardGrid<T extends string>({
  options,
  labels,
  value,
  onChange,
  priceFor,
  iconFor,
  imageFor,
  disabledFor,
  disabledLabel = 'Coming Soon',
}: {
  options: readonly T[];
  labels: Record<T, string>;
  value: T;
  onChange: (v: T) => void;
  priceFor: (v: T) => number | undefined;
  /** Optional per-option preview icon (see SlipIcon) — shown above the label, matching the reference design's little slip images. Ignored when imageFor is given. */
  iconFor?: (v: T) => SlipIconVariant;
  /** Optional per-option real sample-slip photo (path under /public, e.g. /branding/premium slip.jpg) — takes priority over iconFor. */
  imageFor?: (v: T) => string;
  /** Optional per-option "not available yet" flag — dims the tile, blocks selection, and shows disabledLabel instead of a price (rather than an endless "Price loading…" for an option with no real price). */
  disabledFor?: (v: T) => boolean;
  disabledLabel?: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
      {options.map((option) => {
        const disabled = disabledFor?.(option) ?? false;
        return (
          <button
            key={option}
            type="button"
            disabled={disabled}
            onClick={() => !disabled && onChange(option)}
            className={`${TILE_CLASSES} ${value === option && !disabled ? TILE_SELECTED_CLASSES : TILE_UNSELECTED_CLASSES} ${disabled ? 'cursor-not-allowed opacity-60 hover:translate-y-0 hover:brightness-100' : ''}`}
          >
            {imageFor ? (
              <div className="mb-2 overflow-hidden rounded-lg bg-white/10">
                <img src={imageFor(option)} alt={labels[option]} className="h-16 w-full object-cover" />
              </div>
            ) : (
              iconFor && (
                <div className="mb-2 flex justify-center rounded-lg bg-white/10 p-1.5">
                  <SlipIcon variant={iconFor(option)} />
                </div>
              )
            )}
            <span className="block text-xs font-semibold text-white sm:text-sm">{labels[option]}</span>
            {disabled ? (
              <span className="mt-1 block text-xs font-bold text-white/70">{disabledLabel}</span>
            ) : (
              <span className="mt-1 block text-xs font-bold text-gold-300">{money(priceFor(option))}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Result views ──────────────────────────────────────────────────
// ── Shared "here's your slip" building blocks ───────────────────────
// Used by SlipResultView (synchronous providers) and AsyncResultView, once
// a ticket-based request (BVN Retrieval, IPE Clearance, Personalization,
// NIN Validation, Delinking) resolves to success. Previously only
// SlipResultView had a visible download button; a successful async ticket
// showed the personal-details overview and then just... stopped, with no
// obvious way to get the slip. Centralizing both here means any provider
// field named pdf_base64/pdf_url/slip_url is picked up and rendered the
// same way everywhere, instead of only where someone remembered to wire it.
function extractPdfFields(source: Record<string, unknown> | null | undefined) {
  const directPdf = typeof source?.pdf_base64 === 'string' && source.pdf_base64.trim().length > 0 ? source.pdf_base64 : null;
  // EaseID may return the document as "Pdf Base64" within user_data rather
  // than the usual pdf_base64 field. Accept either spelling without showing
  // the encoded document as a text row.
  const nestedPdf = source
    ? Object.entries(source).find(([key, value]) => /pdf|base64/i.test(key) && typeof value === 'string' && value.trim().length > 0)?.[1]
    : undefined;
  const pdfBase64 = directPdf ?? (typeof nestedPdf === 'string' ? nestedPdf : null);
  const pdfUrl =
    typeof source?.pdf_url === 'string' && source.pdf_url.trim().length > 0
      ? source.pdf_url
      : typeof source?.slip_url === 'string' && source.slip_url.trim().length > 0
        ? source.slip_url
        : null;
  return { pdfBase64, pdfUrl };
}

function DetailsOverviewGrid({ entries }: { entries: [string, unknown][] }) {
  if (!entries.length) return null;
  return (
    <div className="mt-4 grid gap-x-6 gap-y-2 rounded-xl bg-blue-50 p-4 sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="flex justify-between border-b border-blue-100 py-1.5 text-sm">
          <span className="font-body capitalize text-[#0b2f73]/70">{key.replace(/_/g, ' ')}</span>
          <span className="break-all text-right font-body font-semibold text-[#0b2f73]">{String(value)}</span>
        </div>
      ))}
    </div>
  );
}

function SlipDownloadAction({ pdfBase64, pdfUrl, reference }: { pdfBase64: string | null; pdfUrl: string | null; reference: string }) {
  const cleanBase64 = pdfBase64?.replace(/^data:application\/pdf;base64,/i, '') ?? null;
  const href = cleanBase64 ? `data:application/pdf;base64,${cleanBase64}` : pdfUrl?.startsWith('https://') ? pdfUrl : null;

  if (!href) {
    return (
      <p className="mt-4 rounded-xl border border-gold-500/30 bg-gold-500/10 p-3 font-body text-sm text-[#0b2f73]/80">
        The provider confirmed this request, but did not return a downloadable PDF. Keep the reference above and contact support; do not submit or pay for the request again.
      </p>
    );
  }
  return <a href={href} download={`${reference || 'slip'}.pdf`} target={cleanBase64 ? undefined : '_blank'} rel={cleanBase64 ? undefined : 'noreferrer'} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gold-500 py-3 font-display font-semibold text-ink"><Download size={16} /> Download PDF slip</a>;
}

function valueFor(data: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function DigitalSlipPreview({ data }: { data: Record<string, unknown> }) {
  const source = data.user_data && typeof data.user_data === 'object' && !Array.isArray(data.user_data) ? data.user_data as Record<string, unknown> : data;
  const firstName = valueFor(source, 'first_name', 'firstname', 'firstName');
  const lastName = valueFor(source, 'last_name', 'lastname', 'surname', 'lastName');
  const middleName = valueFor(source, 'middle_name', 'middlename', 'middleName');
  const name = [firstName, middleName, lastName].filter(Boolean).join(' ') || 'Verified Identity';
  const nin = valueFor(source, 'nin', 'nin_number', 'NIN');
  const photo = valueFor(source, 'photo', 'photo_base64', 'image', 'image_base64', 'passport', 'passport_photo');
  const photoSrc = photo ? (photo.startsWith('data:') ? photo : `data:image/jpeg;base64,${photo}`) : '';
  const initials = name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();

  if (!nin && !firstName && !lastName) return null;
  return (
    <article className="mt-4 overflow-hidden rounded-2xl border border-blue-200 bg-white shadow-sm">
      <div className="flex items-center justify-between bg-[#0b2f73] px-5 py-3 text-white"><span className="font-display font-bold">NIN Verification Slip</span><span className="rounded bg-gold-500 px-2 py-1 text-xs font-bold text-ink">VERIFIED</span></div>
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
        {photoSrc ? <img src={photoSrc} alt={name} className="h-24 w-24 rounded-xl border-2 border-gold-400 object-cover" /> : <div className="flex h-24 w-24 items-center justify-center rounded-xl bg-blue-100 font-display text-2xl font-bold text-[#0b2f73]">{initials}</div>}
        <div className="min-w-0 flex-1"><h3 className="font-display text-xl font-bold text-[#0b2f73]">{name}</h3><p className="mt-1 font-mono text-sm font-semibold text-[#0b2f73]">NIN: {nin || '—'}</p><div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-[#0b2f73]/80"><span>Gender: <b>{valueFor(source, 'gender') || '—'}</b></span><span>DOB: <b>{valueFor(source, 'date_of_birth', 'dob') || '—'}</b></span><span>Phone: <b>{valueFor(source, 'phone_number', 'phone') || '—'}</b></span><span className="truncate">Address: <b>{valueFor(source, 'address') || '—'}</b></span></div></div>
      </div>
    </article>
  );
}

export function SlipResultView({ result, message, onDone }: { result: SlipResult; message: string; onDone: () => void }) {
  const { pdfBase64, pdfUrl } = extractPdfFields({ ...result.user_data, pdf_base64: result.pdf_base64, pdf_url: result.pdf_url });
  const dataEntries = result.user_data ? Object.entries(result.user_data).filter(([key, v]) => v !== null && v !== undefined && !/pdf|base64/i.test(key)) : [];

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 rounded-lg border border-success-500/30 bg-success-500/5 px-4 py-3">
        <CheckCircle2 size={18} className="shrink-0 text-success-500" />
        <p className="font-body text-sm text-[#0b2f73]">{message}</p>
      </div>

      {result.user_data && <DigitalSlipPreview data={result.user_data} />}
      <DetailsOverviewGrid entries={dataEntries} />
      <SlipDownloadAction pdfBase64={pdfBase64} pdfUrl={pdfUrl} reference={result.reference} />

      <button onClick={onDone} className="mt-3 w-full rounded-xl border border-blue-200 py-2.5 font-body text-sm text-[#0b2f73]">
        Done
      </button>
    </div>
  );
}

export function AsyncResultView({
  ticket,
  status,
  polling,
  message,
  onRefresh,
  onDone,
}: {
  ticket: AsyncResult;
  status: TicketStatus | null;
  polling: boolean;
  message: string;
  onRefresh: () => void;
  onDone: () => void;
}) {
  const state = status?.status ?? 'pending';
  // Pull any pdf_base64/pdf_url/slip_url out of the raw provider response
  // before turning the rest into the overview table below - otherwise a
  // provider that includes the slip inline would dump a giant unreadable
  // base64 blob as one of the "detail" rows instead of a proper file.
  const { pdfBase64, pdfUrl } = extractPdfFields(status?.response);
  const responseEntries = status?.response
    ? Object.entries(status.response).filter(([key, v]) => v !== null && v !== undefined && !['pdf_base64', 'pdf_url', 'slip_url'].includes(key))
    : [];

  return (
    <div className="mt-6">
      {message && <p className="mb-4 rounded-lg bg-blue-50 p-3 font-body text-sm text-[#0b2f73]">{message}</p>}

      <div
        className={`flex items-center gap-3 rounded-xl border px-4 py-4 ${
          state === 'success' ? 'border-success-500/30 bg-success-500/5' : state === 'failed' ? 'border-ember-500/30 bg-ember-500/5' : 'border-blue-100 bg-blue-50'
        }`}
      >
        {state === 'success' ? (
          <CheckCircle2 size={22} className="shrink-0 text-success-500" />
        ) : state === 'failed' ? (
          <XCircle size={22} className="shrink-0 text-ember-500" />
        ) : (
          <Clock size={22} className="shrink-0 text-gold-600" />
        )}
        <div>
          <p className="font-display font-semibold text-[#0b2f73]">{state === 'success' ? 'Approved' : state === 'failed' ? 'Rejected — refunded to your wallet' : 'Pending review'}</p>
          <p className="break-all font-mono text-xs text-[#0b2f73]/70">Ticket: {ticket.ticket_id}</p>
        </div>
      </div>

      <DetailsOverviewGrid entries={responseEntries} />
      {state === 'success' && <SlipDownloadAction pdfBase64={pdfBase64} pdfUrl={pdfUrl} reference={ticket.reference} />}

      {state === 'pending' && (
        <button onClick={onRefresh} disabled={polling} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-blue-200 py-2.5 font-body text-sm text-[#0b2f73] disabled:opacity-60">
          {polling ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Check again now
        </button>
      )}
      <p className="mt-2 text-center font-body text-[11px] text-[#0b2f73]/50">We're also checking automatically every few seconds.</p>

      <button onClick={onDone} className="mt-3 w-full rounded-xl border border-blue-200 py-2.5 font-body text-sm text-[#0b2f73]">
        Done
      </button>
    </div>
  );
}

export function VerificationHistoryView({ history, loading }: { history: VerificationHistory[]; loading: boolean }) {
  return (
    <section className="mt-8 border-t border-blue-100 pt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-base font-bold text-[#0b2f73]">Recent requests</h3>
        <span className="font-body text-xs text-[#0b2f73]/70">Available for 7 days</span>
      </div>
      {loading ? (
        <p className="mt-3 font-body text-sm text-[#0b2f73]/70">Loading recent requests…</p>
      ) : history.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-blue-200 px-4 py-4 font-body text-sm text-[#0b2f73]/70">No request for this service in the last 7 days.</p>
      ) : (
        <div className="mt-3 divide-y divide-blue-100 overflow-hidden rounded-xl border border-blue-100 bg-blue-50">
          {history.map((entry) => {
            const base64 = entry.pdf_base64?.replace(/^data:application\/pdf;base64,/i, '');
            const href = base64 ? `data:application/pdf;base64,${base64}` : entry.pdf_url?.startsWith('https://') ? entry.pdf_url : null;
            return (
              <div key={entry.reference} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="break-all font-mono text-xs font-semibold text-[#0b2f73]">{entry.reference}</p>
                  <p className="mt-1 font-body text-xs text-[#0b2f73]/70">{new Date(entry.created_at).toLocaleString()}</p>
                </div>
                {href ? (
                  <a href={href} download={`${entry.reference}.pdf`} target={base64 ? undefined : '_blank'} rel={base64 ? undefined : 'noreferrer'} className="flex shrink-0 items-center gap-2 rounded-lg bg-gold-500 px-3 py-2 font-body text-xs font-bold text-ink">
                    <Download size={14} /> Retrieve PDF
                  </a>
                ) : (
                  <span className="shrink-0 font-body text-xs font-semibold capitalize text-[#0b2f73]/70">{entry.status}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── Page header (tile), matching the SLT reference screenshots ──────
export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mt-5 rounded-2xl bg-[#0b2f73] p-4 sm:p-6">
      <p className="font-body text-xs font-semibold text-gold-300 sm:text-sm">Identity services</p>
      <h1 className="mt-1 font-display text-2xl font-bold text-white sm:text-3xl">{title}</h1>
      {subtitle && <p className="mt-2 font-body text-sm text-blue-100">{subtitle}</p>}
    </header>
  );
}

export function StepLabel({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="mt-6 flex items-center gap-2 border-b border-blue-100 pb-2">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gold-500 font-body text-xs font-bold text-ink">{n}</span>
      <h3 className="font-display text-sm font-bold text-[#0b2f73]">{children}</h3>
    </div>
  );
}

export function ConsentCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="mt-5 flex items-start gap-2 font-body text-xs text-[#0b2f73]/80">
      <input type="checkbox" required checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 rounded border-blue-300 text-[#0b2f73] focus:ring-[#0b2f73]" />
      By checking this box, you agree that the owner of the ID has granted you consent to verify his/her identity.
    </label>
  );
}

// ── Ticket tracking table (Personalization, BVN Retrieval, etc.) ────
// Unlike useVerificationHistory above (SUCCESS-only, 7-day window, backed
// by GET /verification/history), this is backed by GET /verification/tickets
// and includes every status - PENDING requests are the whole point of a
// "Check Status" tracking table like the reference screenshots show.
export type ServiceTicket = {
  reference: string;
  ticket_id: string | null;
  status: string;
  message: string;
  amount: number;
  tracking_id: string | null;
  nin: string | null;
  email: string | null;
  created_at: string;
  updated_at: string;
};

export function useServiceTickets(serviceKey: string) {
  const [tickets, setTickets] = useState<ServiceTicket[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const result = await api.get<{ status: boolean; data: ServiceTicket[] }>(`/verification/tickets?service=${encodeURIComponent(serviceKey)}`);
      setTickets(result.data ?? []);
    } catch {
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceKey]);

  return { tickets, loading, refresh };
}

export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    success: 'bg-success-500/15 text-success-600',
    pending: 'bg-gold-500/15 text-gold-700',
    failed: 'bg-ember-500/15 text-ember-600',
    reversed: 'bg-ember-500/15 text-ember-600'
  };
  const labels: Record<string, string> = { success: 'Completed', pending: 'Processing', failed: 'Rejected', reversed: 'Refunded' };
  return <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${styles[status] ?? 'bg-blue-100 text-[#0b2f73]'}`}>{labels[status] ?? status}</span>;
}

/**
 * Small preview icons for each slip type, sitting above the label in
 * TierCardGrid — matching the reference design's use of a distinct little
 * card image per tier so the options are recognisable at a glance.
 * Deliberately ORIGINAL, abstract artwork (a generic card silhouette with a
 * photo circle / barcode / QR pattern) rather than any reproduction of the
 * actual NIMC card or logo, which is protected government design - these
 * only need to communicate "this is roughly what you'll receive", not be a
 * faithful likeness.
 */
export type SlipIconVariant = 'none' | 'regular' | 'standard' | 'premium' | 'document';

export function SlipIcon({ variant }: { variant: SlipIconVariant }) {
  if (variant === 'none') {
    return (
      <svg viewBox="0 0 40 40" className="mx-auto h-9 w-9 text-white/50" fill="none">
        <rect x="4" y="7" width="32" height="26" rx="3" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
        <circle cx="15" cy="17" r="3.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M6 29l7-7 5 5 6-8 10 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (variant === 'document') {
    return (
      <svg viewBox="0 0 40 40" className="mx-auto h-9 w-9" fill="none">
        <rect x="8" y="4" width="24" height="32" rx="2.5" fill="#f4f1e8" stroke="#c9c2ad" strokeWidth="1.5" />
        <rect x="13" y="11" width="14" height="2" rx="1" fill="#0b2f73" />
        <rect x="13" y="16" width="14" height="1.6" rx="0.8" fill="#9aa5c0" />
        <rect x="13" y="20" width="10" height="1.6" rx="0.8" fill="#9aa5c0" />
        <rect x="13" y="27" width="14" height="4" rx="1" fill="#d8b34a" />
      </svg>
    );
  }
  if (variant === 'regular') {
    return (
      <svg viewBox="0 0 40 40" className="mx-auto h-9 w-9" fill="none">
        <rect x="3" y="9" width="34" height="22" rx="2.5" fill="#fbfaf5" stroke="#c9c2ad" strokeWidth="1.4" />
        <rect x="3" y="9" width="34" height="4" fill="#1f8a45" />
        <circle cx="11" cy="21" r="4.2" fill="#c7d0e4" stroke="#7f8bab" strokeWidth="1" />
        <rect x="18" y="17" width="15" height="1.6" rx="0.8" fill="#0b2f73" />
        <rect x="18" y="21" width="12" height="1.4" rx="0.7" fill="#9aa5c0" />
        <rect x="18" y="24.5" width="13" height="1.4" rx="0.7" fill="#9aa5c0" />
      </svg>
    );
  }
  if (variant === 'standard') {
    return (
      <svg viewBox="0 0 40 40" className="mx-auto h-9 w-9" fill="none">
        <rect x="3" y="9" width="34" height="22" rx="2.5" fill="#e9ebef" stroke="#b7bdc9" strokeWidth="1.4" />
        <circle cx="11" cy="18" r="4.4" fill="#c3c8d1" stroke="#8b93a3" strokeWidth="1" />
        <rect x="4" y="26" width="32" height="4" fill="#232733" />
        {[6, 8.5, 11, 14.5, 17, 19.5, 22, 25.5, 28, 30.5, 33].map((x, i) => (
          <rect key={x} x={x} y="26.5" width={i % 3 === 0 ? 1.4 : 0.9} height="3" fill="#f5f5f7" />
        ))}
      </svg>
    );
  }
  // premium — the green e-NIN slip
  return (
    <svg viewBox="0 0 40 40" className="mx-auto h-9 w-9" fill="none">
      <rect x="3" y="9" width="34" height="22" rx="2.5" fill="#1f5c33" stroke="#123d20" strokeWidth="1.4" />
      <circle cx="11" cy="20" r="4.4" fill="#3d7d55" stroke="#a9d9b9" strokeWidth="1" />
      <rect x="18" y="15.5" width="15" height="1.5" rx="0.75" fill="#d9f2e1" />
      <rect x="18" y="19" width="11" height="1.3" rx="0.65" fill="#9dcbac" />
      <g fill="#e8f7ec">
        <rect x="28" y="22" width="2.2" height="2.2" />
        <rect x="31.2" y="22" width="2.2" height="2.2" />
        <rect x="28" y="25.2" width="2.2" height="2.2" />
        <rect x="31.2" y="25.2" width="1" height="1" />
      </g>
    </svg>
  );
}
