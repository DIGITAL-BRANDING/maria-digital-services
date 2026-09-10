import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { getModelByName } from '@adminjs/prisma';
import type { ResourceWithOptions } from 'adminjs';
import { prisma } from '../../lib/prisma.js';
import { notifyUser } from '../../services/notification.service.js';
import { logAdminAction } from '../audit.js';
import type { AdminSessionUser } from '../auth.js';

// Excludes O/0 and I/1/l - a temp password meant to be read aloud over a
// phone call or typed out from a WhatsApp message shouldn't hinge on
// whether someone can tell those apart in the font they're looking at.
const TEMP_PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function generateTempPassword(length = 10): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => TEMP_PASSWORD_CHARS[b % TEMP_PASSWORD_CHARS.length]).join('');
}

export const userResource: ResourceWithOptions = {
  resource: { model: getModelByName('User'), client: prisma },
  options: {
    id: 'User',
    navigation: { name: 'Customers', icon: 'Users' },
    listProperties: ['fullName', 'email', 'phone', 'walletBalanceKobo', 'kycStatus', 'createdAt'],
    showProperties: [
      'id',
      'fullName',
      'email',
      'phone',
      'walletBalanceKobo',
      'referralCode',
      'referralEarningsKobo',
      'kycStatus',
      'emailVerified',
      'phoneVerified',
      'virtualAccountNumber',
      'virtualAccountBank',
      'virtualAccountProvider',
      'createdAt',
      'updatedAt'
    ],
    editProperties: ['kycStatus', 'phoneVerified', 'emailVerified'],
    filterProperties: ['fullName', 'email', 'phone', 'kycStatus', 'createdAt'],
    properties: {
      pinHash: { isVisible: false },
      pinFailures: { isVisible: { list: false, show: true, edit: false, filter: false } },
      pinLockedUntil: { isVisible: { list: false, show: true, edit: false, filter: false } },
      walletBalanceKobo: { isVisible: { list: true, show: true, edit: false, filter: false } },
      referralEarningsKobo: { isVisible: { list: false, show: true, edit: false, filter: false } }
    },
    actions: {
      // Users are created by the app via Firebase sign-in, never directly by an admin.
      new: { isAccessible: false },
      // A user has related transactions - deleting would break the ledger. Deactivate
      // via kycStatus/support workflow instead of allowing hard deletes here.
      delete: { isAccessible: false },
      edit: {
        isAccessible: ({ currentAdmin }) =>
          !!currentAdmin && (currentAdmin as unknown as AdminSessionUser).role !== 'SUPPORT',
        after: async (response: any, _request: any, context: any) => {
          // Only the ONE user whose record was just edited gets notified - this is a
          // targeted per-user alert, not a broadcast, regardless of how many other
          // users an admin edits over the course of a day.
          const previousStatus = context?.record?.params?.kycStatus;
          const updatedStatus = response?.record?.params?.kycStatus;
          const userId = response?.record?.params?.id as string | undefined;

          if (userId && updatedStatus && previousStatus !== updatedStatus && !response?.record?.errors) {
            if (updatedStatus === 'VERIFIED') {
              await notifyUser({
                userId,
                type: 'KYC',
                title: 'Verification successful',
                body: 'Your account has been verified by our team.'
              });
            } else if (updatedStatus === 'REJECTED') {
              await notifyUser({
                userId,
                type: 'KYC',
                title: 'Verification update',
                body: 'There was an issue verifying your account. Please contact support for details.'
              });
            }
          }
          return response;
        }

      },
      // Stopgap for "I forgot my password" until Resend has a verified
      // sending domain (see /api/password/forgot) - an admin generates a
      // one-time temporary password here, relays it to the user by hand
      // (WhatsApp/phone call), and the user's next login is forced through
      // a "set a new password" screen (see mustChangePassword in
      // schema.prisma, requires_password_change on /auth/login, and
      // POST /user/password/change which clears the flag once they do).
      // The plaintext temp password is shown ONCE in this action's own
      // success notice and is never written anywhere else - not the audit
      // log, not a second time if the page is refreshed.
      resetPassword: {
        actionType: 'record',
        icon: 'Key',
        // This action has no input form. AdminJS must be explicitly told to
        // use its standard action page; otherwise it renders the error
        // "You have to implement action component for your ActionSee".
        component: false,
        guard:
          'This immediately replaces the user\'s password with a temporary one and forces them to set a new password on next login. Continue?',
        isAccessible: ({ currentAdmin }) => {
          const admin = currentAdmin as unknown as AdminSessionUser | undefined;
          return !!admin && admin.role !== 'SUPPORT';
        },
        handler: async (request, response, context) => {
          const { record, currentAdmin } = context;
          const admin = currentAdmin as unknown as AdminSessionUser | undefined;
          if (!record || !admin) {
            throw new Error('Missing record or admin context');
          }

          const tempPassword = generateTempPassword();
          const passwordHash = await bcrypt.hash(tempPassword, 12);

          await prisma.user.update({
            where: { id: record.params.id as string },
            data: {
              passwordHash,
              mustChangePassword: true,
              passwordFailures: 0,
              passwordLockedUntil: null,
              passwordFailureAt: null
            }
          });

          await logAdminAction({
            adminId: admin.id,
            action: 'RESET_USER_PASSWORD',
            targetType: 'User',
            targetId: record.params.id as string
            // Deliberately no metadata here - the temp password itself
            // must never end up in a log any other admin can browse.
          });

          return {
            record: record.toJSON(currentAdmin),
            notice: {
              message: `Temporary password: ${tempPassword} — send this to the user now (it will not be shown again). They'll be asked to set a new password the moment they log in with it.`,
              type: 'success'
            }
          };
        }
      }
    }
  }
};
