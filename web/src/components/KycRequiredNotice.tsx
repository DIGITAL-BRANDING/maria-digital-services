import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../lib/auth';

/**
 * Shown to any user who has no virtual account number yet and hasn't completed KYC.
 * Hidden for verified users (they simply have nothing to show yet, e.g. funding is paused).
 */
export default function KycRequiredNotice({ hasAccount, className = '' }: { hasAccount: boolean; className?: string }) {
  const { user } = useAuth();
  if (hasAccount || user?.kyc_status === 'verified') return null;

  return (
    <div className={`rounded-2xl border border-amber-300 bg-amber-50 p-4 text-slate-900 ${className}`} role="alert">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 shrink-0 text-amber-600" size={20} />
        <div className="flex-1">
          <p className="font-semibold">KYC required to get your virtual account number</p>
          <p className="mt-1 text-sm text-slate-700">
            Kana bukatar yin KYC domin samun virtual account number ɗinka.
          </p>
          <Link
            to="/kyc"
            className="mt-3 inline-flex items-center rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
          >
            Complete KYC · Yi KYC
          </Link>
        </div>
      </div>
    </div>
  );
}
