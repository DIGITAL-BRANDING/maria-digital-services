import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { api, ApiError } from '../lib/api';

type Mode = 'verify' | 'create' | 'confirm-create';

/**
 * The 4-digit transaction PIN dialog shown before any spend goes through.
 * `onVerified` receives the confirmed PIN itself (not just a "success"
 * signal) - the backend now requires that same PIN again, directly in the
 * purchase request body (POST /data/purchase, /airtime/purchase, etc - see
 * requirePinConfirmation in the backend's require-pin.ts). Before that
 * backend change, this dialog calling POST /user/pin/verify and the actual
 * purchase call that followed it were two completely disconnected
 * requests - nothing stopped a client from skipping this dialog entirely
 * and calling a purchase endpoint directly with no PIN at all. Every
 * caller of this component MUST now include the PIN `onVerified` gives it
 * in its purchase request, or that request will be rejected server-side.
 *
 * Handles three cases, driven by what the backend reports from
 * /api/user/pin/verify (see verifyPin() in wallet.service.ts):
 *  - Has a PIN already -> plain "enter PIN to confirm".
 *  - No PIN set yet (code: PIN_NOT_SET) -> "create a PIN" then "confirm it",
 *    then proceeds automatically once /user/pin/set succeeds.
 *  - Too many wrong attempts (code: PIN_LOCKED) -> shows the backend's own
 *    lockout message instead of a generic "wrong PIN".
 */
export function PinConfirmDialog({
  open,
  onClose,
  onVerified,
}: {
  open: boolean;
  onClose: () => void;
  onVerified: (pin: string) => void;
}) {
  const [mode, setMode] = useState<Mode>('verify');
  const [pin, setPin] = useState('');
  const [staged, setStaged] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setMode('verify');
      setPin('');
      setStaged('');
      setError('');
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (pin.length === 4) void submit(pin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  if (!open) return null;

  async function submit(value: string) {
    if (mode === 'verify') {
      setBusy(true);
      setError('');
      try {
        await api.post('/user/pin/verify', { pin: value });
        onVerified(value);
      } catch (err) {
        if (err instanceof ApiError && err.code === 'PIN_NOT_SET') {
          setMode('create');
          setPin('');
        } else {
          setError(err instanceof ApiError ? err.message : 'Incorrect PIN. Try again.');
          setPin('');
        }
      } finally {
        setBusy(false);
      }
    } else if (mode === 'create') {
      setStaged(value);
      setPin('');
      setMode('confirm-create');
    } else {
      if (value !== staged) {
        setError("PINs didn't match - let's try again.");
        setPin('');
        setStaged('');
        setMode('create');
        return;
      }
      setBusy(true);
      setError('');
      try {
        await api.post('/user/pin/set', { pin: value });
        onVerified(value);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not set your PIN. Try again.');
        setPin('');
        setStaged('');
        setMode('create');
      } finally {
        setBusy(false);
      }
    }
  }

  const heading =
    mode === 'verify' ? 'Confirm with PIN' : mode === 'create' ? 'Create your transaction PIN' : 'Confirm your new PIN';
  const subheading =
    mode === 'verify'
      ? 'Enter your 4-digit PIN to continue.'
      : mode === 'create'
        ? "You don't have one yet - choose 4 digits you'll remember."
        : 'Enter the same 4 digits again.';

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-cream p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gold-500/15 text-gold-700">
              <ShieldCheck size={18} />
            </span>
            <div>
              <h2 className="font-display text-lg font-bold text-ink">{heading}</h2>
              <p className="text-xs text-ink-600">{subheading}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Cancel" className="rounded-full p-1.5 text-ink-600 hover:bg-parchment">
            <X size={16} />
          </button>
        </div>

        <input
          ref={inputRef}
          autoFocus
          inputMode="numeric"
          maxLength={4}
          value={pin}
          disabled={busy}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          className="mt-6 w-full rounded-xl border border-parchment-line bg-parchment p-3 text-center font-mono text-xl tracking-[0.5em] text-ink outline-none focus:border-gold-500"
          placeholder="••••"
        />

        <p className="mt-2 min-h-5 text-center text-xs text-ember-600">{error}</p>

        <div className="mt-3 flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-xl border border-parchment-line py-2.5 text-sm text-ink">
            Cancel
          </button>
          <button
            onClick={() => pin.length === 4 && submit(pin)}
            disabled={busy || pin.length !== 4}
            className="flex flex-1 items-center justify-center rounded-xl bg-gold-500 py-2.5 text-sm font-semibold text-ink disabled:opacity-50"
          >
            {busy ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-ink border-t-transparent" /> : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
