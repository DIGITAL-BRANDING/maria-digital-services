import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import Logo from '../components/Logo';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Spinner } from './LoginPage';

/**
 * Shown right after logging in with a temporary password an admin issued by
 * hand (see the "Reset Password" action on the User admin resource) - this
 * is the stopgap for "I forgot my password" until Resend has a verified
 * sending domain for the proper self-service email flow.
 *
 * `old_password` here is the temp password the person just logged in with -
 * asking for it again is a deliberate extra check that they're the one who
 * received it, not just riding an already-issued session token.
 */
export default function SetNewPasswordPage() {
  const navigate = useNavigate();
  const { refreshUser, logout } = useAuth();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (newPassword === oldPassword) {
      setError('Choose a different password from the temporary one.');
      return;
    }
    setIsLoading(true);
    try {
      await api.post('/user/password/change', { old_password: oldPassword, new_password: newPassword });
      await refreshUser();
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not set your new password. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-5 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-2xl border border-parchment-line bg-parchment p-7">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gold-500/15 text-gold-700">
              <KeyRound size={18} />
            </span>
            <div>
              <h1 className="font-display text-xl font-bold text-ink">Set a new password</h1>
              <p className="font-body text-xs text-ink-600">Your account was reset by an admin — choose a new password to continue.</p>
            </div>
          </div>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <Field
              label="Temporary password"
              value={oldPassword}
              onChange={setOldPassword}
              type="password"
              autoFocus
              autoComplete="off"
            />
            <Field
              label="New password"
              value={newPassword}
              onChange={setNewPassword}
              type="password"
              autoComplete="new-password"
            />
            <Field
              label="Confirm new password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              type="password"
              autoComplete="new-password"
            />

            {error && (
              <p className="rounded-lg bg-ember-500/10 px-3 py-2 font-body text-sm text-ember-600">{error}</p>
            )}

            <button
              type="submit"
              disabled={isLoading || !oldPassword || newPassword.length < 8 || !confirmPassword}
              className="flex w-full items-center justify-center rounded-lg bg-gold-500 py-3 font-display text-sm font-semibold text-ink transition hover:bg-gold-400 disabled:opacity-50"
            >
              {isLoading ? <Spinner /> : 'Set new password & continue'}
            </button>
          </form>

          <button
            type="button"
            onClick={logout}
            className="mt-4 w-full font-body text-sm font-medium text-ink-600 hover:text-ink"
          >
            Not you? Sign out
          </button>
        </div>
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
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoFocus?: boolean;
  autoComplete?: string;
}) {
  return (
    <label className="block font-body text-sm font-medium text-ink-600">
      {label}
      <input
        required
        type={type}
        value={value}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-parchment-line bg-cream px-3.5 py-2.5 text-sm text-ink outline-none focus:border-gold-500"
      />
    </label>
  );
}
