import { type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { SERVICES } from './lib/services';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import SetNewPasswordPage from './pages/SetNewPasswordPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import BuyAirtimePage from './pages/BuyAirtimePage';
import BuyDataPage from './pages/BuyDataPage';
import ComingSoonPage from './pages/ComingSoonPage';
import PrivacyRedirect from './pages/PrivacyRedirect';
import ResultPinPage from './pages/ResultPinPage';
import ResultCheckersPage from './pages/ResultCheckersPage';
import VerificationPage from './pages/VerificationPage';
import NinPhoneVerificationPage from './pages/verification/NinPhoneVerificationPage';
import PhoneMultiplePage from './pages/verification/PhoneMultiplePage';
import CacServicesPage from './pages/verification/CacServicesPage';
import BvnVerificationPage from './pages/verification/BvnVerificationPage';
import IpeClearancePage from './pages/verification/IpeClearancePage';
import ValidationPage from './pages/verification/ValidationPage';
import PersonalizationPage from './pages/verification/PersonalizationPage';
import BvnRetrievalPage from './pages/verification/BvnRetrievalPage';
import DelinkPage from './pages/verification/DelinkPage';
import BvnLicensePage from './pages/verification/BvnLicensePage';
import DemographicVerificationPage from './pages/verification/DemographicVerificationPage';
import NinModificationPage from './pages/NinModificationPage';
import BvnModificationPage from './pages/BvnModificationPage';
import BirthAttestationPage from './pages/BirthAttestationPage';
import NewspaperPublicationPage from './pages/NewspaperPublicationPage';
import BvnCrmPage from './pages/BvnCrmPage';
import FundWalletPage from './pages/FundWalletPage';
import PaymentCallbackPage from './pages/PaymentCallbackPage';
import DeliveriesPage from './pages/DeliveriesPage';
import ReceiptPage from './pages/ReceiptPage';
import ReferralPage from './pages/ReferralPage';
import PinSetupPage from './pages/PinSetupPage';
import SupportPage from './pages/SupportPage';
import SlipsHistoryPage from './pages/SlipsHistoryPage';
import WalletSummaryPage from './pages/WalletSummaryPage';

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, isLoading, mustChangePassword, requiresLoginPinSetup, requiresTransactionPinSetup } = useAuth();
  const location = useLocation();
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream">
        <div className="h-8 w-8 rounded-full border-2 border-gold-500 border-t-transparent animate-spin" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  // An admin-issued temporary password (see the User resource's "Reset
  // Password" action) forces this detour before anything else in the app
  // is reachable - every other protected route goes through this same
  // check, so there's no way to navigate around it.
  if (mustChangePassword && location.pathname !== '/set-new-password') {
    return <Navigate to="/set-new-password" replace />;
  }
  if ((requiresLoginPinSetup || requiresTransactionPinSetup) && location.pathname !== '/setup-pins') {
    return <Navigate to="/setup-pins" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/privacy-policy" element={<PrivacyRedirect page="privacy-policy" />} />
          <Route path="/result-checkers" element={<ProtectedRoute><ResultCheckersPage /></ProtectedRoute>} />
          <Route path="/waec-result" element={<ProtectedRoute><ResultPinPage exam="WAEC" /></ProtectedRoute>} />
          <Route path="/neco-result" element={<ProtectedRoute><ResultPinPage exam="NECO" /></ProtectedRoute>} />
          <Route path="/nabteb-result" element={<ProtectedRoute><ResultPinPage exam="NABTEB" /></ProtectedRoute>} />
          {/* The catalog grid at /nin-services and /bvn-services still lists every NIN/BVN
              service (including ones not covered by the six split-out pages below), so it
              keeps using the original all-in-one VerificationPage. */}
          <Route path="/nin-services" element={<ProtectedRoute><VerificationPage mode="nin" /></ProtectedRoute>} />
          <Route path="/bvn-services" element={<ProtectedRoute><VerificationPage mode="bvn" /></ProtectedRoute>} />
          {/* Six sidebar links now point at their own dedicated page + URL, matching the
              reference screenshots, instead of sharing the generic VerificationPage. */}
          <Route path="/nin" element={<ProtectedRoute><NinPhoneVerificationPage /></ProtectedRoute>} />
          <Route path="/phone" element={<ProtectedRoute><PhoneMultiplePage /></ProtectedRoute>} />
          <Route path="/cac" element={<ProtectedRoute><CacServicesPage /></ProtectedRoute>} />
          <Route path="/bvn" element={<ProtectedRoute><BvnVerificationPage /></ProtectedRoute>} />
          <Route path="/ipe" element={<ProtectedRoute><IpeClearancePage /></ProtectedRoute>} />
          <Route path="/validation" element={<ProtectedRoute><ValidationPage /></ProtectedRoute>} />
          <Route path="/nin-modification" element={<ProtectedRoute><NinModificationPage /></ProtectedRoute>} />
          <Route path="/bvn-modification" element={<ProtectedRoute><BvnModificationPage /></ProtectedRoute>} />
          <Route path="/attestation" element={<ProtectedRoute><BirthAttestationPage /></ProtectedRoute>} />
          <Route path="/newspaper" element={<ProtectedRoute><NewspaperPublicationPage /></ProtectedRoute>} />
          <Route path="/bvn-crm" element={<ProtectedRoute><BvnCrmPage /></ProtectedRoute>} />
          <Route path="/modification" element={<ProtectedRoute><NinModificationPage /></ProtectedRoute>} />
          <Route path="/tracking" element={<ProtectedRoute><PersonalizationPage /></ProtectedRoute>} />
          <Route path="/delink" element={<ProtectedRoute><DelinkPage /></ProtectedRoute>} />
          <Route path="/bvn-license" element={<ProtectedRoute><BvnLicensePage /></ProtectedRoute>} />
          <Route path="/bvn-ret" element={<ProtectedRoute><BvnRetrievalPage /></ProtectedRoute>} />
          <Route path="/demo" element={<ProtectedRoute><DemographicVerificationPage /></ProtectedRoute>} />
          <Route path="/terms" element={<PrivacyRedirect page="terms" />} />
          <Route path="/fund-wallet" element={<ProtectedRoute><FundWalletPage /></ProtectedRoute>} />
          <Route path="/deliveries" element={<ProtectedRoute><DeliveriesPage /></ProtectedRoute>} />
          <Route path="/receipt/:id" element={<ProtectedRoute><ReceiptPage /></ProtectedRoute>} />
          <Route path="/referrals" element={<ProtectedRoute><ReferralPage /></ProtectedRoute>} />
          <Route path="/support" element={<ProtectedRoute><SupportPage /></ProtectedRoute>} />
          <Route path="/verifications" element={<ProtectedRoute><SlipsHistoryPage /></ProtectedRoute>} />
          <Route path="/history" element={<ProtectedRoute><WalletSummaryPage /></ProtectedRoute>} />
          <Route path="/setup-pins" element={<ProtectedRoute><PinSetupPage /></ProtectedRoute>} />
          <Route path="/payment/callback" element={<ProtectedRoute><PaymentCallbackPage /></ProtectedRoute>} />
          <Route path="/set-new-password" element={<ProtectedRoute><SetNewPasswordPage /></ProtectedRoute>} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/buy-airtime"
            element={
              <ProtectedRoute>
                <BuyAirtimePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/buy-data"
            element={
              <ProtectedRoute>
                <BuyDataPage />
              </ProtectedRoute>
            }
          />
          {/* Every service in the catalog that isn't built on the web yet
              gets a friendly "coming soon" page instead of a dead link —
              generated straight from lib/services.ts so a new service only
              ever needs to be added in one place. */}
          {SERVICES.filter((s) => !s.implemented).map((service) => (
            <Route
              key={service.route}
              path={service.route}
              element={
                <ProtectedRoute>
                  <ComingSoonPage service={service} />
                </ProtectedRoute>
              }
            />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
