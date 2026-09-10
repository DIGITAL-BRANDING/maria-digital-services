/**
 * The canonical service contract for conversational clients.
 *
 * This is deliberately a rules engine, not an LLM: a client may only collect
 * listed fields and may only call the declared endpoint after its normal PIN
 * confirmation. New services are added here before a UI exposes them.
 *
 * Sync workflows (`purchaseEndpoint` set) return a result immediately.
 * Async workflows (`submitEndpoint`/`statusEndpoint` set, `async: true`)
 * submit a ticket and must be polled - the client shows "processing" and
 * checks `statusEndpoint` (with `:ticketId` substituted) until it resolves.
 *
 * `priceMode` tells the client which price endpoint shape to read:
 *  - 'result': GET the workflow's own `:examType`-templated price endpoint,
 *    which returns a single { unitPrice } object.
 *  - 'verification': GET /api/verification/prices (one flat list of
 *    { service, unitPrice } for every verification service) and find the
 *    row whose `service` matches `priceServiceKeyTemplate` with any `{field}`
 *    placeholders substituted by the collected field values. For a field
 *    with an entry in `priceValueMap`, the substituted segment is
 *    `priceValueMap[field][collectedValue]` (falling back to the raw
 *    value upper-cased if that exact value isn't in the map); a field with
 *    no `priceValueMap` entry at all is just upper-cased directly, as
 *    before. `priceValueMap` only needs to be set for fields whose values
 *    don't upper-case into their matching service-key suffix cleanly (e.g.
 *    NIN Validation's 'bank_validation' -> 'BANK', not 'BANK_VALIDATION';
 *    'v.nin_validation' -> 'VNIN', not 'V.NIN_VALIDATION').
 *  - 'none': no separate price call - workflow-specific screens quote inline
 *    or the price is fixed and shown in the field label.
 */
export type AssistantFieldInput =
  | 'phone'
  | 'network'
  | 'plan'
  | 'amount'
  | 'meter'
  | 'smartcard'
  | 'text'
  | 'nin'
  | 'bvn'
  | 'email'
  | 'quantity'
  | 'select';

export type AssistantFieldOption = { value: string; label: string; labelHa: string };

export type AssistantField = {
  key: string;
  label: string;
  labelHa: string;
  required: boolean;
  input: AssistantFieldInput;
  /** Required when input === 'select'. */
  options?: AssistantFieldOption[];
};

export type AssistantWorkflow = {
  id: string;
  title: string;
  titleHa: string;
  intents: string[];
  fields: AssistantField[];
  /** Sync purchase - may contain a `:fieldKey` path placeholder. */
  purchaseEndpoint?: string;
  /** Async submit - starts a ticket. */
  submitEndpoint?: string;
  /** Async status poll - contains `:ticketId`. */
  statusEndpoint?: string;
  async: boolean;
  priceMode: 'result' | 'verification' | 'none';
  /** For priceMode 'verification': e.g. "NIN_SLIP_{tier}". */
  priceServiceKeyTemplate?: string;
  /** See priceMode's 'verification' case above. Keyed by field key, then by that field's collected value. */
  priceValueMap?: Record<string, Record<string, string>>;
  status: 'active' | 'guided';
};

const ninField: AssistantField = { key: 'nin', label: '11-digit NIN', labelHa: 'Lambar NIN mai lamba 11', required: true, input: 'nin' };
const bvnField: AssistantField = { key: 'bvn', label: '11-digit BVN', labelHa: 'Lambar BVN mai lamba 11', required: true, input: 'bvn' };

const ninSlipTierField: AssistantField = {
  key: 'tier', label: 'Slip type', labelHa: 'Nau’in slip', required: true, input: 'select',
  options: [
    { value: 'premium', label: 'Premium', labelHa: 'Premium' },
    { value: 'standard', label: 'Standard', labelHa: 'Standard' },
    { value: 'regular', label: 'Regular', labelHa: 'Regular' },
    { value: 'vnin', label: 'VNIN', labelHa: 'VNIN' }
  ]
};

const ninPhoneSlipTierField: AssistantField = {
  key: 'tier', label: 'Slip type', labelHa: 'Nau’in slip', required: true, input: 'select',
  options: [
    { value: 'premium', label: 'Premium', labelHa: 'Premium' },
    { value: 'standard', label: 'Standard', labelHa: 'Standard' },
    { value: 'regular', label: 'Regular', labelHa: 'Regular' }
  ]
};

const bvnSlipTierField: AssistantField = {
  key: 'tier', label: 'Slip type', labelHa: 'Nau’in slip', required: true, input: 'select',
  options: [
    { value: 'premium', label: 'Premium', labelHa: 'Premium' },
    { value: 'standard', label: 'Standard', labelHa: 'Standard' }
  ]
};

export const assistantWorkflows: AssistantWorkflow[] = [
  { id: 'data', title: 'Buy Data', titleHa: 'Siyan Data', intents: ['data', 'bundle', 'sayi min data', 'siyamin data'], fields: [{ key: 'network', label: 'Network', labelHa: 'Network', required: true, input: 'network' }, { key: 'data_type', label: 'Data type', labelHa: 'Nau’in Data', required: true, input: 'text' }, { key: 'phone', label: 'Phone number', labelHa: 'Lambar waya', required: true, input: 'phone' }, { key: 'plan_id', label: 'Data plan', labelHa: 'Data plan', required: true, input: 'plan' }], purchaseEndpoint: '/api/data/purchase', async: false, priceMode: 'none', status: 'active' },
  { id: 'airtime', title: 'Buy Airtime', titleHa: 'Siyan Airtime', intents: ['airtime', 'top up', 'topup', 'recharge', 'sayi min airtime'], fields: [{ key: 'network', label: 'Network', labelHa: 'Network', required: true, input: 'network' }, { key: 'phone', label: 'Phone number', labelHa: 'Lambar waya', required: true, input: 'phone' }, { key: 'amount', label: 'Amount', labelHa: 'Kuɗi', required: true, input: 'amount' }], purchaseEndpoint: '/api/airtime/purchase', async: false, priceMode: 'none', status: 'active' },
  { id: 'electricity', title: 'Buy Electricity', titleHa: 'Siyan Wutar Lantarki', intents: ['electricity', 'light token', 'wuta', 'lantarki'], fields: [{ key: 'provider', label: 'Distribution company', labelHa: 'Kamfanin wuta', required: true, input: 'text' }, { key: 'meter_number', label: 'Meter number', labelHa: 'Lambar meter', required: true, input: 'meter' }, { key: 'amount', label: 'Amount', labelHa: 'Kuɗi', required: true, input: 'amount' }], async: false, priceMode: 'none', status: 'guided' },
  { id: 'cable', title: 'Cable TV', titleHa: 'Biyan Cable TV', intents: ['cable', 'dstv', 'gotv', 'startimes'], fields: [{ key: 'provider', label: 'Provider', labelHa: 'Provider', required: true, input: 'text' }, { key: 'smartcard', label: 'Smartcard number', labelHa: 'Lambar smartcard', required: true, input: 'smartcard' }, { key: 'plan', label: 'Package', labelHa: 'Package', required: true, input: 'plan' }], async: false, priceMode: 'none', status: 'guided' },

  {
    id: 'result_pin', title: 'Result Checker PIN', titleHa: 'Result Checker PIN',
    intents: ['waec', 'neco', 'nabteb', 'result pin', 'result checker', 'scratch card'],
    fields: [
      { key: 'examType', label: 'Exam', labelHa: 'Jarabawa', required: true, input: 'select', options: [
        { value: 'WAEC', label: 'WAEC', labelHa: 'WAEC' },
        { value: 'NECO', label: 'NECO', labelHa: 'NECO' },
        { value: 'NABTEB', label: 'NABTEB', labelHa: 'NABTEB' }
      ] },
      { key: 'quantity', label: 'How many PINs (1-10)', labelHa: 'Nawa PIN (1-10)', required: true, input: 'quantity' }
    ],
    purchaseEndpoint: '/api/result/:examType/pin', async: false, priceMode: 'result', status: 'active'
  },

  // ── More specific verification intents first, so a bare "nin"/"bvn"
  // mention only ever falls through to the plain slip-lookup catch-alls
  // (nin_by_nin / bvn_slip) at the bottom of this list. ────────────────
  {
    id: 'nin_by_phone', title: 'NIN Slip (by Phone)', titleHa: 'NIN Slip (ta Waya)',
    intents: ['nin by phone', 'nin with phone', 'find nin with phone number'],
    fields: [{ key: 'phone', label: 'The 11-digit phone number linked to the NIN', labelHa: 'Lambar waya mai lamba 11 da ke da alaƙa da NIN', required: true, input: 'phone' }, ninPhoneSlipTierField],
    purchaseEndpoint: '/api/verification/nin/by-phone', async: false, priceMode: 'verification', priceServiceKeyTemplate: 'NIN_PHONE_SLIP_{tier}', status: 'active'
  },
  {
    id: 'nin_by_demographic', title: 'NIN Slip (by Details)', titleHa: 'NIN Slip (ta Bayanai)',
    intents: ['nin by demographic', 'nin by name', 'nin without number', 'find nin by name'],
    fields: [
      { key: 'firstname', label: 'First name', labelHa: 'Sunan farko', required: true, input: 'text' },
      { key: 'lastname', label: 'Last name', labelHa: 'Sunan mahaifi', required: true, input: 'text' },
      { key: 'dob', label: 'Date of birth (YYYY-MM-DD)', labelHa: 'Ranar haihuwa (YYYY-MM-DD)', required: true, input: 'text' },
      { key: 'gender', label: 'Gender (MALE or FEMALE, optional)', labelHa: 'Jinsi (MALE ko FEMALE, ba tilas ba)', required: false, input: 'select', options: [{ value: 'MALE', label: 'Male', labelHa: 'Namiji' }, { value: 'FEMALE', label: 'Female', labelHa: 'Mace' }] }
    ],
    purchaseEndpoint: '/api/verification/nin/by-demographic', async: false, priceMode: 'verification', priceServiceKeyTemplate: 'NIN_DEMOGRAPHIC', status: 'active'
  },
  {
    id: 'nin_delinking', title: 'NIN Delinking', titleHa: 'NIN Delinking',
    intents: ['delink', 'delinking', 'unlink my nin', 'unlink sim from nin'],
    fields: [ninField, { key: 'email', label: 'Email address for the result', labelHa: 'Adireshin email don sakamako', required: true, input: 'email' }],
    submitEndpoint: '/api/verification/delinking', statusEndpoint: '/api/verification/delinking/:ticketId', async: true, priceMode: 'verification', priceServiceKeyTemplate: 'NIN_DELINKING', status: 'active'
  },
  {
    id: 'nin_validation', title: 'NIN Validation', titleHa: 'NIN Validation',
    intents: ['nin validation', 'validate my nin', 'nin no record', 'nin modification', 'nin update'],
    fields: [ninField, { key: 'validation_type', label: 'What kind of validation (optional)', labelHa: 'Wanne irin validation (ba tilas ba)', required: false, input: 'select', options: [
      { value: 'nin_validation', label: 'General validation', labelHa: 'Babban validation' },
      { value: 'no_record', label: 'No record found', labelHa: 'Ba a samu record ba' },
      { value: 'sim', label: 'SIM issue', labelHa: 'Matsalar SIM' },
      { value: 'modification', label: 'Modification', labelHa: 'Modification' },
      { value: 'photo_error', label: 'Photo error', labelHa: 'Kuskuren hoto' },
      { value: 'bank_validation', label: 'Bank validation', labelHa: 'Bank validation' },
      { value: 'v.nin_validation', label: 'vNIN validation', labelHa: 'vNIN validation' },
      { value: 'update_records', label: 'Update records', labelHa: 'Update records' }
    ] }],
    submitEndpoint: '/api/verification/nin-validation', statusEndpoint: '/api/verification/nin-validation/:ticketId', async: true, priceMode: 'verification',
    // NIN Validation used to be one flat-priced service ('NIN_VALIDATION')
    // regardless of validation_type - it's now 8 separately-priced services
    // (NIN_VALIDATION_GENERAL/NO_RECORD/SIM/BANK/UPDATE_RECORDS/MODIFICATION/
    // PHOTO_ERROR/VNIN - see verification.service.ts). priceValueMap gives
    // the client the exact suffix for each validation_type value, since a
    // naive uppercase doesn't work for two of them ('bank_validation' would
    // uppercase to 'BANK_VALIDATION' not 'BANK'; 'v.nin_validation' isn't
    // even a valid key segment as-is). Falls back to 'GENERAL' when
    // validation_type is omitted (it's an optional field), matching
    // Techhub's own default.
    priceServiceKeyTemplate: 'NIN_VALIDATION_{validation_type}',
    priceValueMap: {
      validation_type: {
        // Empty string is the sentinel a client should substitute when this
        // optional field was skipped entirely (not collected at all), not
        // just when it holds an unrecognized value - same default Techhub
        // itself applies when validation_type is omitted from the request.
        '': 'GENERAL',
        nin_validation: 'GENERAL',
        no_record: 'NO_RECORD',
        sim: 'SIM',
        bank_validation: 'BANK',
        update_records: 'UPDATE_RECORDS',
        modification: 'MODIFICATION',
        photo_error: 'PHOTO_ERROR',
        'v.nin_validation': 'VNIN'
      }
    },
    status: 'active'
  },
  {
    id: 'nin_personalization', title: 'NIN Personalization', titleHa: 'NIN Personalization',
    intents: ['personalization', 'personalisation', 'nin card personalization'],
    fields: [{ key: 'tracking_id', label: 'Tracking ID', labelHa: 'Tracking ID', required: true, input: 'text' }],
    submitEndpoint: '/api/verification/personalization', statusEndpoint: '/api/verification/personalization/:ticketId', async: true, priceMode: 'verification', priceServiceKeyTemplate: 'NIN_PERSONALIZATION', status: 'active'
  },
  {
    id: 'bvn_retrieval', title: 'BVN Retrieval', titleHa: 'BVN Retrieval',
    intents: ['bvn retrieval', 'recover my bvn', 'find my bvn', 'i forgot my bvn'],
    fields: [
      { key: 'first_name', label: 'First name', labelHa: 'Sunan farko', required: true, input: 'text' },
      { key: 'last_name', label: 'Last name', labelHa: 'Sunan mahaifi', required: true, input: 'text' },
      { key: 'phone_number', label: 'Phone number linked to the BVN', labelHa: 'Lambar waya da ke da alaƙa da BVN', required: true, input: 'phone' }
    ],
    submitEndpoint: '/api/verification/bvn-retrieval', statusEndpoint: '/api/verification/bvn-retrieval/:ticketId', async: true, priceMode: 'verification', priceServiceKeyTemplate: 'BVN_RETRIEVAL', status: 'active'
  },
  {
    id: 'ipe_clearance', title: 'IPE Clearance', titleHa: 'IPE Clearance',
    intents: ['ipe clearance', 'ipe'],
    fields: [{ key: 'tracking_id', label: 'Tracking ID', labelHa: 'Tracking ID', required: true, input: 'text' }],
    submitEndpoint: '/api/verification/ipe-clearance', statusEndpoint: '/api/verification/ipe-clearance/:ticketId', async: true, priceMode: 'verification', priceServiceKeyTemplate: 'IPE_CLEARANCE', status: 'active'
  },

  {
    id: 'nin_by_nin', title: 'NIN Slip (by NIN)', titleHa: 'NIN Slip (ta NIN)',
    intents: ['nin slip', 'fetch nin', 'check my nin', 'nin'],
    fields: [ninField, ninSlipTierField],
    purchaseEndpoint: '/api/verification/nin/by-nin', async: false, priceMode: 'verification', priceServiceKeyTemplate: 'NIN_SLIP_{tier}', status: 'active'
  },
  {
    id: 'bvn_slip', title: 'BVN Slip', titleHa: 'BVN Slip',
    intents: ['bvn slip', 'fetch bvn', 'check my bvn', 'bvn'],
    fields: [bvnField, bvnSlipTierField],
    purchaseEndpoint: '/api/verification/bvn/slip', async: false, priceMode: 'verification', priceServiceKeyTemplate: 'BVN_SLIP_{tier}', status: 'active'
  }
];

/**
 * Whether `phrase` appears in `normalized` as a whole word/phrase, not
 * merely as a fragment buried inside some longer, unrelated word.
 *
 * The workflow matching below used to do a plain `normalized.includes(intent)`,
 * which let short intent triggers misfire constantly - 'nin' (the NIN slip
 * lookup trigger) matched inside the ordinary English word "training";
 * 'data' matched inside "database"; and worst of all, ipe_clearance's
 * intent list used to write its trigger as 'ipe ' (with a literal trailing
 * space) as an incomplete hand-rolled boundary workaround - which still
 * matched inside "swipe " or "recipe " (both contain the literal substring
 * "ipe "), while ALSO failing to match "ipe" typed as the very last word of
 * a message with nothing after it (no trailing space to match against).
 *
 * Uses Unicode-aware boundaries (\p{L}/\p{N} lookaround) rather than \b,
 * since \b only understands ASCII word characters and would misbehave
 * around Hausa letters like ƙ/ɗ/ɓ that may appear in future intent phrases.
 */
export function phraseMatches(normalized: string, phrase: string): boolean {
  const trimmed = phrase.trim();
  if (!trimmed) return false;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u');
  return regex.test(normalized);
}

export function parseAssistantIntent(message: string) {
  const normalized = message.toLowerCase().replace(/\s+/g, ' ').trim();
  let workflow = assistantWorkflows.find((item) =>
    item.intents.some((intent) => phraseMatches(normalized, intent))
  );
  // Restrict separators inside a phone number to spaces/hyphens. Using \D*
  // here would let a number such as "500 zuwa 080..." begin at the zero in
  // 500 and swallow the recipient number as one malformed phone.
  const phoneMatch = normalized.match(/(?<!\d)(?:(?:\+234|234)(?:[\s-]*\d){10}|0(?:[\s-]*\d){10})(?!\d)/);
  const digits = phoneMatch?.[0].replace(/\D/g, '');
  const phone = digits?.startsWith('234') ? `0${digits.slice(3)}` : digits;
  const network = /\bmtn\b/.test(normalized) ? 'MTN' : /\bairtel\b/.test(normalized) ? 'AIRTEL' : /\bglo\b/.test(normalized) ? 'GLO' : /(?:9mobile|nine mobile|etisalat)/.test(normalized) ? '9MOBILE' : undefined;
  const dataSize = normalized.match(/\b\d+(?:\.\d+)?\s*(?:gb|mb)\b/i)?.[0].replace(/\s+/g, '').toUpperCase();
  const dataType = /\bdata\s*coupon\b|\bcoupon\b/.test(normalized)
    ? 'DATA COUPON'
    : /\bcorporate\b/.test(normalized)
      ? 'CORPORATE'
      : /\bdata\s*share\b|\bshare\b/.test(normalized)
        ? 'DATA SHARE'
        : /\bgifting\b|\bgift\b/.test(normalized)
          ? 'GIFTING'
          : /\bsme\s*2\b|\bsme2\b/.test(normalized)
            ? 'SME2'
            : /\bsme\b/.test(normalized)
              ? 'SME'
              : undefined;
  // A size such as 1GB is an unambiguous data request even when the customer
  // uses only Hausa/English purchase words and never says the word "data".
  if (!workflow && dataSize) workflow = assistantWorkflows.find((item) => item.id === 'data');
  // Remove the recipient first: otherwise the first three digits of 080... can
  // accidentally be interpreted as an airtime amount.
  const withoutPhone = phoneMatch ? normalized.replace(phoneMatch[0], ' ') : normalized;
  const amountMatch = withoutPhone.match(/(?:₦|naira|kudi|kuɗi|amount)\s*(\d{2,6})(?:\.00)?\b|\b(\d{2,6})(?:\.00)?\b/i);
  const amount = amountMatch ? Number(amountMatch[1] ?? amountMatch[2]) : undefined;
  // Only data/airtime pre-fill fields from the free-text message - the
  // verification/result workflows below ask for each field one at a time
  // instead, since an 11-digit NIN/BVN/phone can't be told apart by regex
  // alone; the field-collection loop already knows which one it's asking for.
  const prefillable = workflow?.id === 'data' || workflow?.id === 'airtime';
  return {
    workflow: workflow?.id,
    fields: prefillable
      ? { ...(network ? { network } : {}), ...(dataType ? { data_type: dataType } : {}), ...(phone?.length === 11 ? { phone } : {}), ...(dataSize ? { data_size: dataSize } : {}), ...(amount ? { amount } : {}) }
      : {}
  };
}
