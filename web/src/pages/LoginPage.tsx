import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Logo from '../components/Logo';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [needsPin, setNeedsPin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      await login(identifier, password, needsPin ? pin : undefined);
      navigate('/dashboard');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'LOGIN_PIN_REQUIRED') {
        setNeedsPin(true);
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Something went wrong. Please try again.');
      }
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
          <h1 className="font-display text-xl font-bold text-ink">
            {needsPin ? 'Enter your login PIN' : 'Log-In To Your Account'}
          </h1>
          <p className="mt-1 font-body text-sm text-ink-600">
            {needsPin
              ? 'This account has a 6-digit PIN set for extra security.'
              : 'Sign in to fund your wallet and top up instantly.'}
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {!needsPin ? (
              <>
                <Field
                  label="Email or phone number"
                  value={identifier}
                  onChange={setIdentifier}
                  type="text"
                  autoFocus
                />
                <Field
                  label="Password"
                  value={password}
                  onChange={setPassword}
                  type="password"
                />
              </>
            ) : (
              <Field
                label="6-digit login PIN"
                value={pin}
                onChange={(v) => setPin(v.replace(/\D/g, '').slice(0, 6))}
                type="password"
                inputMode="numeric"
                autoFocus
              />
            )}

            {error && (
              <p className="rounded-lg bg-ember-500/10 px-3 py-2 font-body text-sm text-ember-600">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={isLoading || (needsPin ? pin.length !== 6 : !identifier || !password)}
              className="flex w-full items-center justify-center rounded-lg bg-gold-500 py-3 font-display text-sm font-semibold text-ink transition hover:bg-gold-400 disabled:opacity-50"
            >
              {isLoading ? <Spinner /> : needsPin ? 'Verify & sign in' : 'Sign in'}
            </button>
            {!needsPin && (
              <Link to="/forgot-password" className="flex justify-center font-body text-sm font-medium text-gold-600 hover:text-gold-700">
                Forgot password?
              </Link>
            )}
          </form>
        </div>

        <p className="mt-6 text-center font-body text-sm text-ink-600">
          Don't have an account?{' '}
          <Link to="/register" className="font-semibold text-gold-600 hover:text-gold-700">
            Create Account
          </Link>
        </p>
        <Link
          to="/"
          className="mt-4 flex justify-center font-body text-sm font-medium text-gold-600 transition hover:text-gold-700"
        >
          Back to home
        </Link>
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
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoFocus?: boolean;
  inputMode?: 'numeric' | 'text';
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
          inputMode={inputMode}
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

export function Spinner() {
  return <div className="h-4 w-4 animate-spin rounded-full border-2 border-ink border-t-transparent" />;
}
