import { describe, expect, it } from 'vitest';
import { bankKeyFor, serviceMatchesBankKeys } from '../bvn-modification-banks.js';

describe('bankKeyFor', () => {
  it('normalises bank names into service-key segments', () => {
    expect(bankKeyFor('Access Bank')).toBe('ACCESS_BANK');
    expect(bankKeyFor('Micro Finance Bank')).toBe('MICRO_FINANCE_BANK');
    expect(bankKeyFor('NIBSS')).toBe('NIBSS');
    expect(bankKeyFor(' First  Bank ')).toBe('FIRST_BANK');
  });
});

describe('serviceMatchesBankKeys', () => {
  const access = 'BVN_MODIFICATION_UPDATE_NAME_BANK_ACCESS_BANK';
  const first = 'BVN_MODIFICATION_UPDATE_NAME_BANK_FIRST_BANK';
  const agency = 'BVN_MODIFICATION_UPDATE_NAME_AGENCY';
  const legacyBank = 'BVN_MODIFICATION_UPDATE_NAME_BANK';

  it('matches every bank row when no banks are specified', () => {
    expect(serviceMatchesBankKeys(access)).toBe(true);
    expect(serviceMatchesBankKeys(first, [])).toBe(true);
  });

  it('never matches agency, legacy un-suffixed, or unrelated services', () => {
    expect(serviceMatchesBankKeys(agency)).toBe(false);
    expect(serviceMatchesBankKeys(legacyBank)).toBe(false);
    expect(serviceMatchesBankKeys('NIN_SLIP_BANK_ACCESS_BANK')).toBe(false);
  });

  it('limits to the requested banks, so one bank can be left out of a bulk reprice', () => {
    const everyoneButAccess = ['FIRST_BANK', 'NIBSS'];
    expect(serviceMatchesBankKeys(access, everyoneButAccess)).toBe(false);
    expect(serviceMatchesBankKeys(first, everyoneButAccess)).toBe(true);
    expect(serviceMatchesBankKeys(access, ['ACCESS_BANK'])).toBe(true);
    expect(serviceMatchesBankKeys(first, ['ACCESS_BANK'])).toBe(false);
  });
});
