import React, { useEffect, useState } from 'react';
import { Box, Button, H2, H4, Icon, Text } from '@adminjs/design-system';

const ADMIN_ROOT_PATH = '/admin';

type PendingSummaryRow = { type: string; label: string; pending: number; new_last_24h: number; oldest_pending_at: string | null };
type PendingSummary = { total_pending: number; total_new_last_24h: number; by_type: PendingSummaryRow[] };

type QuickLink = {
  label: string;
  description: string;
  /** AdminJS resource-backed page - mutually exclusive with `href`. */
  resourceId?: string;
  /** Plain server-rendered page (Bulk Pricing, Company Wallet, etc) - mutually exclusive with `resourceId`. */
  href?: string;
  icon: string;
};

// One card per resource an admin actually works with day-to-day. Kept in the
// same grouping order as the sidebar navigation (Customers, Ledger, Products,
// Wallet, Communication, Access Control) so the dashboard reads as a map of
// the sidebar rather than a separate, unrelated list.
const quickLinks: QuickLink[] = [
  { label: 'Customers', description: 'Users, KYC status & profiles', resourceId: 'User', icon: 'Users' },
  { label: 'Ledger', description: 'Transactions, reversals & history', resourceId: 'Transaction', icon: 'List' },
  {
    label: 'CAC Registration Requests',
    description: 'Business name/company filings awaiting manual CAC registration',
    href: `${ADMIN_ROOT_PATH}/resources/Transaction?filters.type=CAC_SERVICE_REQUEST`,
    icon: 'Briefcase'
  },
  {
    label: 'BVN License Requests',
    description: 'Agent BVN license enrollments awaiting manual processing',
    href: `${ADMIN_ROOT_PATH}/resources/Transaction?filters.type=BVN_LICENSE_ONBOARDING`,
    icon: 'CreditCard'
  },
  {
    label: 'NIN Modification Requests',
    description: 'Manual NIN correction requests awaiting re-keying on techhubltd.co',
    href: `${ADMIN_ROOT_PATH}/resources/Transaction?filters.type=NIN_MODIFICATION`,
    icon: 'Edit'
  },
  {
    label: 'BVN Modification Requests',
    description: 'Manual BVN correction requests awaiting processing by an agent',
    href: `${ADMIN_ROOT_PATH}/resources/Transaction?filters.type=BVN_MODIFICATION`,
    icon: 'Edit3'
  },
  {
    label: 'BVN CRM Requests',
    description: 'BVN CRM TicketID follow-up requests awaiting agent handling',
    href: `${ADMIN_ROOT_PATH}/resources/Transaction?filters.type=BVN_CRM`,
    icon: 'Settings'
  },
  {
    label: 'Birth Attestation Requests',
    description: 'NPC Birth Attestation submissions awaiting manual processing',
    href: `${ADMIN_ROOT_PATH}/resources/Transaction?filters.type=BIRTH_ATTESTATION`,
    icon: 'FileText'
  },
  {
    label: 'Newspaper Publication Requests',
    description: 'Name-change publications awaiting filing with BluePrint/DailyTrust',
    href: `${ADMIN_ROOT_PATH}/resources/Transaction?filters.type=NEWSPAPER_PUBLICATION`,
    icon: 'BookOpen'
  },
  {
    label: 'User Wallet Activity',
    description: 'Look up any customer: funding, spend & recent transactions',
    href: `${ADMIN_ROOT_PATH}/user-wallet`,
    icon: 'Search'
  },
  {
    label: 'Customer Activity',
    description: 'Top customers, what they bought, and reward candidates',
    href: `${ADMIN_ROOT_PATH}/customer-activity`,
    icon: 'Award'
  },
  {
    label: 'Support Inbox',
    description: 'Complaints sent in from customer dashboards - reply inline',
    href: `${ADMIN_ROOT_PATH}/support-inbox`,
    icon: 'MessageCircle'
  },
  {
    label: 'User Deliveries',
    description: 'Upload a manual PDF, image or token file for one customer',
    href: `${ADMIN_ROOT_PATH}/user-deliveries`,
    icon: 'Upload'
  },
  {
    label: 'Company Wallet',
    description: 'Revenue, provider cost & net profit by service',
    href: `${ADMIN_ROOT_PATH}/company-wallet`,
    icon: 'TrendingUp'
  },
  {
    label: 'Provider Ledger',
    description: 'Our balance at Alrahuz/Techhub, settlements & adjustments',
    href: `${ADMIN_ROOT_PATH}/provider-ledger`,
    icon: 'Repeat'
  },
  {
    label: 'Provider Reconciliation',
    description: 'Transactions stuck "processing" at any provider - confirm success/failure by hand',
    href: `${ADMIN_ROOT_PATH}/provider-reconciliation`,
    icon: 'AlertTriangle'
  },
  {
    label: 'Data Plan Pricing',
    description: 'Set prices for data plans',
    resourceId: 'DataPlanPricing',
    icon: 'ShoppingCart'
  },
  {
    label: 'Bulk Pricing',
    description: 'Reprice every data plan / service in one click',
    href: `${ADMIN_ROOT_PATH}/bulk-pricing`,
    icon: 'Sliders'
  },
  {
    label: 'Service Pricing',
    description: 'NIN/BVN (Techhub) & result pin (Alrahuz) prices',
    resourceId: 'ServicePricing',
    icon: 'Tag'
  },
  { label: 'Coupons', description: 'Discount codes & promotions', resourceId: 'Coupon', icon: 'CreditCard' },
  {
    label: 'Provider Balance',
    description: 'Alrahuz, BilalSadaSub & Techhub provider wallet status',
    resourceId: 'ProviderBalanceStatus',
    icon: 'AlertTriangle'
  },
  {
    label: 'Referral Settings',
    description: 'Referral reward configuration',
    resourceId: 'ReferralSettings',
    icon: 'Percent'
  },
  {
    label: 'Notifications',
    description: 'Broadcast messages to users',
    resourceId: 'NotificationBroadcast',
    icon: 'Bell'
  },
  { label: 'Admin Users', description: 'Admin accounts & roles', resourceId: 'AdminUser', icon: 'Shield' },
  { label: 'Audit Log', description: 'Admin activity history', resourceId: 'AdminAuditLog', icon: 'FileText' }
];

// Shown once per dashboard visit (mount) so an admin logging in - or just
// navigating back to the dashboard - immediately sees what's backed up
// across every manually-processed request type (CAC, BVN License, BVN
// Modification, NIN Modification, Birth Attestation, Newspaper
// Publication), instead of having to click through each "Requests" tile
// individually to discover a queue has built up. Powered by
// GET /api/admin/pending-summary (routes/admin-api.routes.ts).
function PendingRequestsPopup() {
  const [summary, setSummary] = useState<PendingSummary | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    fetch(`${ADMIN_ROOT_PATH}/pending-summary`, { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((body) => setSummary(body.data as PendingSummary))
      .catch(() => setLoadFailed(true));
  }, []);

  if (dismissed || loadFailed || !summary || summary.total_pending === 0) return null;

  return (
    <Box
      style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 1000 }}
      display="flex"
      alignItems="center"
      justifyContent="center"
      onClick={() => setDismissed(true)}
    >
      <Box
        variant="white"
        boxShadow="card"
        p="xl"
        style={{ width: 'min(480px, 92vw)', borderRadius: 14 }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <Box display="flex" alignItems="center" mb="default">
          <Icon icon="AlertTriangle" color="#b45309" bg="rgba(180, 83, 9, 0.12)" rounded size={22} p="default" mr="default" />
          <H4 m={0}>Requests waiting on you</H4>
        </Box>
        <Text mb="lg" color="grey60">
          {summary.total_pending} request{summary.total_pending === 1 ? '' : 's'} still unresolved
          {summary.total_new_last_24h > 0 ? `, ${summary.total_new_last_24h} new in the last 24 hours` : ''}.
        </Text>

        <Box mb="lg">
          {summary.by_type
            .filter((row) => row.pending > 0)
            .map((row) => (
              <Box
                key={row.type}
                display="flex"
                justifyContent="space-between"
                alignItems="center"
                py="default"
                style={{ borderBottom: '1px solid #eef2f7' }}
              >
                <Box>
                  <Text fontWeight="bold">{row.label}</Text>
                  {row.new_last_24h > 0 && (
                    <Text fontSize="xs" color="#b45309">
                      {row.new_last_24h} new today
                    </Text>
                  )}
                  {row.oldest_pending_at && <Text fontSize="xs" color="grey60" mt="sm">Oldest: {new Date(row.oldest_pending_at).toLocaleString()}</Text>}
                </Box>
                <a href={`${ADMIN_ROOT_PATH}/resources/Transaction?filters.type=${row.type}&filters.status=PENDING`} style={{ textDecoration: 'none' }}>
                  <Button size="sm" variant="text">
                    {row.pending} pending →
                  </Button>
                </a>
              </Box>
            ))}
        </Box>

        <Button onClick={() => setDismissed(true)} style={{ width: '100%', justifyContent: 'center' }}>
          Got it
        </Button>
      </Box>
    </Box>
  );
}

const Dashboard: React.FC = () => (
  <Box>
    <PendingRequestsPopup />
    <Box
      position="relative"
      overflow="hidden"
      py="xxl"
      px={['default', 'lg', 'xxl']}
      style={{ background: 'linear-gradient(135deg, #0b2f73 0%, #1452a0 100%)' }}
    >
      <Box display="flex" alignItems="center" flexDirection={['column', 'row']}>
        <Box mr={['0', 'xl']} mb={['lg', '0']}>
          <img
            src="/branding/logo.jpg"
            alt="MARIA Digital Solutions"
            style={{ width: 96, height: 96, borderRadius: 20, display: 'block' }}
          />
        </Box>
        <Box>
          <H2 color="#ffffff" fontWeight="bold" style={{ color: '#ffffff' }}>
            Welcome to MARIA Digital Solutions Admin
          </H2>
          <Text color="#fff" style={{ opacity: 0.9, color: '#fff' }}>
            Manage customers, transactions, data plans and more from one place.
          </Text>
        </Box>
      </Box>
    </Box>

    <Box px={['default', 'lg', 'xxl']} py="xl">
      <H4 mb="lg">Quick links</H4>
      <Box display="flex" flexWrap="wrap" style={{ gap: 20 }}>
        {quickLinks.map((link) => (
          <a
            key={link.resourceId ?? link.href}
            href={link.href ?? `${ADMIN_ROOT_PATH}/resources/${link.resourceId}`}
            style={{ textDecoration: 'none', display: 'block', width: 280, flexGrow: 1, maxWidth: 340 }}
          >
            <Box variant="white" boxShadow="card" p="lg" style={{ cursor: 'pointer', height: '100%', background: '#0b2f73', borderRadius: 12 }}>
              <Box display="flex" alignItems="center" mb="default">
                <Icon
                  icon={link.icon}
                  color="#ffffff"
                  bg="rgba(96, 165, 250, 0.25)"
                  rounded
                  size={22}
                  p="default"
                  mr="default"
                />
                <Text fontWeight="bold" color="#ffffff">
                  {link.label}
                </Text>
              </Box>
              <Text fontSize="sm" color="#dbeafe">
                {link.description}
              </Text>
            </Box>
          </a>
        ))}
      </Box>
    </Box>
  </Box>
);

export default Dashboard;

