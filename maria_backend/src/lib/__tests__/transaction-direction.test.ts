import { describe, expect, it } from 'vitest';
import { isCreditType, transactionDirection } from '../transaction-direction.js';

describe('transactionDirection', () => {
  it('treats REFUND as a credit (was rendered as a debit before)', () => {
    expect(transactionDirection('REFUND')).toBe('credit');
  });

  it.each(['WALLET_FUNDING', 'REFERRAL_COMMISSION', 'COUPON_REDEMPTION'])('%s is a credit', (type) => {
    expect(transactionDirection(type)).toBe('credit');
  });

  it.each(['NIN_VERIFICATION', 'DATA_PURCHASE', 'AIRTIME_PURCHASE', 'WALLET_FUNDING_FEE', 'IDENTITY_SERVICE_REQUEST'])(
    '%s is a debit',
    (type) => {
      expect(transactionDirection(type)).toBe('debit');
    }
  );

  it('reads MANUAL_ADJUSTMENT direction from metadata', () => {
    expect(transactionDirection('MANUAL_ADJUSTMENT', { direction: 'debit' })).toBe('debit');
    expect(transactionDirection('MANUAL_ADJUSTMENT', { direction: 'credit' })).toBe('credit');
    expect(transactionDirection('MANUAL_ADJUSTMENT', null)).toBe('credit');
  });

  it('isCreditType mirrors direction', () => {
    expect(isCreditType('REFUND')).toBe(true);
    expect(isCreditType('DATA_PURCHASE')).toBe(false);
  });
});
