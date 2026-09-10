/**
 * The common shape every provider integration (provider.service.ts /
 * Alrahuz, bilalsadasub.service.ts) normalizes its raw HTTP response into.
 * processProviderPurchase() in vtu.routes.ts, and the purchase flows in
 * result.routes.ts/cable.routes.ts/electricity.routes.ts, are written
 * against this shape only - never against a specific provider's raw
 * response fields - so switching PricingSettings.dataAirtimeProvider (or
 * resultPinProvider) between 'alrahuz' and 'bilalsadasub' needs no route
 * changes at all.
 */
export type NormalizedProviderResponse = {
  status: boolean;
  providerRef?: string;
  message?: string;
  /** Actual cost in kobo, when the provider's response reveals it (e.g. a
   *  balance_before/balance_after delta). Undefined means "unknown", not
   *  "free" - see the identical note on Transaction.costKobo. */
  costKobo?: bigint;
  /**
   * True when the provider explicitly reported an in-between state - not a
   * confirmed success, but not a confirmed failure either (BilalSadaSub's
   * "process" status is the only source of this today; Alrahuz's
   * provider.service.ts never sets it, its normalize() only ever produces a
   * clean true/false). `status` stays `false` whenever `pending` is `true`,
   * so any caller that only checks `if (provider.status)` still treats it as
   * "not yet successful" and does nothing destructive - but a caller that
   * checks `pending` first can route to manual reconciliation
   * (provider-reconciliation.service.ts) instead of immediately refunding a
   * purchase the provider might still fulfil. See the doc-comment on
   * normalize() in bilalsadasub.service.ts for why an immediate refund here
   * would be wrong.
   */
  pending?: boolean;
};

export type NormalizedResultPinResponse = NormalizedProviderResponse & {
  pin?: string;
  pins?: string[];
  serial?: string;
  raw?: unknown;
};
