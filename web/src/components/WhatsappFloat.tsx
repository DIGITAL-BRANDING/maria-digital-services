import { CONTACT } from '../lib/contact';

// bottom-4 + left-4 by default. Inside the authenticated app shell there's a
// fixed 256px (w-64) sidebar on lg screens, so pass sidebarOffset there to
// shift the button past it (lg:left-72) instead of sitting on top of the
// sidebar's Logout button. The public landing page has no sidebar, so it
// uses the plain left-4 position at every width.
export default function WhatsappFloat({ sidebarOffset = false }: { sidebarOffset?: boolean }) {
  return (
    <a
      href={CONTACT.whatsappGroupUrl}
      target="_blank"
      rel="noreferrer"
      aria-label="Join our WhatsApp group"
      title="Join our WhatsApp group"
      className={`fixed bottom-4 left-4 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] shadow-2xl shadow-black/30 transition hover:scale-105 ${sidebarOffset ? 'lg:left-72' : ''}`}
    >
      <svg viewBox="0 0 32 32" className="h-8 w-8" fill="#ffffff" aria-hidden="true">
        <path d="M16.004 4C9.377 4 4 9.373 4 16c0 2.24.62 4.43 1.797 6.34L4 28l5.82-1.766A11.94 11.94 0 0 0 16.004 28C22.63 28 28 22.627 28 16S22.63 4 16.004 4Zm7.03 16.94c-.297.834-1.47 1.53-2.406 1.727-.64.135-1.474.243-4.283-.92-3.594-1.488-5.906-5.14-6.086-5.377-.176-.24-1.454-1.937-1.454-3.695 0-1.758.906-2.62 1.226-2.98.297-.334.66-.417.883-.417.223 0 .445.002.64.012.207.01.484-.078.756.578.297.71.996 2.457 1.082 2.635.086.178.145.387.03.625-.117.24-.175.39-.35.6-.176.21-.37.47-.527.63-.176.18-.36.373-.156.73.207.36.918 1.514 1.973 2.451 1.355 1.207 2.5 1.58 2.86 1.758.36.178.57.148.78-.09.212-.238.906-1.057 1.148-1.42.242-.36.485-.3.816-.18.332.12 2.113.996 2.477 1.176.363.18.605.27.695.418.09.15.09.87-.207 1.71Z" />
      </svg>
    </a>
  );
}
