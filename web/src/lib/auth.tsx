import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError, api, clearTokens, getAccessToken, setTokens } from './api';

export const KYC_PROMPT_PENDING_KEY = 'kyc_prompt_pending';

function markKycPromptPending() {
  try { window.sessionStorage.setItem(KYC_PROMPT_PENDING_KEY, '1'); } catch { /* Optional prompt state must not block sign-in. */ }
}

function clearKycPromptPending() {
  try { window.sessionStorage.removeItem(KYC_PROMPT_PENDING_KEY); } catch { /* Optional prompt state must not block sign-out. */ }
}

export type AppUser = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  wallet_balance?: number;
  virtual_account_number?: string | null;
  virtual_account_bank?: string | null;
  kyc_status?: 'unverified' | 'pending' | 'verified' | 'rejected' | string;
  [key: string]: unknown;
};

type AuthResponse = {
  status: boolean;
  data: {
    access_token: string;
    refresh_token: string;
    user: AppUser;
    requires_password_change?: boolean;
    requires_pin_setup?: boolean;
    requires_login_pin_setup?: boolean;
  };
};

type AuthContextValue = {
  user: AppUser | null;
  isLoading: boolean;
  mustChangePassword: boolean;
  requiresLoginPinSetup: boolean;
  requiresTransactionPinSetup: boolean;
  login: (identifier: string, password: string, loginPin?: string) => Promise<void>;
  register: (input: {
    full_name: string;
    email: string;
    phone: string;
    password: string;
    referral_code?: string;
  }) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [requiresLoginPinSetup, setRequiresLoginPinSetup] = useState(false);
  const [requiresTransactionPinSetup, setRequiresTransactionPinSetup] = useState(false);

  async function refreshUser() {
    try {
      const res = await api.get<{ status: boolean; data: AppUser & { requires_password_change?: boolean; requires_pin_setup?: boolean; requires_login_pin_setup?: boolean } }>(
        '/auth/me'
      );
      setUser(res.data);
      setMustChangePassword(!!res.data.requires_password_change);
      // Login PIN remains implemented for future use, but is disabled currently.
      setRequiresLoginPinSetup(false);
      setRequiresTransactionPinSetup(!!res.data.requires_pin_setup);
    } catch {
      clearTokens();
      setUser(null);
    }
  }

  useEffect(() => {
    (async () => {
      if (getAccessToken()) {
        await refreshUser();
      }
      setIsLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function login(identifier: string, password: string, loginPin?: string) {
    try {
      const res = await api.post<AuthResponse>(
        '/auth/login',
        { identifier, password, login_pin: loginPin },
        false
      );
      setTokens(res.data.access_token, res.data.refresh_token);
      setUser(res.data.user);
      setMustChangePassword(!!res.data.requires_password_change);
      setRequiresLoginPinSetup(!!res.data.requires_login_pin_setup);
      setRequiresTransactionPinSetup(!!res.data.requires_pin_setup);
      markKycPromptPending();
    } catch (err) {
      // LOGIN_PIN_REQUIRED means the password was correct but this account
      // has a 6-digit login PIN set - the caller (LoginPage) shows a PIN
      // field and calls login() again with it included.
      if (err instanceof ApiError) throw err;
      if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        throw new ApiError('The login request timed out. Check your connection and try again.', 408, 'REQUEST_TIMEOUT');
      }
      if (err instanceof TypeError) {
        throw new ApiError('Could not connect to the server. Check your internet connection and try again.', 0, 'NETWORK_ERROR');
      }
      throw new ApiError(err instanceof Error ? err.message : 'Login could not be completed. Please try again.', 500, 'LOGIN_ERROR');
    }
  }

  async function register(input: {
    full_name: string;
    email: string;
    phone: string;
    password: string;
    referral_code?: string;
  }) {
    const res = await api.post<AuthResponse>('/auth/register', input, false);
    setTokens(res.data.access_token, res.data.refresh_token);
    setUser(res.data.user);
    setMustChangePassword(!!res.data.requires_password_change);
    setRequiresLoginPinSetup(false);
    setRequiresTransactionPinSetup(!!res.data.requires_pin_setup);
  }

  function logout() {
    clearTokens();
    clearKycPromptPending();
    setUser(null);
    setMustChangePassword(false);
    setRequiresLoginPinSetup(false);
    setRequiresTransactionPinSetup(false);
  }

  return (
    <AuthContext.Provider
      value={{ user, isLoading, mustChangePassword, requiresLoginPinSetup, requiresTransactionPinSetup, login, register, logout, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
