import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Fingerprint, Lock, Mail, Smartphone, Wifi } from 'lucide-react';
import Logo from '../components/Logo';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';

// Only used to pre-fill the identifier field on a return visit when
// "Remember me" was checked - never stores the password or PIN. Login
// itself still goes through the normal identifier+password (+PIN) flow
// every time; this just saves re-typing an email/phone number.
const REMEMBERED_IDENTIFIER_KEY = 'maria_remembered_identifier';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [needsPin, setNeedsPin] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const remembered = localStorage.getItem(REMEMBERED_IDENTIFIER_KEY);
    if (remembered) {
      setIdentifier(remembered);
      setRememberMe(true);
    }
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      await login(identifier, password, needsPin ? pin : undefined);
      if (rememberMe) {
        localStorage.setItem(REMEMBERED_IDENTIFIER_KEY, identifier);
      } else {
        localStorage.removeItem(REMEMBERED_IDENTIFIER_KEY);
      }
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
    <div className="relative min-h-screen overflow-hidden bg-cream px-5 py-10">
      {/* Decorative only - hidden below md so they never crowd the form on a
          phone screen. NIN is deliberately left out here on purpose. */}
      <ServiceBadge
        icon={<Wifi size={20} />}
        label="Data Purchase"
        className="left-[6%] top-[14%] hidden md:flex"
        tilt="-6deg"
        delay="0s"
      />
      <ServiceBadge
        icon={<Smartphone size={20} />}
        label="Airtime Topup"
        className="right-[8%] top-[20%] hidden lg:flex"
        tilt="5deg"
        delay="1.1s"
      />
      <ServiceBadge
        icon={<Fingerprint size={20} />}
        label="BVN Verification"
        className="bottom-[10%] left-[10%] hidden lg:flex"
        tilt="-4deg"
        delay="2.2s"
      />

      <div className="relative z-10 mx-auto max-w-md">
        <Link to="/" className="mb-8 flex justify-center">
          <Logo />
        </Link>

        <div className="rounded-2xl border border-parchment-line bg-white p-7 shadow-lg shadow-ink/5 sm:p-9">
          <h1 className="font-display text-2xl font-bold text-ink">
            {needsPin ? 'Enter your login PIN' : 'Welcome back'}
          </h1>
          <p className="mt-2 font-body text-sm text-ink-600">
            {needsPin
              ? 'This account has a 6-digit PIN set for extra security.'
              : 'Sign in to fund your wallet, top up instantly, and pick up right where you left off.'}
          </p>

          <form onSubmit={handleSubmit} className="mt-7 space-y-5">
            {!needsPin ? (
              <>
                <IconField
                  label="Email or phone number"
                  icon={<Mail size={17} />}
                  value={identifier}
                  onChange={setIdentifier}
                  type="text"
                  autoFocus
                />
                <IconField
                  label="Password"
                  icon={<Lock size={17} />}
                  value={password}
                  onChange={setPassword}
                  type="password"
                />

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex cursor-pointer items-center gap-2 font-body text-sm text-ink-600">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="h-4 w-4 rounded border-parchment-line text-gold-500 focus:ring-gold-500"
                    />
                    Remember me
                  </label>
                  <Link to="/forgot-password" className="font-body text-sm font-semibold text-ember-500 hover:text-ember-600">
                    Forgot password?
                  </Link>
                </div>
              </>
            ) : (
              <IconField
                label="6-digit login PIN"
                icon={<Lock size={17} />}
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
              className="flex w-full items-center justify-center rounded-xl bg-gold-500 py-3.5 font-display text-sm font-semibold text-ink transition hover:bg-gold-400 disabled:opacity-50"
            >
              {isLoading ? <Spinner /> : needsPin ? 'Verify & sign in' : 'Continue'}
            </button>
          </form>

          {!needsPin && (
            <p className="mt-6 text-center font-body text-sm text-ink-600">
              Don't have an account?{' '}
              <Link to="/register" className="font-semibold text-ember-500 hover:text-ember-600">
                Register here!
              </Link>
            </p>
          )}
        </div>

        <Link
          to="/"
          className="mt-6 flex justify-center font-body text-sm font-medium text-ink-600 transition hover:text-ink"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}

function ServiceBadge({
  icon,
  label,
  className = '',
  tilt = '0deg',
  delay = '0s',
}: {
  icon: React.ReactNode;
  label: string;
  className?: string;
  tilt?: string;
  delay?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`auth-badge absolute items-center gap-2 rounded-2xl border border-parchment-line bg-white px-4 py-3 shadow-lg shadow-ink/10 ${className}`}
      style={{ ['--badge-tilt' as string]: tilt, animationDelay: delay }}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gold-500/15 text-gold-600">
        {icon}
      </span>
      <span className="font-body text-xs font-semibold text-ink">{label}</span>
    </div>
  );
}

function IconField({
  label,
  icon,
  value,
  onChange,
  type = 'text',
  autoFocus,
  inputMode,
}: {
  label: string;
  icon: React.ReactNode;
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
      <span className="mb-1.5 block font-body text-sm font-semibold text-ink">{label}</span>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-ink-600">{icon}</span>
        <input
          type={isSecretField && isVisible ? 'text' : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={autoFocus}
          inputMode={inputMode}
          required
          className={`w-full rounded-xl border border-parchment-line bg-parchment/60 py-3 pl-10 font-body text-sm text-ink outline-none focus:border-gold-500 focus:bg-white${isSecretField ? ' pr-11' : ' pr-3.5'}`}
        />
        {isSecretField && (
          <button
            type="button"
            onClick={() => setIsVisible((visible) => !visible)}
            aria-label={isVisible ? 'Hide password' : 'Show password'}
            aria-pressed={isVisible}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-ink-600 transition hover:text-ink focus:outline-none focus:ring-2 focus:ring-gold-500"
          >
            {isVisible ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        )}
      </div>
    </label>
  );
}

export function Spinner() {
  return <div className="h-4 w-4 animate-spin rounded-full border-2 border-ink border-t-transparent" />;
}
