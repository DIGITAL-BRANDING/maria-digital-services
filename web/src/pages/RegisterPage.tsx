import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Logo from '../components/Logo';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { Spinner } from './LoginPage';

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setIsLoading(true);
    try {
      await register({
        full_name: fullName,
        email,
        phone,
        password,
        referral_code: params.get('ref') || undefined,
      });
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f1f3f6] px-5 py-12">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-8 flex justify-center">
          <Logo />
        </Link>

        <div className="rounded-lg border border-slate-200 bg-white p-7 shadow-md">
          <h1 className="font-display text-xl font-bold text-[#0A2540]">Create Your Account</h1>
          <p className="mt-1 font-body text-sm text-ink-600">
            Takes under a minute — no paperwork.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <Field label="Full name" value={fullName} onChange={setFullName} autoFocus />
            <Field label="Email address" value={email} onChange={setEmail} type="email" />
            <Field label="Phone number" value={phone} onChange={setPhone} type="tel" />
            <Field
              label="Password (min. 8 characters)"
              value={password}
              onChange={setPassword}
              type="password"
            />

            {error && (
              <p className="rounded-lg bg-ember-500/10 px-3 py-2 font-body text-sm text-ember-600">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={isLoading || !fullName || !email || !phone || !password}
              className="flex w-full items-center justify-center rounded-lg bg-gold-500 py-3 font-display text-sm font-semibold text-ink transition hover:bg-gold-400 disabled:opacity-50"
            >
              {isLoading ? <Spinner /> : 'Create my wallet'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center font-body text-sm text-ink-600">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-gold-600 hover:text-gold-700">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoFocus?: boolean;
}) {
  const [isVisible, setIsVisible] = useState(false);
  const isSecretField = type === 'password';

  return (
    <label className="block">
      <span className="mb-1.5 block font-body text-xs font-medium text-ink-600">{label}</span>
      <div className="relative">
        <input
          type={isSecretField && isVisible ? 'text' : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={autoFocus}
          required
          className={`w-full rounded-lg border border-parchment-line bg-cream px-3.5 py-2.5 font-body text-sm text-ink outline-none focus:border-gold-500${isSecretField ? ' pr-11' : ''}`}
        />
        {isSecretField && (
          <button
            type="button"
            onClick={() => setIsVisible((visible) => !visible)}
            aria-label={isVisible ? 'Hide password' : 'Show password'}
            aria-pressed={isVisible}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-xs font-medium text-ink-600 transition hover:text-ink focus:outline-none focus:ring-2 focus:ring-gold-500"
          >
            {isVisible ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
    </label>
  );
}
