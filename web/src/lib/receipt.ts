import { api } from './api';

type TxSummary = { id: string; reference: string };

/**
 * Most purchase endpoints (/data/purchase, /airtime/purchase, etc.) only ever
 * returned `{ status, message }` - no transaction id - so there was nothing
 * for a "View Receipt" button to link to. Rather than changing every one of
 * those endpoints, this leans on GET /transactions already being ordered
 * newest-first: right after a purchase call resolves, the transaction it
 * created is /transactions data[0]. Safe because the purchase endpoint
 * creates the Transaction row synchronously before responding - there's no
 * window for another one to land in between on the same account.
 */
export async function findLatestTransactionId(): Promise<string | null> {
  try {
    const res = await api.get<{ status: boolean; data: TxSummary[] }>('/transactions');
    return res.data?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Same idea, but for flows that DO know the exact reference already (wallet
 * funding via Paystack callback, which gets it from the redirect's ?reference=)
 * - matching on that is more precise than "just take the newest one".
 */
export async function findTransactionIdByReference(reference: string): Promise<string | null> {
  try {
    const res = await api.get<{ status: boolean; data: TxSummary[] }>('/transactions');
    return res.data?.find((t) => t.reference === reference)?.id ?? null;
  } catch {
    return null;
  }
}
