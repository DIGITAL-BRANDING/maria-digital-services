import crypto from 'node:crypto';
import { Router } from 'express';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import {
  creditDirectDeposit,
  creditDirectDepositByAccountNumber,
  creditWalletByReference,
  markFundingFailed
} from '../services/wallet.service.js';
import { paystackService } from '../services/paystack.service.js';
import { katpayService } from '../services/katpay.service.js';
import { advanceSession } from '../services/whatsapp-session.service.js';

function normalizeKatpayStatus(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim().toUpperCase();
  if (typeof value === 'boolean') return value ? 'SUCCESS' : 'FAILED';
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['status', 'value', 'name', 'code']) {
      const normalized = normalizeKatpayStatus(record[key]);
      if (normalized) return normalized;
    }
  }
  return undefined;
}

/**
 * Picks the field to use as this deposit's dedup key for
 * creditDirectDepositByAccountNumber's providerRef. Exported and unit-tested
 * on its own (see __tests__/webhook.routes.reference.test.ts) because this
 * exact ordering caused a real production incident: `reference` was tried
 * first, but for a bank transfer that field is frequently just the
 * narration text (sender name/account), which stays IDENTICAL across every
 * transfer the same sender makes into the same account. A user who
 * transferred ₦10,000 then two separate ₦250 deposits had all three land
 * with the same `transaction.reference` narration - the first claimed that
 * text as its providerRef, and the other two were silently treated as
 * "already processed" duplicates (200 back to KatPay, dashboard shows
 * "Delivered", wallet never credited). `id` is KatPay's own per-event
 * identifier and is tried first now for exactly that reason.
 */
export function pickKatpayTransactionReference(transaction: Record<string, unknown>): string | undefined {
  const raw = transaction.id ?? transaction.order_no ?? transaction.orderNo ?? transaction.reference;
  return raw == null ? undefined : String(raw).trim();
}

export const webhookRoutes = Router();

// Public, non-sensitive connectivity check for KatPay's dashboard setup.
// KatPay only POSTs signed events; this GET makes it possible to verify the
// exact Railway URL in a browser before waiting for a real bank transfer.
webhookRoutes.get('/katpay', (_req, res) => {
  res.json({
    status: true,
    webhook: 'katpay',
    ready: Boolean(env.KATPAY_WEBHOOK_SECRET ?? env.KATPAY_SECRET_KEY),
    message: 'POST signed KatPay events to this path'
  });
});

/**
 * Paystack webhook. Mounted in app.ts with express.raw() (NOT express.json()) ahead of
 * the global JSON parser, because the signature is computed over the exact raw request
 * body — parsing/re-serializing it first would make the signature check unreliable.
 */
webhookRoutes.post('/paystack', async (req, res) => {
  const signature = req.header('x-paystack-signature');
  if (!env.PAYSTACK_SECRET_KEY || !signature) {
    return res.status(400).json({ status: false, message: 'Missing signature' });
  }

  const rawBody = req.body as Buffer;
  const expectedSignature = crypto
    .createHmac('sha512', env.PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest('hex');

  if (expectedSignature !== signature) {
    return res.status(401).json({ status: false, message: 'Invalid signature' });
  }

  const event = JSON.parse(rawBody.toString('utf8'));

  if (event.event === 'charge.success') {
    const reference = event.data?.reference as string | undefined;
    const channel = event.data?.channel as string | undefined;
    const customerCode = event.data?.customer?.customer_code as string | undefined;

    if (reference) {
      // Don't trust the webhook payload's amount/status directly — re-verify
      // server-to-server before crediting anything.
      const verified = await paystackService.verifyTransaction(reference);

      if (verified.status === 'success') {
        const existingTransaction = await prisma.transaction.findUnique({ where: { reference } });

        if (existingTransaction) {
          // A funding attempt WE initiated — card charge (/wallet/fund) or a
          // Pay-with-Transfer dynamic account (/wallet/fund/dynamic) — already has
          // a PENDING row waiting for this exact reference. Credit it as before.
          const credited = await creditWalletByReference(reference);

          // If this funding attempt came from the WhatsApp bot's "fund" command
          // (tagged in metadata when the PENDING row was created — see
          // whatsapp-session.service.ts), let the same chat know it went through,
          // since the in-app push notification creditWalletByReference already
          // sent won't be seen by someone who paid entirely from WhatsApp.
          const metadata = credited.metadata as { channel?: string; whatsapp_phone?: string } | null;
          if (metadata?.channel === 'whatsapp' && metadata.whatsapp_phone) {
            await sendWhatsAppText(
              metadata.whatsapp_phone,
              `Payment received! NGN${(Number(credited.amountKobo) / 100).toFixed(2)} was added to your wallet. Reply "fund" to top up again, or pick a network to buy data.`
            );
          }
        } else if (customerCode && (channel === 'dedicated_nuban' || channel === 'bank_transfer')) {
          // No pending transaction exists for this reference, which means the
          // money arrived as a direct transfer into the user's permanent Dedicated
          // Virtual Account — out-of-band, not through any endpoint of ours. This
          // is the "just transfer to the account on your dashboard" flow. Credit
          // it on the fly, matched by the Paystack customer_code stored on the
          // user's record.
          await creditDirectDeposit({
            reference,
            amountKobo: BigInt(verified.amount),
            customerCode,
            channel
          });
        }
        // Any other charge.success with no matching transaction and no
        // recognizable channel/customer is ignored rather than guessed at.
      } else {
        await markFundingFailed(reference);
      }
    }
  }

  // Paystack expects a fast 200 regardless of whether we acted on the event type.
  res.sendStatus(200);
});

/**
 * KatPay webhook. Mounted under the same express.raw() as /paystack above (see
 * app.ts) — KatPay's X-Katpay-Signature, like Paystack's, is computed over the
 * exact raw request bytes, so it must be verified before any JSON parsing happens.
 *
 * Handles the two events relevant to wallet funding:
 *   - virtual_account.payment_received: money landed directly in a user's
 *     permanent KatPay virtual account (the "just transfer to the account on your
 *     dashboard" flow) — no pending transaction exists for this yet, matched by
 *     the account number instead.
 *   - transfer_payment.completed: confirms a one-time /wallet/fund/dynamic order
 *     initiated by us — a PENDING transaction already exists, matched by our own
 *     merchant_reference.
 * Both other event types (transaction.completed, payout.processed) are accepted
 * but currently no-ops — nothing in this app consumes them yet.
 */
webhookRoutes.post('/katpay', async (req, res) => {
  // Keep this first line deliberately cheap and non-sensitive: it tells us
  // whether KatPay is reaching Railway at all before signature/payload checks.
  console.log('[katpay-webhook] received', {
    contentType: req.header('content-type') ?? null,
    hasSignature: Boolean(req.header('x-katpay-signature')),
    hasTimestamp: Boolean(req.header('x-katpay-timestamp'))
  });
  const signature = req.header('x-katpay-signature');
  const timestamp = req.header('x-katpay-timestamp');
  const secret = env.KATPAY_WEBHOOK_SECRET ?? env.KATPAY_SECRET_KEY;

  if (!secret) {
    console.warn('[katpay-webhook] rejected - missing required data', {
      hasSecret: Boolean(secret),
      hasSignatureHeader: Boolean(signature),
      hasTimestampHeader: Boolean(timestamp),
      contentType: req.header('content-type') ?? null
    });
    // A webhook secret is required before we can safely process a delivery.
    // Acknowledge the request when configuration is absent so KatPay does not
    // retry indefinitely; wallet funding still has the explicit verify fallback.
    return res.status(200).json({ ok: true, ignored: true, reason: 'Webhook secret not configured' });
  }
  if (!signature || !timestamp) {
    console.warn('[katpay-webhook] rejected - missing signature/timestamp');
    return res.status(400).json({ error: 'Missing required headers' });
  }

  // Reject stale signed deliveries so a captured valid webhook cannot be replayed.
  const parsedTimestamp = /^\d+$/.test(timestamp)
    ? Number(timestamp) * (timestamp.length <= 10 ? 1000 : 1)
    : Date.parse(timestamp);
  if (!Number.isFinite(parsedTimestamp) || Math.abs(Date.now() - parsedTimestamp) > 5 * 60_000) {
    console.warn('[katpay-webhook] rejected - stale or unparseable timestamp', {
      rawTimestamp: timestamp,
      parsedTimestamp: Number.isFinite(parsedTimestamp) ? new Date(parsedTimestamp).toISOString() : 'unparseable',
      serverNow: new Date().toISOString(),
      driftMs: Number.isFinite(parsedTimestamp) ? Date.now() - parsedTimestamp : null
    });
    return res.status(401).json({ error: 'Webhook timestamp is stale or invalid' });
  }

  const rawBody = req.body as Buffer;
  // If express.raw() didn't actually capture a Buffer (e.g. body-parsing was
  // skipped or something upstream consumed the stream first), rawBody would
  // be a plain object here - Buffer.isBuffer catches that case explicitly
  // instead of silently stringifying to "[object Object]" and failing HMAC
  // verification with no trace of why.
  if (!Buffer.isBuffer(rawBody)) {
    console.error('[katpay-webhook] rejected - request body was not captured as a raw Buffer', {
      bodyType: typeof rawBody,
      contentType: req.header('content-type') ?? null,
      contentLength: req.header('content-length') ?? null
    });
    return res.status(400).json({ error: 'Could not read request body' });
  }

  const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;
  const expectedSignature = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  const signatureValid =
    signatureBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(signatureBuffer, expectedBuffer);

  if (!signatureValid) {
    // Never log the secret or the raw signature/body content here (both are
    // sensitive) - only lengths, which are enough to tell a length mismatch
    // (near-certainly a body-capture problem, see the Buffer.isBuffer check
    // above) apart from a same-length-but-wrong-bytes mismatch (a genuine
    // secret/algorithm mismatch with KatPay's dashboard config).
    console.error('[katpay-webhook] rejected - signature verification failed', {
      receivedSignatureLength: signatureBuffer.length,
      expectedSignatureLength: expectedBuffer.length,
      bodyByteLength: rawBody.length,
      usingWebhookSpecificSecret: Boolean(env.KATPAY_WEBHOOK_SECRET)
    });
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch (_parseError) {
    console.error('[katpay-webhook] rejected - body is not valid JSON despite passing signature verification', {
      bodyPreview: rawBody.toString('utf8').slice(0, 200)
    });
    return res.status(400).json({ error: 'Malformed JSON body' });
  }

  // Static virtual-account webhooks use `event_type`, whereas KatPay's
  // documented pay-with-transfer callback uses `event`. Supporting both is
  // essential: otherwise completed dynamic transfers are acknowledged (200)
  // but never credited.
  const eventTypeRaw = event.event_type ?? event.event;
  const eventType = typeof eventTypeRaw === 'string' ? eventTypeRaw.trim().toLowerCase() : undefined;

  try {
    // KatPay documents both names for a successful static-account deposit.
    // Some merchant accounts receive `transaction.completed` instead of the
    // more specific virtual-account event, so both must credit the same way.
    if (eventType === 'virtual_account.payment_received' || eventType === 'transaction.completed') {
      const transaction = event.data?.transaction ?? {};
      const virtualAccount = event.data?.virtual_account ?? {};
      const orderStatus = normalizeKatpayStatus(transaction.order_status);
      // Trimmed defensively - a stray leading/trailing space here (from either
      // side) would otherwise cause a silent, permanent match failure below,
      // since `findFirst({ where: { virtualAccountNumber } })` is an exact
      // string match with no normalization of its own.
      // KatPay's examples use strings, but real bank/webhook serializers may
      // emit account numbers and references as numbers. Normalizing before
      // trimming avoids a runtime TypeError that previously prevented credit.
      const rawAccountNumber =
        virtualAccount.account_number ??
        virtualAccount.accountNumber ??
        event.data?.customer?.account_number;
      const accountNumber = rawAccountNumber == null ? undefined : String(rawAccountNumber).trim();
      // Prefer KatPay's own event/transaction id first - see
      // pickKatpayTransactionReference()'s comment above for why
      // `transaction.reference` alone caused a real production incident.
      const reference = pickKatpayTransactionReference(transaction);
      const rawAmountCents = transaction.order_amount_cents ?? transaction.amount_cents;
      const amountKobo =
        rawAmountCents != null
          ? BigInt(Math.round(Number(rawAmountCents)))
          : BigInt(Math.round(Number(transaction.order_amount ?? transaction.amount ?? 0) * 100));

      console.log(
        '[katpay-webhook] virtual_account.payment_received',
        JSON.stringify({ accountNumber, reference, orderStatus, amountKobo: amountKobo.toString() })
      );

      if (['SUCCESS', 'COMPLETED', 'PAID', '1', 'TRUE'].includes(orderStatus ?? '') && accountNumber && reference) {
        // Logged separately from the generic catch below, with the exact
        // accountNumber this webhook reported - if this throws
        // USER_NOT_FOUND_FOR_PAYMENT, compare the accountNumber in THIS log
        // line against the user's actual stored virtualAccountNumber
        // (Admin -> User Wallet Activity, or `SELECT id, "virtualAccountNumber"
        // FROM "User" WHERE "virtualAccountNumber" IS NOT NULL`) to confirm
        // whether it's a genuine mismatch (wrong/stale number saved at
        // provisioning time) versus some other failure entirely.
        try {
          await creditDirectDepositByAccountNumber({
            reference,
            amountKobo,
            accountNumber,
            channel: 'katpay_virtual_account'
          });
        } catch (creditError) {
          console.error(
            '[katpay-webhook] FAILED to credit virtual_account.payment_received',
            JSON.stringify({ accountNumber, reference, amountKobo: amountKobo.toString() }),
            creditError
          );
          throw creditError;
        }
      } else {
        console.warn(
          '[katpay-webhook] virtual_account.payment_received not credited - condition not met',
          JSON.stringify({
            accountNumber: accountNumber ?? null,
            reference: reference ?? null,
            orderStatus: orderStatus ?? null,
            reason: !accountNumber
              ? 'missing account_number in payload'
              : !reference
                ? 'missing reference/order_no in payload'
                : 'orderStatus not in accepted list'
          })
        );
      }
    } else if (eventType === 'transfer_payment.completed') {
      // NOTE: KatPay's published docs don't show this event's exact payload shape -
      // this reads the same field names the /v1/transfer-payments response itself
      // uses (merchant_reference/status), which is the most likely shape for the
      // webhook too. Confirm against a real delivered webhook once KatPay sends one
      // and adjust the paths below if it's nested differently.
      const payment = event.data?.transfer_payment ?? event.data ?? {};
      const reference = payment.merchant_reference as string | undefined;

      if (reference) {
        // Same "never trust the webhook payload alone" principle the /paystack
        // handler above follows - re-check directly with KatPay before crediting,
        // rather than trusting event.data.transfer_payment.status as-is. Needs the
        // KatPay uuid, which was stored in the pending Transaction's metadata when
        // /wallet/fund/dynamic created it (see payment-provider.service.ts).
        const pending = await prisma.transaction.findUnique({ where: { reference } });
        const uuid = (pending?.metadata as { provider_reference?: string } | null)?.provider_reference;

        if (uuid) {
          const verified = await katpayService.getTransferPaymentStatus(uuid);
          // Accept both 'success' and 'completed' - see the comment on
          // KatpayTransferPayment['status'] in katpay.service.ts for why.
          if (verified.status === 'success' || verified.status === 'completed') {
            await creditWalletByReference(reference);
          } else if (verified.status === 'failed' || verified.status === 'expired') {
            await markFundingFailed(reference);
          }
          // Any other in-between status (e.g. 'processing') - do nothing, a later
          // webhook delivery or the /fund/verify fallback will resolve it.
        }
      }
    } else {
      // Anything else - including a real KatPay event whose exact name doesn't
      // match either branch above (typos, an undocumented alias, or a payload
      // shaped differently than the docs suggest) - falls through to here
      // completely silently otherwise: KatPay gets its 200 OK, sees the delivery
      // as successful, and never retries, while the deposit is never credited and
      // nothing in the logs ever points at why. Logging the FULL raw event the
      // first time an unrecognized one arrives is the only way to catch that
      // class of bug instead of chasing it blind from a user complaint alone.
      console.warn(
        '[katpay-webhook] unrecognized event_type/event - not credited',
        JSON.stringify({ eventType: eventType ?? null, event })
      );
    }
  } catch (error) {
    console.error('[katpay-webhook] failed to process event', eventType, error);
    // Return non-2xx for a genuine processing failure so KatPay retries delivery.
    return res.status(500).json({ error: 'Webhook processing failed' });
  }

  res.sendStatus(200);
});

/**
 * One-time handshake Meta sends when you register this URL in the App Dashboard.
 * No body involved, so mounting under the raw-body parser above is harmless.
 */
webhookRoutes.get('/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && env.WHATSAPP_VERIFY_TOKEN && token === env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

/**
 * Inbound WhatsApp messages. Mounted under the same express.raw() as /paystack
 * above (see app.ts) because, exactly like Paystack, Meta's X-Hub-Signature-256
 * is computed over the exact raw request bytes - parsing first would make the
 * signature check unreliable.
 */
webhookRoutes.post('/whatsapp', async (req, res) => {
  const signatureHeader = req.header('x-hub-signature-256');
  if (!env.WHATSAPP_APP_SECRET || !signatureHeader) {
    return res.sendStatus(400);
  }

  const rawBody = req.body as Buffer;
  const expectedSignature =
    'sha256=' + crypto.createHmac('sha256', env.WHATSAPP_APP_SECRET).update(rawBody).digest('hex');

  if (
    signatureHeader.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expectedSignature))
  ) {
    return res.sendStatus(401);
  }

  // Meta expects a fast 200 regardless of what we do with the payload, and retries
  // aggressively on non-2xx - respond immediately so a slow provider call downstream
  // can never cause a duplicate delivery on top of the idempotency key already in place.
  res.sendStatus(200);

  try {
    const payload = JSON.parse(rawBody.toString('utf8'));
    const entries = payload?.entry ?? [];

    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        const messages = change.value?.messages ?? [];
        for (const msg of messages) {
          const from = msg.from as string; // E.164 without a leading '+'
          const text: string =
            msg.text?.body ?? msg.button?.text ?? msg.interactive?.button_reply?.title ?? '';
          if (!from || !text) continue;

          const reply = await advanceSession(from, text, msg.id);
          await sendWhatsAppText(from, reply);
        }
      }
    }
  } catch (error) {
    console.error('[whatsapp-webhook] failed to process inbound message', error);
  }
});

async function sendWhatsAppText(to: string, body: string) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    console.error('[whatsapp-webhook] WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID not configured, cannot reply');
    return;
  }

  const response = await fetch(
    `https://graph.facebook.com/v20.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } })
    }
  );

  if (!response.ok) {
    console.error('[whatsapp-webhook] failed to send reply', response.status, await response.text());
  }
}
