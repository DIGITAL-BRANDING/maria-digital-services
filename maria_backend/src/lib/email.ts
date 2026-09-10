import { Resend } from 'resend';
import { env } from '../config/env.js';

let client: Resend | null = null;

function getClient() {
  if (!env.RESEND_API_KEY) return null;
  if (!client) client = new Resend(env.RESEND_API_KEY);
  return client;
}

/**
 * The only email this app sends right now. Deliberately doesn't throw on
 * a Resend failure - the caller (POST /password/forgot) always returns a
 * generic "if that email exists, a code was sent" response regardless, so
 * a delivery failure here just gets logged, never surfaced to the client
 * (which would otherwise leak whether an email address has an account).
 */
export async function sendPasswordResetEmail(email: string, code: string) {
  const resend = getClient();
  if (!resend) {
    console.error('[email] RESEND_API_KEY is not set - cannot send password reset email');
    return { sent: false };
  }

  try {
    const { error } = await resend.emails.send({
      from: env.RESEND_FROM_EMAIL,
      to: email,
      subject: `${code} is your MAJOR DATA-LINK password reset code`,
      text: `Your password reset code is ${code}. It expires in 10 minutes. If you didn't request this, you can ignore this email - your password won't change.`,
      html: `
        <div style="font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <p style="font-size: 15px; color: #14110b;">Someone requested a password reset for your MAJOR DATA-LINK account. Enter this code in the app to continue:</p>
          <p style="font-family: ui-monospace, monospace; font-size: 32px; font-weight: 700; letter-spacing: 0.08em; color: #14110b; background: #f2ead9; padding: 16px 20px; border-radius: 12px; text-align: center; margin: 20px 0;">${code}</p>
          <p style="font-size: 13px; color: #4a4438;">This code expires in 10 minutes. If you didn't request a password reset, you can safely ignore this email — your password will not change.</p>
        </div>
      `
    });

    if (error) {
      console.error('[email] Resend rejected the password reset email', error);
      return { sent: false };
    }
    return { sent: true };
  } catch (err) {
    console.error('[email] Failed to send password reset email', err);
    return { sent: false };
  }
}

/**
 * Used by lib/alerts.ts for critical-error notifications - reuses the same
 * Resend client/from-address as the password reset email above, just a
 * different recipient (env.ALERT_EMAIL) and plain-text body since this is
 * an internal ops notification, not something a customer sees.
 */
export async function sendAlertEmail(subject: string, body: string) {
  const resend = getClient();
  if (!resend || !env.ALERT_EMAIL) {
    return { sent: false };
  }

  try {
    const { error } = await resend.emails.send({
      from: env.RESEND_FROM_EMAIL,
      to: env.ALERT_EMAIL,
      subject,
      text: body
    });
    if (error) {
      console.error('[email] Resend rejected the alert email', error);
      return { sent: false };
    }
    return { sent: true };
  } catch (err) {
    console.error('[email] Failed to send alert email', err);
    return { sent: false };
  }
}
