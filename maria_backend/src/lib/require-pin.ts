import { z } from 'zod';
import { verifyPin } from '../services/wallet.service.js';

/**
 * The REAL authorization boundary for every money-moving purchase endpoint
 * (data, airtime, result pins, NIN/BVN verification, etc).
 *
 * Before this existed, PinConfirmDialog.tsx / pin_confirmation_sheet.dart
 * were the ONLY thing standing between a request and a debit - they call
 * POST /user/pin/verify, which genuinely checks the PIN against the
 * database, but that check was never linked to the purchase call that
 * followed it. Nothing stopped a request from skipping the dialog
 * entirely and hitting e.g. POST /data/purchase directly with a valid
 * auth token and no PIN at all - the client-side dialog was UX, not
 * security. Every purchase route must now parse `pin` with `pinField`
 * below and call this function BEFORE spending anything.
 *
 * Reuses verifyPin()'s existing rolling-window lockout (5 wrong PINs locks
 * for 30 minutes, same counter POST /user/pin/verify already uses) - a
 * wrong PIN submitted straight to a purchase endpoint counts against the
 * same lockout as one submitted through the dialog, exactly as it should.
 */
export async function requirePinConfirmation(userId: string, pin: string): Promise<void> {
  await verifyPin(userId, pin);
}

/** Spread into every money-moving endpoint's z.object({ ... }) body schema. */
export const pinField = {
  pin: z.string().trim().length(4, 'A valid 4-digit transaction PIN is required')
};
