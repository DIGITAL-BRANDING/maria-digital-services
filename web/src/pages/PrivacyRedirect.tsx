import { useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

// Privacy Policy and Terms are already rendered server-side by the backend
// (see major_data_link_backend/src/routes/legal.routes.ts) so there's a
// single source of truth shared with the Flutter app's in-app legal screen.
// This page just forwards there instead of duplicating the content.
export default function PrivacyRedirect({ page }: { page: 'privacy-policy' | 'terms' }) {
  useEffect(() => {
    window.location.replace(`${API_BASE}/${page}`);
  }, [page]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-cream">
      <div className="h-8 w-8 rounded-full border-2 border-gold-500 border-t-transparent animate-spin" />
    </div>
  );
}
