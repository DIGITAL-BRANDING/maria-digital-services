import { env } from '../config/env.js';
import { sendAlertEmail } from './email.js';

/**
 * The one piece of "does anyone find out when something breaks" this app
 * has, short of someone manually reading Railway logs (which is how every
 * production bug so far - the BVN_MODIFICATION enum error, the CAC
 * formidable/req.body bug - actually got noticed). Call this from:
 *   - middleware/error.ts, for an unexpected (non-ApiError) 500
 *   - server.ts's uncaughtException/unhandledRejection handlers
 *
 * Deliberately a thin wrapper around lib/email.ts's sendAlertEmail rather
 * than a new external service (Sentry/Bugsnag/etc) - it works the moment
 * ALERT_EMAIL is set in Railway, with zero new signups, reusing the
 * Resend integration already wired up for password resets. A dedicated
 * error-tracking service would give richer detail (stack traces linked to
 * source, deduping across deploys, etc) and is worth adding later, but
 * this is the difference between "nobody knows until a customer or admin
 * reports it" and "an email arrives within seconds" - the highest-value
 * part of that gap, for the least effort, today.
 */

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const lastSentAt = new Map<string, number>();

/** Collapses an error down to a short, stable-ish key so the exact same
 *  failure repeating in a crash loop only sends one email per window,
 *  instead of one per request/iteration. */
function fingerprint(context: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${context}:${message}`.slice(0, 200);
}

export async function alertCriticalError(context: string, error: unknown): Promise<void> {
  // Always log first and unconditionally - the alert email is a bonus on
  // top of that, never a replacement for it, and must never be the reason
  // an error goes unlogged if this function itself has a problem.
  console.error(`[alert] ${context}:`, error);

  if (!env.ALERT_EMAIL) return;

  const key = fingerprint(context, error);
  const now = Date.now();
  const last = lastSentAt.get(key);
  if (last && now - last < RATE_LIMIT_WINDOW_MS) return;
  lastSentAt.set(key, now);

  const stack = error instanceof Error ? error.stack : undefined;
  const body = [
    `Context: ${context}`,
    `Time: ${new Date().toISOString()}`,
    `Environment: ${env.NODE_ENV}`,
    '',
    stack ?? String(error)
  ].join('\n');

  try {
    await sendAlertEmail(`[MARIA backend] ${context}`, body);
  } catch (sendError) {
    // Never let a failure to send the ALERT about an error become a
    // second unhandled error itself.
    console.error('[alert] failed to send alert email', sendError);
  }
}
