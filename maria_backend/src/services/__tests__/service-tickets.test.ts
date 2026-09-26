import { describe, expect, it, vi } from 'vitest';

vi.mock('@prisma/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@prisma/client')>();
  const echoEnum = new Proxy({}, { get: (_target, prop) => prop });
  return { ...actual, TransactionStatus: echoEnum, TransactionType: echoEnum };
});

vi.mock('../../lib/prisma.js', async () => {
  const { createFakePrisma } = await import('../../test-utils/fake-prisma.js');
  const fake = createFakePrisma();
  return { prisma: fake.api };
});

const { prisma } = await import('../../lib/prisma.js');
const { listServiceTickets } = await import('../verification.service.js');

let counter = 0;
async function seedTicket(userId: string, service: string, status: 'PENDING' | 'SUCCESS' | 'FAILED' = 'PENDING') {
  counter += 1;
  await prisma.transaction.create({
    data: {
      id: `t-${counter}`,
      userId,
      type: 'IDENTITY_SERVICE_REQUEST',
      status,
      amountKobo: 50000n,
      balanceBeforeKobo: 100000n,
      balanceAfterKobo: 50000n,
      reference: `REF-${counter}`,
      description: service,
      metadata: { service, ticket_id: `TICKET-${counter}` }
    }
  });
}

describe('listServiceTickets', () => {
  it('returns only the requested single service, tagging each row with its service key', async () => {
    const userId = 'user-a';
    await seedTicket(userId, 'NIN_PERSONALIZATION');
    await seedTicket(userId, 'IPE_CLEARANCE');

    const result = await listServiceTickets(userId, 'IPE_CLEARANCE');

    expect(result).toHaveLength(1);
    expect(result[0].service).toBe('IPE_CLEARANCE');
  });

  it('combines several service keys into one list - this is how Validation shows all four detail types together', async () => {
    const userId = 'user-b';
    await seedTicket(userId, 'NIN_VALIDATION_NO_RECORD');
    await seedTicket(userId, 'NIN_VALIDATION_VNIN');
    await seedTicket(userId, 'NIN_PERSONALIZATION'); // a different service - must be excluded

    const result = await listServiceTickets(userId, ['NIN_VALIDATION_NO_RECORD', 'NIN_VALIDATION_UPDATE_RECORDS', 'NIN_VALIDATION_MODIFICATION', 'NIN_VALIDATION_VNIN']);

    expect(result.map((r) => r.service).sort()).toEqual(['NIN_VALIDATION_NO_RECORD', 'NIN_VALIDATION_VNIN'].sort());
  });

  it('never mixes tickets between users', async () => {
    await seedTicket('user-c', 'IPE_CLEARANCE');
    await seedTicket('user-d', 'IPE_CLEARANCE');

    const result = await listServiceTickets('user-c', 'IPE_CLEARANCE');
    expect(result).toHaveLength(1);
  });
});
