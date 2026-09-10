import { Link } from 'react-router-dom';
import { MessageCircle, Mail, Phone, Radio } from 'lucide-react';
import Logo from './Logo';
import { CONTACT, whatsappLink } from '../lib/contact';

export default function Footer() {
  return (
    <footer className="border-t border-ink-line bg-ink">
      <div className="mx-auto max-w-6xl px-5 py-14">
        <div className="grid gap-10 md:grid-cols-[1.3fr_1fr_1fr]">
          <div>
            <Logo dark />
            <p className="mt-4 max-w-xs font-body text-sm leading-relaxed text-cream/60">
              Fund your wallet once, top up airtime, data, cable and bills in seconds —
              no queues, no delays.
            </p>
          </div>

          <div>
            <h3 className="font-display text-xs font-semibold uppercase tracking-widest text-gold-500">
              Company
            </h3>
            <ul className="mt-4 space-y-2.5 font-body text-sm text-cream/70">
              <li><a href="#services" className="hover:text-cream">Services</a></li>
              <li><a href="#how-it-works" className="hover:text-cream">How it works</a></li>
              <li><Link to="/privacy-policy" className="hover:text-cream">Privacy Policy</Link></li>
              <li><Link to="/terms" className="hover:text-cream">Terms &amp; Conditions</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="font-display text-xs font-semibold uppercase tracking-widest text-gold-500">
              Talk to us
            </h3>
            <ul className="mt-4 space-y-3 font-body text-sm text-cream/70">
              <li>
                <a
                  href={whatsappLink('Hello MARIA Digital Solutions, I need help')}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 hover:text-cream"
                >
                  <MessageCircle size={15} className="text-gold-500" /> {CONTACT.whatsapp}
                </a>
              </li>
              <li className="flex items-center gap-2">
                <Phone size={15} className="text-gold-500" /> {CONTACT.phoneAlt}
              </li>
              <li>
                <a
                  href={`mailto:${CONTACT.email}`}
                  className="flex items-center gap-2 hover:text-cream"
                >
                  <Mail size={15} className="text-gold-500" /> {CONTACT.email}
                </a>
              </li>
              <li>
                <a
                  href={CONTACT.whatsappChannelUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 hover:text-cream"
                >
                  <Radio size={15} className="text-gold-500" /> WhatsApp Channel
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-ink-line pt-6 font-body text-xs text-cream/40 sm:flex-row">
          <p>© {new Date().getFullYear()} MARIA Digital Solutions. All rights reserved.</p>
          <p>Kindness Digital Branding and IT Solutions</p>
        </div>
      </div>
    </footer>
  );
}

