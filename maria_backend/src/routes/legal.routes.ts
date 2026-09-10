import { Router } from 'express';
import { renderLegalPage } from '../lib/render-legal-page.js';
import { EFFECTIVE_DATE, PRIVACY_SECTIONS, TERMS_SECTIONS } from '../lib/legal-content.js';

export const legalRoutes = Router();

// Matches major_data_link/lib/core/config/app_config.dart's supportEmailDisplay/supportWhatsApp/supportPhoneAlt.
// If you change contact details there, update these constants too.
const SUPPORT_EMAIL = 'kindnesscomp20@gmail.com / sunusiusama94@gmail.com';
const SUPPORT_WHATSAPP = '+2348037289774';
const SUPPORT_PHONE_ALT = '07025859543';
const SUPPORT_WHATSAPP_CHANNEL_URL = 'https://whatsapp.com/channel/0029Vb8KzHy5PO0stgnsNy0l';

legalRoutes.get('/privacy-policy', (_req, res) => {
  res.type('html').send(
    renderLegalPage({
      title: 'Privacy Policy',
      effectiveDate: EFFECTIVE_DATE,
      sections: PRIVACY_SECTIONS,
      supportEmail: SUPPORT_EMAIL,
      supportWhatsApp: SUPPORT_WHATSAPP,
      supportPhoneAlt: SUPPORT_PHONE_ALT,
      supportWhatsAppChannelUrl: SUPPORT_WHATSAPP_CHANNEL_URL
    })
  );
});

legalRoutes.get('/terms', (_req, res) => {
  res.type('html').send(
    renderLegalPage({
      title: 'Terms & Conditions',
      effectiveDate: EFFECTIVE_DATE,
      sections: TERMS_SECTIONS,
      supportEmail: SUPPORT_EMAIL,
      supportWhatsApp: SUPPORT_WHATSAPP,
      supportPhoneAlt: SUPPORT_PHONE_ALT,
      supportWhatsAppChannelUrl: SUPPORT_WHATSAPP_CHANNEL_URL
    })
  );
});

