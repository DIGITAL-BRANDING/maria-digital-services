import { getModelByName } from '@adminjs/prisma';
import type { ResourceWithOptions } from 'adminjs';
import { prisma } from '../../lib/prisma.js';
import type { AdminSessionUser } from '../auth.js';

const canManageAppConfig = ({ currentAdmin }: { currentAdmin?: Record<string, unknown> }) => {
  const admin = currentAdmin as unknown as AdminSessionUser | undefined;
  return admin?.role === 'SUPER_ADMIN';
};

/**
 * Singleton (id="default", self-seeded by getAppConfig() on first read) -
 * only new/delete are disabled, same as ReferralSettings/DataPlanPricing.
 * Restricted to SUPER_ADMIN (not FINANCE, unlike most other settings
 * resources) because setting minAndroidVersion too high locks EVERY user
 * on an older build out of the app at their next launch until they update -
 * a mistake here is a full outage, not a pricing tweak.
 */
export const appConfigResource: ResourceWithOptions = {
  resource: { model: getModelByName('AppConfig'), client: prisma },
  options: {
    id: 'AppConfig',
    navigation: { name: 'Settings', icon: 'Smartphone' },
    listProperties: ['minAndroidVersion', 'latestAndroidVersion', 'updatedAt'],
    showProperties: [
      'id',
      'minAndroidVersion',
      'latestAndroidVersion',
      'androidDownloadUrl',
      'updateMessage',
      'updatedAt'
    ],
    editProperties: ['minAndroidVersion', 'latestAndroidVersion', 'androidDownloadUrl', 'updateMessage'],
    properties: {
      id: { isVisible: { list: false, filter: false, show: true, edit: false } },
      minAndroidVersion: {
        description:
          'Any installed app version below this (comparing 1.2.3-style numbers, ignores the +buildNumber) is blocked at the splash screen with a "please update" screen until the user updates. Match this to pubspec.yaml\'s version field of the build you want to require.'
      },
      latestAndroidVersion: {
        description: 'Shown to the user as "Version X is available" on the update screen. Informational only - does not itself block anyone.'
      },
      androidDownloadUrl: {
        description:
          'Where the "Update Now" button sends the user. Defaults to the GitHub "latest release" link, which always points at the newest uploaded MajorDataLink.apk without needing to change here.'
      },
      updateMessage: {
        description: 'Optional custom message shown on the update screen, e.g. explaining what the update fixes. Leave empty for a generic message.'
      },
      updatedAt: { isVisible: { list: true, filter: false, show: true, edit: false } }
    },
    actions: {
      list: { isAccessible: canManageAppConfig },
      show: { isAccessible: canManageAppConfig },
      edit: { isAccessible: canManageAppConfig },
      new: { isAccessible: false },
      delete: { isAccessible: false },
      bulkDelete: { isAccessible: false }
    }
  }
};
