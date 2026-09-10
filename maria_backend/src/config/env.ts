import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  WEB_ALLOWED_ORIGINS: z.string().default(''),
  PORT: z.coerce.number().default(8787),
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid MySQL URL').refine(
    (value) => value.startsWith('mysql://'),
    'DATABASE_URL must use the mysql:// scheme'
  ),
  FIREBASE_SERVICE_ACCOUNT_BASE64: z.string().optional(),
  ALRAHUZ_BASE_URL: z.string().url().default('https://alrahuzdata.com.ng/api'),
  ALRAHUZ_API_TOKEN: z.string().optional(),

  // BilalSadaSub - second data/airtime/cable/electricity/result-pin
  // provider (see bilalsadasub.service.ts). Auth is username+password (not
  // a static token like Alrahuz) - the service exchanges these for an
  // AccessToken at runtime and caches it in memory, re-generating on a 401.
  // Both optional so a deploy with no BilalSadaSub account configured yet
  // doesn't fail startup - PricingSettings.dataAirtimeProvider/
  // resultPinProvider just can't be switched to 'bilalsadasub' (and cable/
  // electricity purchases will fail with a clear error) until they're set.
  BILALSADASUB_BASE_URL: z.string().url().default('https://bilalsadasub.com'),
  BILALSADASUB_USERNAME: z.string().optional(),
  BILALSADASUB_PASSWORD: z.string().optional(),
  BILALSADASUB_LOW_BALANCE_THRESHOLD: z.coerce.number().positive().default(2000),
  BILALSADASUB_LOW_BALANCE_ALERT_COOLDOWN_MINUTES: z.coerce.number().int().positive().default(60),
  ALRAHUZ_DATA_PLANS_PATH: z.string().default('/data/'),
  ALRAHUZ_BALANCE_PATH: z.string().default('/user/'),
  ALRAHUZ_FUNDING_ACCOUNT_NUMBER: z.string().default('6651219714'),
  ALRAHUZ_FUNDING_ACCOUNT_NAME: z.string().default('ALRAHUZDATA - IMAM-DATASUB'),
  ALRAHUZ_FUNDING_BANK_NAME: z.string().default('Palmpay Automated Bank Transfer'),
  ALRAHUZ_EXAM_PIN_PATH: z.string().default('/exam/'),
  ALRAHUZ_WAEC_EXAM_ID: z.string().default('1'),
  ALRAHUZ_NECO_EXAM_ID: z.string().default('2'),
  ALRAHUZ_NABTEB_EXAM_ID: z.string().default('3'),
  RESULT_PIN_WAEC_DEFAULT_PRICE_NAIRA: z.coerce.number().positive().default(5150),
  RESULT_PIN_NECO_DEFAULT_PRICE_NAIRA: z.coerce.number().positive().default(2150),
  RESULT_PIN_NABTEB_DEFAULT_PRICE_NAIRA: z.coerce.number().positive().default(900),
  // Percentage deducted from every successful wallet funding, regardless of
  // gateway. Set to 0 to disable the fee; changing this environment value and
  // redeploying is all that is needed to change the rate.
  WALLET_FUNDING_FEE_PERCENT: z.coerce.number().min(0).max(100).default(2),
  ALRAHUZ_DATA_PLANS_CACHE_SECONDS: z.coerce.number().int().positive().default(900),
  // Alert threshold for YOUR OWN balance at Alrahuz (not any customer's wallet).
  // Below this, customer purchases will start failing even though their in-app
  // wallets are fine Ã¢â‚¬â€ see provider.service.ts's recordProviderBalance.
  ALRAHUZ_LOW_BALANCE_THRESHOLD: z.coerce.number().positive().default(2000),
  ALRAHUZ_LOW_BALANCE_ALERT_COOLDOWN_MINUTES: z.coerce.number().int().positive().default(60),

  // Techhubltd — NIN / BVN identity verification provider. Fully independent
  // of Alrahuz above: Alrahuz handles VTU (data/airtime/result pins), Techhub
  // handles identity verification (NIN/BVN slips + the five async services).
  // See src/services/techhub.service.ts.
  TECHHUB_BASE_URL: z.string().url().default('https://techhubltd.co/api/verification'),
  TECHHUB_API_KEY: z.string().optional(),
  // Same reasoning as ALRAHUZ_LOW_BALANCE_THRESHOLD above — YOUR balance at
  // Techhub, reported back on every async-service submit call (see
  // TechhubAsyncSubmitResponse.balance in techhub.service.ts). Techhub's
  // slip endpoints don't report a balance, so this only updates on
  // Delinking/NIN Validation/Personalization/BVN Retrieval/IPE Clearance
  // calls — still enough for ongoing visibility since those five run
  // through this app regularly.
  TECHHUB_LOW_BALANCE_THRESHOLD: z.coerce.number().positive().default(2000),
  TECHHUB_LOW_BALANCE_ALERT_COOLDOWN_MINUTES: z.coerce.number().int().positive().default(60),
  // Same string-boolean footgun as MOCK_PROVIDER above — see that comment.
  MOCK_TECHHUB: z
    .string()
    .default('false')
    .transform((value) => value.toLowerCase() !== 'false' && value !== '0'),
  DATA_PLAN_MARKUP_PERCENT: z.coerce.number().min(0).default(0),
  DATA_PLAN_MARKUP_NAIRA: z.coerce.number().min(0).default(0),
  AUTH_TOKEN_SECRET: z.string().min(32).default('dev-only-insecure-auth-token-secret-32'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),

  // Resend — sends the 6-digit "forgot password" code (see
  // src/lib/email.ts / src/routes/password.routes.ts). No SMTP/other
  // provider is configured anywhere in this codebase, so leaving
  // RESEND_API_KEY unset makes /password/forgot fail closed with a clear
  // 500 rather than silently pretending to send an email nobody gets.
  // RESEND_FROM_EMAIL defaults to Resend's own shared testing address,
  // which works immediately with zero domain setup - swap it for
  // something like 'MAJOR DATA-LINK <no-reply@yourdomain.com>' once a
  // sending domain is verified in the Resend dashboard.
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().default('MAJOR DATA-LINK <onboarding@resend.dev>'),
  // Where lib/alerts.ts sends critical-error notifications (unhandled
  // exceptions, uncaught rejections, and 5xx responses from unexpected -
  // i.e. non-ApiError - errors). Optional: unset just means alerting is
  // disabled and everything still only goes to console/Railway logs, same
  // as before this existed. Reuses RESEND_API_KEY/RESEND_FROM_EMAIL above -
  // no separate provider needed.
  ALERT_EMAIL: z.string().email().optional(),
  // NOTE: z.coerce.boolean() would parse the STRING "false" as true (JS's
  // Boolean("false") === true Ã¢â‚¬â€ any non-empty string is truthy). This explicit
  // string comparison is what actually respects MOCK_PROVIDER=false in .env.
  MOCK_PROVIDER: z
    .string()
    .default('false')
    .transform((value) => value.toLowerCase() !== 'false' && value !== '0'),
  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYSTACK_CALLBACK_URL: z.string().url().optional(),
  // Bank slug Paystack uses when creating a Dedicated Virtual Account for a
  // newly-validated customer. 'wema-bank' and 'titan-paystack' are the two
  // providers Paystack supports for DVAs as of this writing - check the
  // Fetch Providers endpoint (GET /dedicated_account/available_providers)
  // if this ever needs to change.
  PAYSTACK_DVA_PREFERRED_BANK: z.string().default('wema-bank'),
  // Whether to create a Dedicated Virtual Account for every user immediately at
  // signup, with no BVN. Paystack only requires BVN/customer validation for
  // businesses under the Financial Services / Betting / General Services
  // categories - if this account isn't one of those, leave this on and users get
  // a funding account the moment they log in. If Paystack rejects the call
  // (unvalidated customer), it fails silently and users fall back to the
  // BVN-based Static Account flow in kyc.service.ts. Set to 'false' if you'd
  // rather every user go through BVN verification first.
  PAYSTACK_INSTANT_DVA_ENABLED: z
    .string()
    .default('true')
    .transform((value) => value.toLowerCase() !== 'false' && value !== '0'),

  // Which payment gateway is currently "live" for virtual-account provisioning and
  // dynamic (pay-with-transfer) funding. Both providers' credentials can stay set in
  // .env at the same time - only this flag decides which one actually gets called.
  // Flip it to 'katpay' (or back to 'paystack') and redeploy if one provider starts
  // giving trouble; no code changes needed. See src/services/payment-provider.service.ts.
  PAYMENT_PROVIDER: z
    .string()
    .default('paystack')
    .transform((value) => value.toLowerCase())
    .pipe(z.enum(['paystack', 'katpay'])),

  // --- KatPay (https://katpay.co/docs) - kept side-by-side with Paystack above as a
  // swappable alternative. Same "must never throw / never block signup" philosophy as
  // Paystack's instant DVA - see tryProvisionInstantVirtualAccount in kyc.service.ts.
  KATPAY_SECRET_KEY: z.string().optional(),
  KATPAY_PUBLIC_KEY: z.string().optional(),
  KATPAY_MERCHANT_ID: z.string().optional(),
  // Used as the callback_url when creating a /v1/transfer-payments (dynamic funding)
  // order - KatPay POSTs the signed confirmation here once the customer's transfer lands.
  KATPAY_CALLBACK_URL: z.string().url().optional(),
  // HMAC key used to verify X-Katpay-Signature on inbound webhooks (see
  // webhook.routes.ts). KatPay's docs don't show a separate webhook-only secret, so
  // this defaults to KATPAY_SECRET_KEY unless you're given a distinct one.
  KATPAY_WEBHOOK_SECRET: z.string().optional(),
  // Bank code(s) passed as the `bankCode` array when creating a static virtual account
  // (POST /v1/virtual-accounts). PalmPay is what KatPay's own docs example uses.
  KATPAY_VIRTUAL_ACCOUNT_BANK_CODE: z.string().default('PALMPAY'),
  // Mirrors PAYSTACK_INSTANT_DVA_ENABLED - whether to provision a KatPay virtual
  // account for every new user immediately, with no BVN gate (KatPay's virtual-account
  // endpoint doesn't require one - just email/name/phone).
  KATPAY_INSTANT_VA_ENABLED: z
    .string()
    .default('true')
    .transform((value) => value.toLowerCase() !== 'false' && value !== '0'),

  // Kill switch for the KatPay virtual-account webhook crediting bug (Aug 2026 -
  // some deposits into a user's permanent VA aren't landing in their wallet
  // balance). Set to 'false' in Railway to instantly stop showing/provisioning
  // virtual account numbers on every surface (app + web) while that's being
  // fixed, without a redeploy. Does NOT touch existing users' stored
  // virtualAccountNumber or any KatPay-side account - purely hides it from API
  // responses (see lib/public-user.ts and wallet.routes.ts) so nobody funds into
  // an account that currently might not get credited. Flip back to 'true' (or
  // unset - defaults true) once the webhook fix is confirmed working.
  VIRTUAL_ACCOUNT_FUNDING_ENABLED: z
    .string()
    .default('true')
    .transform((value) => value.toLowerCase() !== 'false' && value !== '0'),

  ADMIN_SESSION_SECRET: z.string().min(16).default('dev-only-insecure-admin-secret-change-me'),

  // WhatsApp Cloud API (Meta Business Platform) - lets a user buy data by chatting
  // with our WhatsApp Business number instead of opening the app. Optional: if
  // WHATSAPP_TOKEN is unset, the webhook route still mounts but every call to Meta's
  // API will fail fast rather than silently do nothing - see whatsapp-session.service.ts.
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  // Chosen by us and entered into the Meta App Dashboard webhook config - proves the
  // GET verification handshake request actually came from Meta, not a random caller.
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  // Meta App Secret, used to verify the X-Hub-Signature-256 header on every inbound
  // POST the same way PAYSTACK_SECRET_KEY verifies x-paystack-signature above.
  WHATSAPP_APP_SECRET: z.string().optional(),

  // Encrypts NIN/BVN/names/DOB/phone and the generated slip PDFs stored in
  // Transaction.metadata.pii - see src/lib/pii-encryption.ts. Generate a real
  // one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  PII_ENCRYPTION_KEY: z.string().min(16).default('dev-only-insecure-pii-key-change-me'),
  // Kept only while legacy Supabase-issued tokens or legacy Storage files are
  // still in use. The application database itself is MySQL.
  SUPABASE_JWT_SECRET: z.string().optional(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default('user-deliveries')
});

// Parse environment variables with enhanced error handling
let env: z.infer<typeof EnvSchema>;

try {
  env = EnvSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('Ã¢Å“â€” Environment variable validation failed:');
    error.errors.forEach((err) => {
      const path = err.path.join('.');
      console.error(`  - ${path}: ${err.message}`);
    });
    console.error('\nÃ¢Å“â€” Please check your .env file or environment variables');
    process.exit(1);
  }
  throw error;
}

// Production security checks
if (env.NODE_ENV === 'production') {
  const securityIssues: string[] = [];

  if (env.ADMIN_SESSION_SECRET === 'dev-only-insecure-admin-secret-change-me') {
    securityIssues.push('ADMIN_SESSION_SECRET is still the default dev value');
  }

  if (env.AUTH_TOKEN_SECRET === 'dev-only-insecure-auth-token-secret-32') {
    securityIssues.push('AUTH_TOKEN_SECRET is still the default dev value');
  }

  if (env.PII_ENCRYPTION_KEY === 'dev-only-insecure-pii-key-change-me') {
    securityIssues.push(
      'PII_ENCRYPTION_KEY is still the default dev value - NIN/BVN data would be encrypted with a key ' +
        'published in this source file. Generate a real one (see the comment above its definition in env.ts).'
    );
  }

  if (securityIssues.length > 0) {
    console.error('Ã¢Å“â€” Production security violations detected:');
    securityIssues.forEach((issue) => {
      console.error(`  - ${issue}`);
    });
    console.error('\nÃ¢Å“â€” Set strong random secrets before running in production');
    process.exit(1);
  }

  console.log('Ã¢Å“â€œ All production security checks passed');
}

export { env };

