import { TransactionType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/error.js';
import { nanoid } from 'nanoid';
import { verifyPin, createPendingFunding } from './wallet.service.js';
import { paystackService } from './paystack.service.js';
import { providerService, NETWORK_IDS } from './provider.service.js';
import * as bilalsadasub from './bilalsadasub.service.js';
import { getPricingSettings } from './pricing-settings.service.js';
import { processProviderPurchase } from '../routes/vtu.routes.js';

// Deliberately generous but bounded — mirrors no explicit limit in the app's
// own /wallet/fund route, but chat is an easier place for a typo (an extra
// zero) to slip through than a numeric keyboard input field.
const MIN_FUND_NAIRA = 50;
const MAX_FUND_NAIRA = 200_000;

const NETWORK_MENU = Object.keys(NETWORK_IDS); // ['MTN', 'GLO', '9MOBILE', 'AIRTEL', 'SMILE']

type SessionContext = {
  network?: string;
  planId?: string;
  planName?: string;
  planAmount?: number;
  recipientPhone?: string;
  planOptions?: { id: string; name: string; amount: number }[];
  pinFailures?: number;
};

function networkMenuText() {
  return NETWORK_MENU.map((name, i) => `${i + 1}. ${name}`).join('\n');
}

async function setState(phone: string, state: string, context: SessionContext) {
  await prisma.whatsAppSession.update({
    where: { phone },
    data: { state, context: context as any }
  });
}

/**
 * Advances the WhatsApp conversation for `phone` by one turn given the raw
 * text they just sent, and returns the reply to send back.
 *
 * Menu-number driven end to end (never free-text parsing of amounts, plans,
 * or network names) - this moves real money, so every step must resolve to
 * one unambiguous choice rather than trying to interpret what someone meant.
 */
export async function advanceSession(phone: string, rawText: string, messageId: string): Promise<string> {
  const input = rawText.trim();

  if (input.toLowerCase() === 'cancel') {
    await prisma.whatsAppSession.upsert({
      where: { phone },
      create: { phone, state: 'START' },
      update: { state: 'START', context: {} }
    });
    return 'Cancelled. Send any message to start again.';
  }

  if (input.toLowerCase() === 'fund') {
    await prisma.whatsAppSession.upsert({
      where: { phone },
      create: { phone, state: 'FUND_AWAITING_AMOUNT' },
      update: { state: 'FUND_AWAITING_AMOUNT', context: {} }
    });
    return `How much would you like to fund your wallet with? Reply with an amount between NGN${MIN_FUND_NAIRA} and NGN${MAX_FUND_NAIRA.toLocaleString('en-NG')}, or "cancel".`;
  }

  const session = await prisma.whatsAppSession.upsert({
    where: { phone },
    create: { phone, state: 'START' },
    update: {}
  });

  const ctx = (session.context as SessionContext) ?? {};

  const user = session.userId
    ? await prisma.user.findUnique({ where: { id: session.userId } })
    : await prisma.user.findFirst({ where: { phone } });

  if (!user) {
    return "We couldn't find an account registered to this WhatsApp number. Please sign up in the Major Data Link app using this same phone number, then message us again.";
  }
  if (user.accountStatus !== 'ACTIVE') {
    return 'Your account is not currently active. Please contact support in the app.';
  }
  if (!session.userId) {
    await prisma.whatsAppSession.update({ where: { phone }, data: { userId: user.id } });
  }

  switch (session.state) {
    case 'START': {
      await setState(phone, 'AWAITING_NETWORK', {});
      return `Welcome to Major Data Link! Which network?\n${networkMenuText()}\n\n(Reply "fund" to top up your wallet, or "cancel" anytime to stop.)`;
    }

    case 'AWAITING_NETWORK': {
      const idx = Number(input) - 1;
      const network = NETWORK_MENU[idx];
      if (!network) return `Please reply with a number from 1-${NETWORK_MENU.length}.\n${networkMenuText()}`;

      const provider = (await getPricingSettings()).dataAirtimeProvider === 'bilalsadasub' ? 'bilalsadasub' : 'alrahuz';
      const plans = provider === 'bilalsadasub'
        ? await bilalsadasub.getDataPlans(network)
        : await providerService.getDataPlans(network);
      if (plans.length === 0) {
        await setState(phone, 'AWAITING_NETWORK', {});
        return `No ${network} plans are available right now. Pick another network:\n${networkMenuText()}`;
      }

      const options = plans.slice(0, 9).map((p) => ({ id: p.id, name: p.name, amount: p.amount }));
      const listText = options.map((p, i) => `${i + 1}. ${p.name} - NGN${p.amount}`).join('\n');

      await setState(phone, 'AWAITING_PLAN', { network, planOptions: options });
      return `${network} plans:\n${listText}\n\nReply with the plan number.`;
    }

    case 'AWAITING_PLAN': {
      const options = ctx.planOptions ?? [];
      const idx = Number(input) - 1;
      const chosen = options[idx];
      if (!chosen) return 'Please reply with a valid plan number from the list, or "cancel".';

      await setState(phone, 'AWAITING_RECIPIENT', {
        network: ctx.network,
        planId: chosen.id,
        planName: chosen.name,
        planAmount: chosen.amount
      });
      return `Which number should receive the ${chosen.name} data? Reply with the phone number, or reply "me" to use this WhatsApp number.`;
    }

    case 'AWAITING_RECIPIENT': {
      const recipientPhone = input.toLowerCase() === 'me' ? user.phone : input.replace(/[\s-]/g, '');
      if (!/^(\+?234|0)\d{10}$/.test(recipientPhone)) {
        return 'That doesn\'t look like a valid Nigerian phone number. Please try again, or reply "cancel".';
      }

      await setState(phone, 'AWAITING_PIN', { ...ctx, recipientPhone });
      return `Confirm: ${ctx.planName} for ${recipientPhone} - NGN${ctx.planAmount}.\nEnter your 4-digit transaction PIN to pay, or reply "cancel".`;
    }

    case 'AWAITING_PIN': {
      if (!/^\d{4}$/.test(input)) return 'PIN must be 4 digits. Please try again, or reply "cancel".';

      try {
        await verifyPin(user.id, input);
      } catch (error) {
        if (error instanceof ApiError && error.code === 'PIN_LOCKED') {
          await setState(phone, 'START', {});
          return 'Too many wrong PIN attempts. Your PIN is temporarily locked - please try again later or reset it in the app.';
        }
        return 'Incorrect PIN. Please try again, or reply "cancel".';
      }

      // Re-fetch the plan by ID rather than trusting the amount cached in the
      // session context - same defense-in-depth as POST /api/data/purchase,
      // in case pricing changed between menu selection and confirmation.
      const provider = (await getPricingSettings()).dataAirtimeProvider === 'bilalsadasub' ? 'bilalsadasub' : 'alrahuz';
      const plan = provider === 'bilalsadasub'
        ? await bilalsadasub.getDataPlan(ctx.network!, ctx.planId!)
        : await providerService.getDataPlan(ctx.network!, ctx.planId!);

      const result = await processProviderPurchase({
        userId: user.id,
        amount: plan.amount,
        type: TransactionType.DATA_PURCHASE,
        description: `${plan.name} data purchase for ${ctx.recipientPhone} (WhatsApp)`,
        metadata: {
          channel: 'whatsapp',
          network: ctx.network,
          plan_id: ctx.planId,
          plan_name: plan.name,
          phone: ctx.recipientPhone,
          amount: plan.amount,
          provider
        },
        // Keyed off the WhatsApp message's own ID (globally unique per Meta) so
        // a redelivered webhook - which Meta does not guarantee against, same
        // as Paystack - can never trigger a second debit for the same message.
        idempotencyKey: `wa-${messageId}`,
        provider,
        costKobo: BigInt(Math.round(plan.providerAmount * 100)),
        callProvider: (reference) =>
          provider === 'bilalsadasub'
            ? bilalsadasub.buyData({ network: ctx.network!, planId: ctx.planId!, phone: ctx.recipientPhone!, reference })
            : providerService.buyData({
                network: ctx.network!,
                planId: ctx.planId!,
                phone: ctx.recipientPhone!,
                amount: plan.amount,
                reference
              })
      });

      await setState(phone, 'START', {});
      return result.status === 'success'
        ? `Payment successful! ${result.message}\nReference: ${result.reference}\nNew balance: NGN${result.balanceAfter}`
        : `${result.message}\nNew balance: NGN${result.balanceAfter}`;
    }

    case 'FUND_AWAITING_AMOUNT': {
      const amount = Number(input.replace(/[^\d.]/g, ''));
      if (!Number.isFinite(amount) || amount < MIN_FUND_NAIRA || amount > MAX_FUND_NAIRA) {
        return `Please reply with a number between NGN${MIN_FUND_NAIRA} and NGN${MAX_FUND_NAIRA.toLocaleString('en-NG')}, or "cancel".`;
      }

      const reference = `IDS-FUND-${Date.now()}-${nanoid(8).toUpperCase()}`;

      // Same PENDING-first pattern as POST /api/wallet/fund - the balance only
      // changes once Paystack confirms via the existing webhook, which also
      // sends the WhatsApp confirmation below (see webhook.routes.ts) since
      // this transaction is tagged with channel: 'whatsapp'.
      await createPendingFunding({
        userId: user.id,
        amount,
        reference,
        metadata: { channel: 'whatsapp', whatsapp_phone: phone }
      });

      const paystack = await paystackService.initializeTransaction({
        email: user.email,
        amountKobo: BigInt(Math.round(amount * 100)),
        reference
      });

      await setState(phone, 'START', {});
      return `Tap this link to pay NGN${amount} securely via Paystack:\n${paystack.authorization_url}\n\nYour wallet will be credited automatically once payment is confirmed.`;
    }

    default: {
      await setState(phone, 'AWAITING_NETWORK', {});
      return `Let's start over. Which network?\n${networkMenuText()}`;
    }
  }
}
