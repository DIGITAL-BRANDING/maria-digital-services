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

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

async function sendPlatformEmail(params: { to: string; subject: string; text: string; html: string }) {
  const resend = getClient();
  if (!resend) {
    console.error('[email] RESEND_API_KEY is not set - cannot send platform email');
    return { sent: false };
  }
  try {
    const { error } = await resend.emails.send({ from: env.RESEND_FROM_EMAIL, ...params });
    if (error) {
      console.error('[email] Resend rejected a platform email', error);
      return { sent: false };
    }
    return { sent: true };
  } catch (error) {
    console.error('[email] Failed to send platform email', error);
    return { sent: false };
  }
}

export function sendWelcomeEmail(params: { to: string; name: string }) {
  const name = escapeHtml(params.name);
  const subject = 'Welcome to MARIA Digital Solutions';
  const text = `Welcome, ${params.name}! You can use MARIA Digital Solutions to verify NIN and BVN, request NIN validation, personalization, IPE clearance and modifications, submit CAC and other service requests, buy data and airtime, and fund your wallet. Sign in to your dashboard to get started.`;
  return sendPlatformEmail({
    to: params.to,
    subject,
    text,
    html: `<div style="font:16px Arial,sans-serif;max-width:600px;margin:auto;color:#172554"><h1>Welcome, ${name}!</h1><p>Welcome to MARIA Digital Solutions. Your account is ready.</p><p>From your dashboard you can:</p><ul><li>Verify NIN and BVN, and request NIN validation</li><li>Submit personalization, IPE clearance, and modification requests</li><li>Submit CAC and other service requests</li><li>Buy data and airtime</li><li>Fund your wallet and track requests in your history</li></ul><p>Sign in to your dashboard to get started.</p></div>`
  });
}

export function sendWalletFundedEmail(params: { to: string; name: string; amount: string; balance: string; reference: string }) {
  const safe = { name: escapeHtml(params.name), amount: escapeHtml(params.amount), balance: escapeHtml(params.balance), reference: escapeHtml(params.reference) };
  return sendPlatformEmail({
    to: params.to,
    subject: 'Your MARIA wallet has been funded',
    text: `Hello ${params.name}, ${params.amount} has been credited to your wallet. Your current balance is ${params.balance}. Reference: ${params.reference}.`,
    html: `<div style="font:16px Arial,sans-serif;max-width:600px;margin:auto;color:#172554"><h2>Wallet funded</h2><p>Hello ${safe.name}, <b>${safe.amount}</b> has been credited to your wallet.</p><p>Current balance: <b>${safe.balance}</b><br>Reference: ${safe.reference}</p></div>`
  });
}

export async function sendTicketSubmittedEmails(params: { to: string; name: string; service: string; reference: string; amount: string }) {
  const safe = { name: escapeHtml(params.name), service: escapeHtml(params.service), reference: escapeHtml(params.reference), amount: escapeHtml(params.amount) };
  const userMail = await sendPlatformEmail({
    to: params.to,
    subject: `New ${params.service} request received`,
    text: `Hello ${params.name}, your ${params.service} request has been submitted. Reference: ${params.reference}. Amount: ${params.amount}. We will notify you when processing starts or when there is an update.`,
    html: `<div style="font:16px Arial,sans-serif;max-width:600px;margin:auto;color:#172554"><h2>Request submitted</h2><p>Hello ${safe.name}, your <b>${safe.service}</b> request has been received.</p><p>Reference: <b>${safe.reference}</b><br>Amount: <b>${safe.amount}</b></p><p>We will email you when processing starts and when the request is updated.</p></div>`
  });

  const adminTo = env.ADMIN_NOTIFICATION_EMAIL || env.ALERT_EMAIL;
  let adminMail = { sent: false };
  if (adminTo) {
    adminMail = await sendPlatformEmail({
      to: adminTo,
      subject: `New service request needs attention: ${params.service}`,
      text: `A new service request is waiting for attention. Service: ${params.service}. User: ${params.name} (${params.to}). Reference: ${params.reference}. Amount: ${params.amount}.`,
      html: `<div style="font:16px Arial,sans-serif;max-width:600px;margin:auto;color:#172554"><h2>New request needs attention</h2><p>Service: <b>${safe.service}</b><br>User: ${safe.name} (${escapeHtml(params.to)})<br>Reference: <b>${safe.reference}</b><br>Amount: ${safe.amount}</p></div>`
    });
  } else {
    console.warn('[email] ADMIN_NOTIFICATION_EMAIL and ALERT_EMAIL are not set; no admin ticket alert was sent');
  }
  return { userSent: userMail.sent, adminSent: adminMail.sent };
}

export function sendTicketProcessingEmail(params: { to: string; name: string; service: string; reference: string }) {
  const safe = { name: escapeHtml(params.name), service: escapeHtml(params.service), reference: escapeHtml(params.reference) };
  return sendPlatformEmail({
    to: params.to,
    subject: `Your ${params.service} request is being processed`,
    text: `Hello ${params.name}, your ${params.service} request (${params.reference}) is now being processed. We will email you when there is another update.`,
    html: `<div style="font:16px Arial,sans-serif;max-width:600px;margin:auto;color:#172554"><h2>Your request is being processed</h2><p>Hello ${safe.name}, your <b>${safe.service}</b> request is now being processed.</p><p>Reference: <b>${safe.reference}</b></p><p>We will email you when there is another update.</p></div>`
  });
}

export function sendAdminComposedEmail(params: { to: string; subject: string; message: string }) {
  const safeMessage = escapeHtml(params.message).replace(/\r?\n/g, '<br>');
  return sendPlatformEmail({
    to: params.to,
    subject: params.subject,
    text: params.message,
    html: `<div style="font:16px Arial,sans-serif;max-width:600px;margin:auto;color:#172554"><div style="white-space:normal;line-height:1.6">${safeMessage}</div><p style="margin-top:24px;color:#64748b">MARIA Digital Solutions</p></div>`
  });
}
