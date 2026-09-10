import React, { useEffect } from 'react';
import { Box, Loader, Text } from '@adminjs/design-system';

/**
 * Fixes a real bug: an AdminJS record action's `redirectUrl` (returned from
 * its `handler`) is followed with React Router's client-side `navigate()`
 * (see node_modules/adminjs/lib/frontend/hooks/use-action/
 * use-action-response-handler.js) - i.e. it only works for paths AdminJS's
 * OWN React Router knows about (/admin/resources/..., /admin/pages/...).
 * Our custom server-rendered pages (/admin/cac/:id/manage,
 * /admin/nin-modification/:id/pdf, etc - plain Express routes, not part of
 * the AdminJS SPA at all) don't exist in that router, so `navigate()`
 * silently falls through to AdminJS's own catch-all and lands on the
 * dashboard - which is exactly the "Manage" button redirecting to the
 * dashboard" bug this fixes.
 *
 * The fix: give the action THIS component (instead of `component: false` +
 * a `redirectUrl`), and have it perform a real `window.location.href`
 * assignment on mount. That's a genuine full-page browser navigation, which
 * (unlike React Router's navigate()) happily leaves the SPA and loads
 * whatever the target URL actually serves - the same way the plain
 * `<a href="...">` dashboard tiles in components/dashboard.tsx already
 * work for the other custom pages (Company Wallet, Bulk Pricing, etc), just
 * triggered from an action button instead of a dashboard tile.
 */
type RedirectToManageProps = {
  record?: { params?: Record<string, unknown> };
};

const TARGET_PATH_BY_TYPE: Record<string, (id: string) => string> = {
  CAC_SERVICE_REQUEST: (id) => `/admin/cac/${id}/manage`,
  NIN_MODIFICATION: (id) => `/admin/nin-modification/${id}/pdf`,
  BVN_LICENSE_ONBOARDING: (id) => `/admin/bvn-license/${id}/manage`,
  BVN_MODIFICATION: (id) => `/admin/bvn-modification/${id}/pdf`,
  BIRTH_ATTESTATION: (id) => `/admin/birth-attestation/${id}/manage`,
  NEWSPAPER_PUBLICATION: (id) => `/admin/newspaper-publication/${id}/manage`,
  BVN_CRM: (id) => `/admin/bvn-crm/${id}/pdf`
};

const RedirectToManage: React.FC<RedirectToManageProps> = ({ record }) => {
  const type = record?.params?.type as string | undefined;
  const id = record?.params?.id as string | undefined;
  const buildPath = type ? TARGET_PATH_BY_TYPE[type] : undefined;
  const targetUrl = buildPath && id ? buildPath(id) : null;

  useEffect(() => {
    if (targetUrl) {
      window.location.href = targetUrl;
    }
  }, [targetUrl]);

  return (
    <Box variant="white" p="xxl" textAlign="center">
      {targetUrl ? (
        <>
          <Loader />
          <Text mt="lg">Opening…</Text>
        </>
      ) : (
        <Text color="red">Could not work out which page to open for this record (missing or unrecognised type).</Text>
      )}
    </Box>
  );
};

export default RedirectToManage;
