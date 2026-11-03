import { api, ApiError, REQUEST_INTERRUPTED, INTERRUPTED_MESSAGE, wasInterrupted } from './api';

export type SlipResultData = {
  user_data?: Record<string, unknown>;
  pdf_base64?: string;
  pdf_url?: string;
  document_url?: string;
  reference: string;
};

export type SlipOutcome =
  | { kind: 'success'; result: SlipResultData; message: string }
  /** Not confirmed yet - nothing was lost; the request is (or will be) in Recent requests. Do not resubmit. */
  | { kind: 'review'; message: string; reference?: string }
  | { kind: 'failed'; message: string };

type SubmitResponse = {
  status: boolean;
  pending?: boolean;
  processing?: boolean;
  message: string;
  data?: { reference: string; document_url?: string | null; user_data?: Record<string, unknown>; pdf_base64?: string; pdf_url?: string };
};
type StatusResponse = {
  status: boolean;
  state: 'processing' | 'review' | 'success' | 'failed';
  message?: string;
  data?: { reference: string; document_url?: string | null; user_data?: Record<string, unknown> | null; pdf_base64?: string | null; pdf_url?: string | null };
};

const POLL_FAST_MS = 1_500;
const POLL_SLOW_MS = 3_000;
const GIVE_UP_AFTER_MS = 4 * 60_000;
const MAX_CONSECUTIVE_POLL_ERRORS = 8;
const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * Submit-then-poll for slip purchases (NIN / BVN). The server debits the wallet
 * and answers within a second or two; the provider call finishes in the
 * background and this polls for the result. So the request that waits on the
 * provider is never an open HTTP call that a browser, proxy or mobile network
 * can cut off - and the lookup completes even if this tab is closed.
 *
 * Throws only when the submit itself was cut off before we learned the
 * reference (the caller keeps its Idempotency-Key so a retry replays it).
 */
export async function submitSlip(
  path: string,
  body: unknown,
  idempotencyKey: string,
  onProgress?: (elapsedSeconds: number) => void
): Promise<SlipOutcome> {
  let submitted: SubmitResponse;
  try {
    submitted = await api.post<SubmitResponse>(`${path}?async=1`, body, true, 30_000, idempotencyKey);
  } catch (error) {
    if (error instanceof ApiError || !(error instanceof Error)) throw error;
    // Cut off before we saw the answer: the debit may or may not have happened.
    throw new ApiError(INTERRUPTED_MESSAGE, 0, REQUEST_INTERRUPTED);
  }

  const reference = submitted.data?.reference;

  // Older/synchronous answer: the result is already final.
  if (!submitted.processing) {
    if (submitted.pending) return { kind: 'review', message: submitted.message, reference };
    if (!submitted.status) return { kind: 'failed', message: submitted.message };
    return { kind: 'success', message: submitted.message, result: toResult(submitted.data, reference) };
  }
  if (!reference) return { kind: 'review', message: 'Your request was accepted. Check Recent requests in a moment.' };

  const startedAt = Date.now();
  let consecutiveErrors = 0;
  for (;;) {
    const elapsed = Date.now() - startedAt;
    onProgress?.(Math.floor(elapsed / 1000));
    if (elapsed > GIVE_UP_AFTER_MS) {
      return { kind: 'review', reference, message: 'This is taking longer than usual. Your request is still being processed - it will appear under Recent requests when it is ready. Please do not submit it again.' };
    }
    await sleep(elapsed < 30_000 ? POLL_FAST_MS : POLL_SLOW_MS);
    try {
      const status = await api.get<StatusResponse>(`/verification/slip/${encodeURIComponent(reference)}`);
      consecutiveErrors = 0;
      if (status.state === 'processing') continue;
      if (status.state === 'success') return { kind: 'success', message: 'Verification successful', result: toResult(status.data, reference) };
      if (status.state === 'review') return { kind: 'review', reference, message: status.message ?? 'We are confirming this request with the provider.' };
      return { kind: 'failed', message: status.message ?? 'The request could not be completed. Your payment has been refunded.' };
    } catch (error) {
      // A definitive "no such request" will not fix itself; a blip on a mobile network will.
      if (error instanceof ApiError && error.status === 404) return { kind: 'failed', message: error.message };
      consecutiveErrors += 1;
      if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
        return { kind: 'review', reference, message: 'We lost connection while checking your request. It is still being processed - check Recent requests shortly. Please do not submit it again.' };
      }
    }
  }
}

function toResult(data: SubmitResponse['data'] | StatusResponse['data'], reference?: string): SlipResultData {
  return {
    user_data: data?.user_data ?? undefined,
    pdf_base64: data?.pdf_base64 ?? undefined,
    pdf_url: data?.pdf_url ?? undefined,
    document_url: data?.document_url ?? undefined,
    reference: data?.reference ?? reference ?? ''
  };
}

type KeyStore = { current: (fingerprint: string) => string; reset: () => void };

/**
 * The whole submit -> wait -> show-outcome sequence every slip page shares, so
 * they all behave the same way: a live "verifying" message, the result as soon
 * as it is ready, and - when we could not confirm an outcome - a clear
 * "do not resubmit" message plus polling of Recent requests, never a bare error.
 */
export async function runSlipFlow(opts: {
  path: string;
  body: unknown;
  fingerprint: string;
  idempotency: KeyStore;
  setMessage: (message: string) => void;
  setResult: (result: SlipResultData) => void;
  /** Start polling Recent requests (outcome unknown). */
  watch: () => void;
}) {
  const { idempotency, setMessage } = opts;
  try {
    const outcome = await submitSlip(opts.path, opts.body, idempotency.current(opts.fingerprint), (seconds) =>
      setMessage(seconds < 4 ? 'Verifying with the provider…' : `Verifying with the provider… ${seconds}s. Please keep this page open.`)
    );
    if (outcome.kind === 'success') {
      idempotency.reset();
      opts.setResult(outcome.result);
      setMessage(outcome.message || 'Done - your document is ready below.');
    } else if (outcome.kind === 'review') {
      // Keep the key: resubmitting the same details replays this request instead of charging again.
      opts.watch();
      setMessage(outcome.reference ? `${outcome.message} Reference: ${outcome.reference}.` : outcome.message);
    } else {
      idempotency.reset();
      setMessage(outcome.message);
    }
  } catch (error) {
    if (wasInterrupted(error)) opts.watch();
    else idempotency.reset();
    setMessage(error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Request failed.');
  }
}
