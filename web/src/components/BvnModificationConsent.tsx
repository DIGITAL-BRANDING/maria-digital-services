import { useEffect } from 'react';
import { AlertTriangle, CheckCircle2, FileText, Scale, ShieldCheck, Wallet, X, type LucideIcon } from 'lucide-react';

/**
 * Consent & Authorization modal for BVN Modification.
 *
 * Styling note: every colour that carries meaning here (header, text, borders,
 * buttons) is an explicit hex value rather than a default-palette utility such
 * as `bg-blue-600` / `text-slate-700`. Some customers' phones render the
 * default Tailwind palette (oklch based) as nothing at all - the header went
 * white-on-white and the "I Agree" button vanished - while explicit hex values
 * always render. The overlay colour is an inline rgba for the same reason.
 *
 * Layout: a bottom sheet on phones (full width, footer always reachable,
 * stacked full-width buttons) and a centred card from `sm` up. It sits above
 * the floating WhatsApp / AI Help buttons (z-[60]) so they can't cover the
 * Decline / Agree buttons.
 */

type TermGroup = {
  title: string;
  icon: LucideIcon;
  /** Explicit hex colours: card background, border, and icon/bullet accent. */
  bg: string;
  border: string;
  accent: string;
  items: string[];
};

const TERM_GROUPS: TermGroup[] = [
  {
    title: 'Authorization & data use',
    icon: ShieldCheck,
    bg: 'bg-[#eff6ff]',
    border: 'border-[#bfdbfe]',
    accent: 'text-[#1d4ed8]',
    items: [
      'I authorize this platform and its agents to access and use my personal data, including my BVN, to process and modify my BVN record as requested.',
      'I understand this platform is not affiliated with NIBSS or any bank, but I voluntarily authorize this platform and its trusted agents to help modify my BVN details on my behalf.'
    ]
  },
  {
    title: 'Official guidance & ownership',
    icon: Scale,
    bg: 'bg-[#fffbeb]',
    border: 'border-[#fde68a]',
    accent: 'text-[#b45309]',
    items: [
      'Banks and NIBSS recommend modifications be done personally through an official channel. By using this platform, I voluntarily authorize the request to proceed on my behalf.',
      'I confirm that I am the BVN owner or have full consent and authorization from the BVN owner to act on their behalf.'
    ]
  },
  {
    title: 'Payment & processing',
    icon: Wallet,
    bg: 'bg-[#ecfdf5]',
    border: 'border-[#a7f3d0]',
    accent: 'text-[#047857]',
    items: [
      'I agree to pay the fixed service fee and authorize the platform to use lawful methods necessary to complete the requested modification.',
      'Updates may reflect immediately in NIBSS records, but individual banks may delay synchronizing their own copy of your details.',
      'Wallet funds are non-withdrawable. Failed services are refunded to the wallet only.'
    ]
  },
  {
    title: 'Other terms',
    icon: FileText,
    bg: 'bg-[#f1f5f9]',
    border: 'border-[#cbd5e1]',
    accent: 'text-[#334155]',
    items: [
      'I will not submit the same request on another platform while it is being processed here.',
      'This agreement applies to all past, current, and future BVN modification requests submitted through this platform.',
      'If there is a delay, issue, or network failure on the bank/NIBSS side, I agree to wait until it is resolved and not submit duplicate requests.'
    ]
  }
];

export function BvnModificationConsent({ open, onAgree, onClose }: { open: boolean; onAgree: () => void; onClose: () => void }) {
  // Hooks run before the early return so their order never changes between renders.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4"
      style={{ backgroundColor: 'rgba(7, 26, 61, 0.72)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="bvn-consent-title"
    >
      <section className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl supports-[height:1dvh]:max-h-[92dvh] sm:rounded-3xl">
        <header className="flex shrink-0 items-start gap-3 bg-[#0b2f73] px-4 py-4 sm:px-6 sm:py-5">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1d4287]">
            <ShieldCheck size={22} className="text-[#f7c948]" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="bvn-consent-title" className="text-lg font-bold leading-tight text-white sm:text-2xl">
              Consent &amp; Authorization
            </h2>
            <p className="mt-1 text-sm leading-snug text-[#dbeafe]">Please review and accept the terms before proceeding.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white hover:bg-[#1d4287]"
          >
            <X size={22} aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 sm:space-y-4 sm:px-6">
          <div className="flex items-start gap-3 rounded-xl border border-[#fecdd3] border-l-4 border-l-[#e11d48] bg-[#fff1f2] p-3 sm:p-4">
            <AlertTriangle size={20} className="mt-0.5 shrink-0 text-[#e11d48]" aria-hidden="true" />
            <p className="text-sm leading-relaxed text-[#881337]">
              <b>Important:</b> read this carefully before requesting a BVN modification. This is a binding agreement.
            </p>
          </div>

          {TERM_GROUPS.map(({ title, icon: Icon, bg, border, accent, items }) => (
            <section key={title} className={`rounded-2xl border p-3 sm:p-4 ${bg} ${border}`}>
              <h3 className="flex items-center gap-2 text-sm font-bold text-[#0f172a] sm:text-base">
                <Icon size={18} className={`shrink-0 ${accent}`} aria-hidden="true" />
                {title}
              </h3>
              <ul className="mt-2 space-y-2">
                {items.map((item) => (
                  <li key={item} className="flex gap-2 text-sm leading-relaxed text-[#1e293b]">
                    <span className={`mt-[0.55rem] h-1.5 w-1.5 shrink-0 rounded-full bg-current ${accent}`} aria-hidden="true" />
                    <span className="min-w-0 break-words">{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <p className="pb-1 text-center text-xs text-[#475569]">By tapping &ldquo;I Agree&rdquo; you accept all the terms above.</p>
        </div>

        <footer
          className="shrink-0 border-t border-[#dbe5f5] bg-white px-4 pt-3 sm:px-6"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-xl border-2 border-[#0b2f73] bg-white px-6 py-3 text-sm font-semibold text-[#0b2f73] hover:bg-[#eff6ff] sm:w-auto"
            >
              Not Agreed
            </button>
            <button
              type="button"
              onClick={onAgree}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#059669] px-6 py-3 text-sm font-bold text-white shadow-md hover:bg-[#047857] sm:w-auto"
            >
              <CheckCircle2 size={18} aria-hidden="true" />
              I Agree &amp; Continue
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
