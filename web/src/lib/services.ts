import {
  Wifi,
  Smartphone,
  ArrowLeftRight,
  Tv,
  Zap,
  GraduationCap,
  ClipboardList,
  MessageSquare,
  Ticket,
  CreditCard,
  IdCard,
  Fingerprint,
  Briefcase,
  ShieldCheck,
  Receipt,
  Search,
  History,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';

export type ServiceTint = 'gold' | 'bronze' | 'ember' | 'success' | 'ink';

export type ServiceItem = {
  label: string;
  /** Short, plain-language explanation shown on the coming-soon page and
   *  as a tooltip-ish subtitle — written for a first-time customer, not a
   *  developer. */
  description: string;
  icon: LucideIcon;
  route: string;
  tint: ServiceTint;
  /** false = tile still shows and is clickable, but leads to a friendly
   *  "coming soon on web" page instead of a dead link — mirrors the
   *  Flutter app's ComingSoonScreen for the same not-yet-built services
   *  (see major_data_link/lib/core/router/app_router.dart). */
  implemented: boolean;
};

// Mirrors the service list in
// major_data_link/lib/features/home/presentation/screens/services_screen.dart
// — same order, same set — so a customer moving between the app and the
// website sees one consistent menu.
export const SERVICES: ServiceItem[] = [
  { label: 'NIN_Phone Verification', description: 'Verify NIN and phone details.', icon: IdCard, route: '/nin', tint: 'gold', implemented: true },
  { label: 'Phone Multiple', description: 'Check multiple phone numbers.', icon: Smartphone, route: '/phone', tint: 'bronze', implemented: true },
  { label: 'CAC Services', description: 'Business registration and lookup.', icon: Briefcase, route: '/cac', tint: 'success', implemented: true },
  { label: 'BVN Verification', description: 'Verify bank identity details.', icon: Fingerprint, route: '/bvn', tint: 'ember', implemented: true },
  { label: 'IPE Clerance (Instant)', description: 'Instant identity clearance.', icon: ShieldCheck, route: '/ipe', tint: 'gold', implemented: true },
  { label: 'Validation', description: 'Validate identity records.', icon: ClipboardList, route: '/validation', tint: 'bronze', implemented: true },
  { label: 'Personalization', description: 'Personalize your identity details.', icon: IdCard, route: '/tracking', tint: 'success', implemented: true },
  { label: 'BVN Retrieval', description: 'Retrieve BVN details.', icon: Fingerprint, route: '/bvn-ret', tint: 'ember', implemented: true },
  { label: 'Self Service Unlink', description: 'Unlink identity services yourself.', icon: ShieldCheck, route: '/delink', tint: 'gold', implemented: true },
  { label: 'NIN Modifications', description: 'Request NIN modifications.', icon: IdCard, route: '/modification', tint: 'bronze', implemented: true },
  // These three have no dedicated page or route anywhere in App.tsx yet
  // (confirmed by cross-checking every SERVICES route against App.tsx's
  // <Route> paths) - `implemented: true` here was silently sending anyone
  // who clicked them to App.tsx's catch-all `*` route, which redirects to
  // "/" with no explanation. `false` correctly routes them through the
  // SERVICES.filter(!implemented) loop below to the friendly
  // "coming soon" page instead.
  { label: 'Birth Attestation', description: 'Birth attestation services.', icon: Receipt, route: '/attestation', tint: 'success', implemented: true },
  { label: 'TIN Certificate', description: 'Get your TIN certificate.', icon: Receipt, route: '/tin', tint: 'ember', implemented: false },
  { label: 'Newspaper Publication', description: 'Publish notices in newspapers.', icon: MessageSquare, route: '/newspaper', tint: 'gold', implemented: true },
  { label: 'Demographic Search', description: 'Search demographic records.', icon: Search, route: '/demo', tint: 'bronze', implemented: true },
  // These two now have real dedicated pages + <Route> entries in App.tsx
  // (BvnLicensePage, BvnModificationPage). Leaving `implemented: false`
  // here made App.tsx's SERVICES.filter(!implemented) loop register a
  // SECOND, conflicting <Route> at the same path pointing at
  // ComingSoonPage instead - two <Route> elements sharing one path is
  // fragile (whichever wins depends on react-router's internal tie-break,
  // not anything declared explicitly here). `true` removes them from that
  // loop so only the real page's route exists.
  { label: 'BVN License Creation', description: 'Create and onboard a BVN license.', icon: Fingerprint, route: '/bvn-license', tint: 'gold', implemented: true },
  { label: 'BVN Modification', description: 'Request a BVN record modification.', icon: Fingerprint, route: '/bvn-modification', tint: 'bronze', implemented: true },
  { label: 'BVN CRM', description: 'Submit your BVN CRM TicketID for follow-up.', icon: Fingerprint, route: '/bvn-crm', tint: 'gold', implemented: true },
  // Sidebar-only links (components/AppShell.tsx) that had no SERVICES entry
  // and therefore no route at all anywhere - not even a "coming soon"
  // fallback, since that's generated from this array. Clicking either one
  // silently redirected to "/" with zero explanation.
  { label: 'Slips History', description: 'Review your past verification slips.', icon: History, route: '/verifications', tint: 'bronze', implemented: true },
  { label: 'Wallet Summary', description: 'See a summary of your wallet activity.', icon: WalletCards, route: '/history', tint: 'success', implemented: true },
  {
    label: 'Buy Data',
    description: 'Get data bundles for MTN, Glo, Airtel or 9mobile, delivered instantly.',
    icon: Wifi,
    route: '/buy-data',
    tint: 'gold',
    implemented: true,
  },
  {
    label: 'Buy Airtime',
    description: 'Top up any Nigerian network in seconds.',
    icon: Smartphone,
    route: '/buy-airtime',
    tint: 'bronze',
    implemented: true,
  },
  {
    label: 'Airtime to Cash',
    description: 'Convert excess airtime back into your wallet balance.',
    icon: ArrowLeftRight,
    route: '/airtime-to-cash',
    tint: 'success',
    implemented: false,
  },
  {
    label: 'Cable TV',
    description: 'Renew DStv, GOtv or Startimes subscriptions.',
    icon: Tv,
    route: '/cable-tv',
    tint: 'ember',
    implemented: false,
  },
  {
    label: 'Electricity',
    description: 'Buy prepaid or postpaid electricity tokens.',
    icon: Zap,
    route: '/electricity',
    tint: 'gold',
    implemented: false,
  },
  {
    label: 'Result Checkers',
    description: 'Buy WAEC, NECO or NABTEB result checker PINs.',
    icon: GraduationCap,
    route: '/result-checkers',
    tint: 'bronze',
    implemented: true,
  },
  {
    label: 'JAMB Services',
    description: 'JAMB PIN and related services.',
    icon: ClipboardList,
    route: '/jamb-services',
    tint: 'ember',
    implemented: false,
  },
  {
    label: 'Bulk SMS',
    description: 'Send SMS to many recipients at once.',
    icon: MessageSquare,
    route: '/bulk-sms',
    tint: 'success',
    implemented: false,
  },
  {
    label: 'Recharge Card',
    description: 'Print recharge card PINs in bulk.',
    icon: Ticket,
    route: '/recharge-card',
    tint: 'gold',
    implemented: false,
  },
  {
    label: 'Data Card',
    description: 'Print data card PINs in bulk.',
    icon: CreditCard,
    route: '/data-card',
    tint: 'bronze',
    implemented: false,
  },
  {
    label: 'NIN Services',
    description: 'NIN slips, validation and related lookups.',
    icon: IdCard,
    route: '/nin-services',
    tint: 'ink',
    implemented: true,
  },
  {
    label: 'BVN Services',
    description: 'BVN slips and lookups.',
    icon: Fingerprint,
    route: '/bvn-services',
    tint: 'ember',
    implemented: true,
  },
  {
    label: 'CAC Registration',
    description: 'Register a business name with CAC.',
    icon: Briefcase,
    route: '/cac-registration',
    tint: 'success',
    implemented: false,
  },
  {
    label: 'SCUML Registration',
    description: 'SCUML registration for regulated businesses.',
    icon: ShieldCheck,
    route: '/scuml-registration',
    tint: 'gold',
    implemented: false,
  },
  {
    label: 'TIN Registration',
    description: 'Tax Identification Number registration.',
    icon: Receipt,
    route: '/tin-registration',
    tint: 'bronze',
    implemented: false,
  },
];

export const TINT_CLASSES: Record<ServiceTint, { bg: string; text: string }> = {
  gold: { bg: 'bg-gold-500/12', text: 'text-gold-600' },
  bronze: { bg: 'bg-bronze-500/12', text: 'text-bronze-700' },
  ember: { bg: 'bg-ember-500/12', text: 'text-ember-600' },
  success: { bg: 'bg-success-500/12', text: 'text-success-600' },
  ink: { bg: 'bg-ink/8', text: 'text-ink' },
};
