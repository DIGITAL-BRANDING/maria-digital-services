import type { LegalSection } from './legal-content.js';

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function renderLegalPage(params: {
  title: string;
  effectiveDate: string;
  sections: LegalSection[];
  supportEmail: string;
  supportWhatsApp: string;
  supportPhoneAlt?: string;
  supportWhatsAppChannelUrl?: string;
}) {
  const sectionsHtml = params.sections
    .map(
      (s) => `
      <section>
        <h2>${escapeHtml(s.title)}</h2>
        <p>${escapeHtml(s.body)}</p>
      </section>`
    )
    .join('\n');

  const whatsappDigits = params.supportWhatsApp.replace(/\+/g, '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(params.title)} — MAJOR DATA-LINK</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: #f7f8fa;
      color: #1a1d21;
      line-height: 1.6;
    }
    .wrap { max-width: 720px; margin: 0 auto; padding: 32px 20px 64px; }
    header { margin-bottom: 28px; }
    h1 { font-size: 26px; font-weight: 800; margin: 0 0 6px; }
    .effective { color: #6b7280; font-size: 14px; margin: 0; }
    section { margin-bottom: 22px; }
    h2 { font-size: 17px; font-weight: 700; margin: 0 0 6px; }
    p { margin: 0; color: #33383f; font-size: 15px; }
    footer {
      margin-top: 36px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      font-size: 14px;
    }
    footer a { color: #0a7d3d; text-decoration: none; font-weight: 600; }
    .brand {
      display: inline-block;
      font-weight: 800;
      letter-spacing: 0.02em;
      color: #0a7d3d;
      margin-bottom: 18px;
      font-size: 14px;
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <span class="brand">MAJOR DATA-LINK</span>
    <header>
      <h1>${escapeHtml(params.title)}</h1>
      <p class="effective">Effective date: ${escapeHtml(params.effectiveDate)}</p>
    </header>
    ${sectionsHtml}
    <footer>
      <p>
        Contact us: <a href="mailto:${escapeHtml(params.supportEmail)}">${escapeHtml(params.supportEmail)}</a>
        &nbsp;|&nbsp;
        <a href="https://wa.me/${escapeHtml(whatsappDigits)}">WhatsApp ${escapeHtml(params.supportWhatsApp)}</a>
        ${params.supportPhoneAlt ? `&nbsp;|&nbsp; Phone: ${escapeHtml(params.supportPhoneAlt)}` : ''}
        ${params.supportWhatsAppChannelUrl ? `&nbsp;|&nbsp; <a href="${escapeHtml(params.supportWhatsAppChannelUrl)}">WhatsApp Channel</a>` : ''}
      </p>
    </footer>
  </div>
</body>
</html>`;
}

