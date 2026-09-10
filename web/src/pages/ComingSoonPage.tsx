import { Link } from 'react-router-dom';
import { ArrowLeft, MessageCircle } from 'lucide-react';
import AppShell from '../components/AppShell';
import { TINT_CLASSES, type ServiceItem } from '../lib/services';
import { whatsappLink } from '../lib/contact';

export default function ComingSoonPage({ service }: { service: ServiceItem }) {
  const Icon = service.icon;
  const iconAsset = service.route === '/bvn-crm' ? '/branding/BVN CRM.png' : null;
  const tint = TINT_CLASSES[service.tint];

  return (
    <AppShell>
      <Link
        to="/dashboard"
        className="inline-flex items-center gap-1.5 font-body text-sm text-ink-600 transition hover:text-ink"
      >
        <ArrowLeft size={15} /> Back to dashboard
      </Link>

      <div className="mt-8 flex flex-col items-center rounded-2xl border border-parchment-line bg-parchment px-6 py-14 text-center">
        <div className={`flex h-16 w-16 items-center justify-center rounded-2xl ${tint.bg} ${tint.text}`}>
          {iconAsset ? <img src={iconAsset} alt="" className="h-full w-full rounded-2xl object-contain" /> : <Icon size={28} />}
        </div>
        <h1 className="mt-5 font-display text-xl font-bold text-ink">{service.label}</h1>
        <p className="mt-2 max-w-sm font-body text-sm text-ink-600">{service.description}</p>

        <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-blue-300 bg-blue-100 px-4 py-1.5 font-body text-xs font-semibold text-blue-700">
          Under Development
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <a
            href={whatsappLink(`Hello MARIA Digital Solutions, I'd like help with ${service.label}`)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2.5 font-body text-sm font-semibold text-cream transition hover:bg-ink-soft"
          >
            <MessageCircle size={15} className="text-gold-500" />
            Ask us on WhatsApp
          </a>
        </div>
      </div>
    </AppShell>
  );
}

