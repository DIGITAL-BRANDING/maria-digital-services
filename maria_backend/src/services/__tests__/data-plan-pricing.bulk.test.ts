import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findMany, update, transaction } = vi.hoisted(() => {
  const findMany = vi.fn();
  const update = vi.fn();
  const transaction = vi.fn(async (callback: (tx: { dataPlanPricing: { update: typeof update } }) => Promise<unknown>) =>
    callback({ dataPlanPricing: { update } })
  );
  return { findMany, update, transaction };
});

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    dataPlanPricing: { findMany },
    $transaction: transaction
  }
}));

const { dataPlanPricingService } = await import('../data-plan-pricing.service.js');

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([
    { id: 'plan-1', providerCostKobo: 10_000n },
    { id: 'plan-zero', providerCostKobo: 0n }
  ]);
});

describe('DataPlanPricingService.applyMarkup', () => {
  it('reprices matching rows in one transaction and skips zero-priced rows', async () => {
    const result = await dataPlanPricingService.applyMarkup({
      network: 'mtn',
      provider: 'alrahuz',
      markupPercent: 12.5,
      markupNaira: 0
    });

    expect(findMany).toHaveBeenCalledWith({ where: { network: 'MTN', provider: 'alrahuz' } });
    expect(transaction).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith({
      where: { id: 'plan-1' },
      data: { sellingPriceKobo: 11_300n }
    });
    expect(result).toEqual({ updated: 1, skipped: 1 });
  });

  it('rejects the whole batch when a transactional write fails', async () => {
    update.mockRejectedValueOnce(new Error('write failed'));

    await expect(
      dataPlanPricingService.applyMarkup({ markupPercent: 0, markupNaira: 1 })
    ).rejects.toThrow('write failed');
  });
});