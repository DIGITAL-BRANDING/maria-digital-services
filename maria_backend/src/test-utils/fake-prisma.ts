/**
 * A minimal in-memory stand-in for the Prisma client, covering only the
 * methods wallet.service.ts (and friends) actually call. This is NOT a
 * general-purpose Prisma mock - it exists so wallet debit/refund/idempotency
 * logic can be unit-tested without a real Postgres database, which this
 * environment doesn't have wired up.
 *
 * It deliberately re-implements the two "conditional update" patterns
 * (`updateMany` with a `gte` guard) that debitWallet()/manualWalletAdjustment()
 * rely on for race-safety, so tests can actually exercise the
 * insufficient-balance rejection path realistically. It also enforces
 * Transaction.reference's `@unique` constraint (throwing a
 * PrismaClientKnownRequestError with code P2002, same as real Prisma) so tests
 * can exercise the "redelivered webhook" idempotency branches in
 * creditDirectDeposit / creditDirectDepositByAccountNumber realistically.
 *
 * `$transaction(fn)` just calls `fn(api)` directly - there's no real
 * multi-statement atomicity here (no rollback-on-throw across the fake user/
 * transaction maps), so these tests verify *business logic* (balances,
 * status transitions, idempotency), not Postgres transaction isolation
 * itself. True concurrency/isolation guarantees need an integration test
 * against a real database - see the note in wallet.service.test.ts.
 */

class FakePrismaClientKnownRequestError extends Error {
  code: string;
  constructor(message: string, opts: { code: string }) {
    super(message);
    this.code = opts.code;
  }
}
export { FakePrismaClientKnownRequestError };


export type FakeUser = {
  id: string;
  walletBalanceKobo: bigint;
  [key: string]: unknown;
};

export type FakeTransaction = {
  id: string;
  userId: string;
  status: string;
  [key: string]: unknown;
};

export type FakeServicePricing = {
  id: string;
  service: string;
  provider: string;
  label: string;
  providerCostKobo: bigint;
  sellingPriceKobo: bigint | null;
  isActive: boolean;
  [key: string]: unknown;
};

type WhereClause = Record<string, unknown>;

function applyUpdate(record: Record<string, unknown>, data: Record<string, unknown>) {
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      const op = value as { increment?: unknown; decrement?: unknown };
      if ('increment' in op) {
        record[key] = (record[key] as bigint) + BigInt(op.increment as bigint | number);
        continue;
      }
      if ('decrement' in op) {
        record[key] = (record[key] as bigint) - BigInt(op.decrement as bigint | number);
        continue;
      }
    }
    record[key] = value;
  }
}

function matchesWhere(record: Record<string, unknown>, where: WhereClause): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected !== null && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date)) {
      const op = expected as { gte?: unknown; lte?: unknown; in?: unknown[]; equals?: unknown; contains?: unknown };
      if ('in' in op) return (op.in as unknown[]).includes(record[key]);
      if ('gte' in op || 'lte' in op) {
        const value = record[key] as bigint | number | Date;
        if ('gte' in op && !(value >= (op.gte as typeof value))) return false;
        if ('lte' in op && !(value <= (op.lte as typeof value))) return false;
        return true;
      }
      if ('equals' in op) return record[key] === op.equals; // `mode: 'insensitive'` not modeled here
      if ('contains' in op) return typeof record[key] === 'string' && (record[key] as string).includes(op.contains as string);
    }
    return record[key] === expected;
  });
}

export function createFakePrisma() {
  const users = new Map<string, FakeUser>();
  const transactions = new Map<string, FakeTransaction>();
  const servicePricings = new Map<string, FakeServicePricing>();

  const userApi = {
    async create({ data }: { data: Record<string, unknown> }) {
      const user = { ...data } as FakeUser;
      users.set(user.id, user);
      return { ...user };
    },
    async findUnique({ where }: { where: WhereClause }) {
      const user = users.get(where.id as string);
      return user ? { ...user } : null;
    },
    async findFirst({ where }: { where: WhereClause }) {
      for (const u of users.values()) {
        if (matchesWhere(u, where)) return { ...u };
      }
      return null;
    },
    async findUniqueOrThrow({ where }: { where: WhereClause }) {
      const user = users.get(where.id as string);
      if (!user) throw new Error(`FakePrisma: user ${where.id} not found`);
      return { ...user };
    },
    async update({ where, data }: { where: WhereClause; data: Record<string, unknown> }) {
      const user = users.get(where.id as string);
      if (!user) throw new Error(`FakePrisma: user ${where.id} not found`);
      applyUpdate(user, data);
      return { ...user };
    },
    async updateMany({ where, data }: { where: WhereClause; data: Record<string, unknown> }) {
      const user = users.get(where.id as string);
      if (!user || !matchesWhere(user, where)) return { count: 0 };
      applyUpdate(user, data);
      return { count: 1 };
    }
  };

  const transactionApi = {
    async findFirst({ where, orderBy }: { where: WhereClause; orderBy?: { createdAt?: 'asc' | 'desc' } }) {
      let matches = [...transactions.values()].filter((t) => matchesWhere(t, where));
      if (orderBy?.createdAt) {
        const dir = orderBy.createdAt === 'desc' ? -1 : 1;
        matches = matches.sort((a, b) => dir * ((a.createdAt as Date).getTime() - (b.createdAt as Date).getTime()));
      }
      return matches[0] ? { ...matches[0] } : null;
    },
    async findUnique({ where }: { where: WhereClause }) {
      if (where.id) {
        const t = transactions.get(where.id as string);
        return t ? { ...t } : null;
      }
      for (const t of transactions.values()) {
        if (matchesWhere(t, where)) return { ...t };
      }
      return null;
    },
    async findUniqueOrThrow(args: { where: WhereClause }) {
      const t = await transactionApi.findUnique(args);
      if (!t) throw new Error('FakePrisma: transaction not found');
      return t;
    },
    async create({ data }: { data: Record<string, unknown> }) {
      if (data.reference != null) {
        for (const existing of transactions.values()) {
          if (existing.reference === data.reference) {
            throw new FakePrismaClientKnownRequestError('Unique constraint failed on the fields: (`reference`)', {
              code: 'P2002'
            });
          }
        }
      }
      // Real Prisma auto-populates these via the schema's
      // `@default(now())` / `@updatedAt` directives - debitWallet() (and
      // every caller like it) never sets them explicitly, relying on that.
      // Mirror it here so `transaction.createdAt`/`updatedAt` are never
      // undefined in a test, the way they would be with a real database.
      const now = new Date();
      const t = { createdAt: now, updatedAt: now, ...data } as unknown as FakeTransaction;
      transactions.set(t.id, t);
      return { ...t };
    },
    async update({ where, data }: { where: WhereClause; data: Record<string, unknown> }) {
      const t = transactions.get(where.id as string);
      if (!t) throw new Error('FakePrisma: transaction not found');
      applyUpdate(t, data);
      // Same `@updatedAt` auto-touch as create() above, unless the caller
      // explicitly set updatedAt itself (some callers do, to backdate it).
      if (!('updatedAt' in data)) t.updatedAt = new Date();
      return { ...t };
    },
    async updateMany({ where, data }: { where: WhereClause; data: Record<string, unknown> }) {
      let count = 0;
      for (const t of transactions.values()) {
        if (matchesWhere(t, where)) {
          applyUpdate(t, data);
          if (!('updatedAt' in data)) t.updatedAt = new Date();
          count += 1;
        }
      }
      return { count };
    },
    async findMany({ where, orderBy, take }: { where?: WhereClause; orderBy?: { createdAt?: 'asc' | 'desc' }; take?: number } = {}) {
      let results = [...transactions.values()].filter((t) => !where || matchesWhere(t, where));
      if (orderBy?.createdAt) {
        const dir = orderBy.createdAt === 'desc' ? -1 : 1;
        results = results.sort((a, b) => dir * ((a.createdAt as Date).getTime() - (b.createdAt as Date).getTime()));
      }
      if (typeof take === 'number') results = results.slice(0, take);
      return results.map((t) => ({ ...t }));
    },
    async count({ where }: { where?: WhereClause } = {}) {
      return [...transactions.values()].filter((t) => !where || matchesWhere(t, where)).length;
    },
    /** Mirrors real Prisma's `_sum` semantics: nulls are treated as 0 in the sum, exactly like SQL SUM(). */
    async aggregate({ where, _sum }: { where?: WhereClause; _sum?: Record<string, boolean> }) {
      const matched = [...transactions.values()].filter((t) => !where || matchesWhere(t, where));
      const sum: Record<string, bigint> = {};
      for (const field of Object.keys(_sum ?? {})) {
        sum[field] = matched.reduce((acc, t) => acc + ((t[field] as bigint | null) ?? 0n), 0n);
      }
      return { _sum: sum, _count: { _all: matched.length } };
    },
    async groupBy({
      by,
      where,
      _sum,
      _count
    }: {
      by: string[];
      where?: WhereClause;
      _sum?: Record<string, boolean>;
      _count?: { _all: boolean };
    }) {
      const matched = [...transactions.values()].filter((t) => !where || matchesWhere(t, where));
      const groups = new Map<string, FakeTransaction[]>();
      for (const t of matched) {
        const key = by.map((k) => String(t[k])).join('|');
        const bucket = groups.get(key);
        if (bucket) bucket.push(t);
        else groups.set(key, [t]);
      }
      return [...groups.values()].map((rows) => {
        const result: Record<string, unknown> = {};
        for (const k of by) result[k] = rows[0][k];
        if (_sum) {
          const sum: Record<string, bigint> = {};
          for (const field of Object.keys(_sum)) {
            sum[field] = rows.reduce((acc, t) => acc + ((t[field] as bigint | null) ?? 0n), 0n);
          }
          result._sum = sum;
        }
        if (_count) result._count = { _all: rows.length };
        return result;
      });
    }
  };

  /** Keyed by the `service` field, matching ServicePricing's real `@unique`
   *  constraint - the pricing lookups in cac.service.ts / nin-modification.
   *  service.ts / bvn-modification.service.ts all findUnique/create by
   *  `service`, never by `id`. */
  const servicePricingApi = {
    async findUnique({ where }: { where: WhereClause }) {
      if (where.service) {
        const row = servicePricings.get(where.service as string);
        return row ? { ...row } : null;
      }
      for (const row of servicePricings.values()) {
        if (matchesWhere(row, where)) return { ...row };
      }
      return null;
    },
    async findUniqueOrThrow(args: { where: WhereClause }) {
      const row = await servicePricingApi.findUnique(args);
      if (!row) throw new Error('FakePrisma: servicePricing not found');
      return row;
    },
    async create({ data }: { data: Record<string, unknown> }) {
      const service = data.service as string;
      if (servicePricings.has(service)) {
        throw new FakePrismaClientKnownRequestError('Unique constraint failed on the fields: (`service`)', { code: 'P2002' });
      }
      const row = {
        id: (data.id as string) ?? `pricing-${servicePricings.size + 1}`,
        isActive: true,
        sellingPriceKobo: null,
        ...data
      } as FakeServicePricing;
      servicePricings.set(service, row);
      return { ...row };
    },
    async update({ where, data }: { where: WhereClause; data: Record<string, unknown> }) {
      const row = where.service ? servicePricings.get(where.service as string) : undefined;
      if (!row) throw new Error('FakePrisma: servicePricing not found');
      applyUpdate(row, data);
      return { ...row };
    }
  };

  type FakePrismaApi = {
    user: typeof userApi;
    transaction: typeof transactionApi;
    servicePricing: typeof servicePricingApi;
    $transaction<T>(fn: (tx: FakePrismaApi) => Promise<T>): Promise<T>;
  };

  const api: FakePrismaApi = {
    user: userApi,
    transaction: transactionApi,
    servicePricing: servicePricingApi,
    async $transaction<T>(fn: (tx: FakePrismaApi) => Promise<T>): Promise<T> {
      return fn(api);
    }
  };

  return {
    api,
    /** Clears all seeded data - call between tests that share one module-level fake instance (see company-wallet.service.test.ts). */
    reset() {
      users.clear();
      transactions.clear();
      servicePricings.clear();
    }
  };
}

export function makeUser(overrides: Partial<FakeUser> & { id: string; walletBalanceKobo: bigint }): FakeUser {
  return { ...overrides };
}
