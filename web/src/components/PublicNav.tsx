import { Link } from 'react-router-dom';
import Logo from './Logo';
import { useAuth } from '../lib/auth';

export default function PublicNav() {
  const { user } = useAuth();
  return (
    <header className="sticky top-0 z-50 border-b border-blue-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <Link to="/">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-7 md:flex">
            <a href="#services" className="font-body text-sm text-slate-600 transition hover:text-brand-600">
            Results
          </a>
            <a href="#features" className="font-body text-sm text-slate-600 transition hover:text-brand-600">
            How it works
          </a>
            <a href="#testimonials" className="font-body text-sm text-slate-600 transition hover:text-brand-600">
            Get the app
          </a>
        </nav>
        <div className="flex items-center gap-3">
          {user ? (
            <Link
              to="/dashboard"
              className="rounded-lg bg-gold-500 px-4 py-2 font-display text-sm font-semibold text-ink transition hover:bg-gold-400"
            >
              Dashboard
            </Link>
          ) : (
            <>
              <Link
                to="/login"
              className="hidden font-body text-sm text-slate-600 transition hover:text-brand-600 sm:block"
              >
                Sign in
              </Link>
              <Link
                to="/login"
                className="rounded-lg bg-gold-500 px-4 py-2 font-display text-sm font-semibold text-ink transition hover:bg-gold-400"
              >
                Create Account
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
