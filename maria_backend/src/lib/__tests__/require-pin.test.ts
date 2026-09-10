import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

/**
 * Tests requirePinConfirmation - the fix for the vulnerability where every
 * money-moving endpoint (data/airtime/result-pin/verification purchases)
 * relied ENTIRELY on the client showing a PIN dialog before calling them,
 * with nothing server-side actually requiring or checking a PIN. See the
 * doc-comment on requirePinConfirmation in require-pin.ts for the full
 * story - this file just proves the fix's two failure modes are handled
 * (wrong PIN, locked account) and that a correct PIN passes through
 * cleanly to the same verifyPin() used everywhere else in the app.
 */

const verifyPin = vi.fn();
vi.mock('../../services/wallet.service.js', () => ({ verifyPin: (...args: unknown[]) => verifyPin(...args) }));

const { requirePinConfirmation, pinField } = await import('../require-pin.js');

describe('requirePinConfirmation', () => {
  it('delegates straight to verifyPin with the same userId/pin, and resolves on success', async () => {
    verifyPin.mockResolvedValue(true);

    await expect(requirePinConfirmation('user-1', '1234')).resolves.toBeUndefined();
    expect(verifyPin).toHaveBeenCalledWith('user-1', '1234');
  });

  it('propagates verifyPin\'s INVALID_PIN error untouched, so a purchase never proceeds on a wrong PIN', async () => {
    const error = Object.assign(new Error('Invalid transaction PIN'), { statusCode: 401, code: 'INVALID_PIN' });
    verifyPin.mockRejectedValue(error);

    await expect(requirePinConfirmation('user-1', '0000')).rejects.toMatchObject({ code: 'INVALID_PIN' });
  });

  it('propagates verifyPin\'s PIN_LOCKED error - a locked account cannot be worked around by calling a purchase endpoint directly', async () => {
    const error = Object.assign(new Error('PIN is temporarily locked'), { statusCode: 423, code: 'PIN_LOCKED' });
    verifyPin.mockRejectedValue(error);

    await expect(requirePinConfirmation('user-1', '1234')).rejects.toMatchObject({ code: 'PIN_LOCKED' });
  });

  it('propagates PIN_NOT_SET for a user who never configured a transaction PIN', async () => {
    const error = Object.assign(new Error('Transaction PIN has not been set'), { statusCode: 400, code: 'PIN_NOT_SET' });
    verifyPin.mockRejectedValue(error);

    await expect(requirePinConfirmation('user-1', '1234')).rejects.toMatchObject({ code: 'PIN_NOT_SET' });
  });
});

describe('pinField', () => {
  it('rejects a body with no pin at all', () => {
    const schema = z.object({ amount: z.number(), ...pinField });
    const result = schema.safeParse({ amount: 100 });
    expect(result.success).toBe(false);
  });

  it('rejects a pin that is not exactly 4 digits', () => {
    const schema = z.object({ ...pinField });
    expect(schema.safeParse({ pin: '123' }).success).toBe(false);
    expect(schema.safeParse({ pin: '12345' }).success).toBe(false);
  });

  it('accepts a 4-character pin', () => {
    const schema = z.object({ ...pinField });
    expect(schema.safeParse({ pin: '1234' }).success).toBe(true);
  });

  it('trims surrounding whitespace before length-checking', () => {
    const schema = z.object({ ...pinField });
    const result = schema.safeParse({ pin: ' 1234 ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.pin).toBe('1234');
  });
});
