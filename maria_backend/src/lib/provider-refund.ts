/**
 * Recognising when an upstream provider has REFUNDED a request, as opposed to
 * merely failing it.
 *
 * The distinction matters because the two cases are billed differently on our
 * side. A plain "failed" ticket is refunded to the customer for every async
 * service except IPE Clearance (K-Tech states IPE is not refundable, so we do
 * not eat that cost - see settleAsyncTransaction in verification.service.ts).
 * But when the provider itself hands the money back, there is no cost left to
 * protect and the customer must be refunded too, whatever the service was and
 * whatever state we had already recorded the ticket in.
 *
 * Deliberately conservative: only an explicit refund/reversal status, an event
 * name that ends in "refund(ed)", or a literal `refunded: true` counts. A
 * status we do not recognise is NOT a refund signal, so an unfamiliar word can
 * never move money.
 */

const REFUND_STATUSES = new Set([
  'refunded',
  'refund',
  'reversed',
  'refund_completed',
  'refund_successful',
  'refunded_to_wallet'
]);

// Matches e.g. "transaction.refunded", "wallet_refund", "ticket-refund" but not
// "refund_failed" / "refund_pending" (those end in a different word).
const REFUND_EVENT = /(^|[._\-\s])refund(ed)?$/i;

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null;
}

function signalsRefund(source: unknown): boolean {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
  const obj = source as Record<string, unknown>;
  const nested =
    obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data) ? (obj.data as Record<string, unknown>) : null;

  for (const holder of nested ? [obj, nested] : [obj]) {
    const status = asString(holder.status)?.toLowerCase();
    if (status && REFUND_STATUSES.has(status)) return true;

    for (const key of ['event', 'event_type']) {
      const event = asString(holder[key]);
      if (event && REFUND_EVENT.test(event)) return true;
    }

    if (holder.refunded === true) return true;
  }
  return false;
}

/**
 * True when any of the given provider payloads (the raw webhook body, the raw
 * status-check response, the merged response object) says the provider refunded
 * this request. Accepts both the flat shape ({ status }) and the enveloped one
 * ({ data: { status } }) since K-Tech and Techhub differ.
 */
export function providerSignalsRefund(...sources: unknown[]): boolean {
  return sources.some(signalsRefund);
}
