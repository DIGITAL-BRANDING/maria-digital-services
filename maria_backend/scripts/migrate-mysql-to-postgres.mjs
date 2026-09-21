/**
 * One-off, restartable MySQL -> PostgreSQL data copy for the Supabase cutover.
 *
 * Required environment variables (do not commit or share these values):
 *   MYSQL_SOURCE_URL=mysql://user:password@127.0.0.1:PORT/railway
 *   POSTGRES_DATABASE_URL=postgresql://postgres.PROJECT_REF:password@...
 *
 * Apply the committed PostgreSQL Prisma migrations first, then run this with
 * MIGRATION_DRY_RUN=true before the final write-freeze/copy. Existing IDs on
 * the destination are left untouched, so an interrupted copy is safe to
 * restart. Source data is only read; this script never alters MySQL.
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { Client } from 'pg';

const mysqlUrl = process.env.MYSQL_SOURCE_URL;
// Reuse DATABASE_URL during a normal Prisma/Supabase shell session, while
// retaining the explicit name for isolated migration automation.
const postgresUrl = process.env.POSTGRES_DATABASE_URL ?? process.env.DATABASE_URL;
const batchSize = Number.parseInt(process.env.MIGRATION_BATCH_SIZE ?? '250', 10);
const dryRun = process.env.MIGRATION_DRY_RUN === 'true';

if (!mysqlUrl?.startsWith('mysql://')) throw new Error('MYSQL_SOURCE_URL must use mysql://.');
if (!postgresUrl?.startsWith('postgres')) throw new Error('POSTGRES_DATABASE_URL must use postgresql:// or postgres://.');
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
  throw new Error('MIGRATION_BATCH_SIZE must be an integer between 1 and 1000.');
}

// Parent rows precede their children. Transaction is self-referencing, so its
// relatedTransactionId is restored in a second pass after every row exists.
const tables = [
  'AdminUser', 'User', 'DataPlanPricing', 'ServicePricing', 'ReferralSettings',
  'AppConfig', 'PricingSettings', 'WhatsAppSession', 'ProviderBalanceStatus',
  'ProviderLedgerBalance', 'Transaction', 'RefreshToken', 'PasswordResetCode',
  'Coupon', 'ProviderLedgerEntry', 'DeviceToken', 'NotificationBroadcast',
  'Notification', 'AssistantAuditEvent', 'UserDelivery', 'SupportTicket',
  'SupportTicketMessage', 'AdminAuditLog'
];

const quoteMy = (name) => `\`${name.replaceAll('`', '``')}\``;
const quotePg = (name) => `"${name.replaceAll('"', '""')}"`;
const cursorFor = (columns) => columns.includes('id') ? 'id' : 'provider';

function postgresValue(value) {
  if (value === undefined || value === null) return null;
  // MySQL JSON can arrive as an object; node-postgres serializes plain
  // objects correctly, but stringify explicitly so the target json column is
  // unambiguous. BigInt must become text so it never loses money precision.
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) return JSON.stringify(value);
  return value;
}

async function mysqlColumns(my, table) {
  const [rows] = await my.query(
    'SELECT COLUMN_NAME AS name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ORDINAL_POSITION',
    [table]
  );
  return rows.map((row) => row.name);
}

async function postgresColumns(pg, table) {
  const result = await pg.query(
    'SELECT column_name AS name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position',
    ['public', table]
  );
  return result.rows.map((row) => row.name);
}

async function assertSchema(my, pg) {
  for (const table of tables) {
    const [source, destination] = await Promise.all([mysqlColumns(my, table), postgresColumns(pg, table)]);
    if (source.length === 0) throw new Error(`MySQL source table ${table} does not exist.`);
    if (destination.length === 0) throw new Error(`PostgreSQL destination table ${table} does not exist. Apply Prisma migrations first.`);
    const missing = source.filter((column) => !destination.includes(column));
    if (missing.length) throw new Error(`${table}: PostgreSQL is missing columns: ${missing.join(', ')}`);
  }
}

async function copyTable(my, pg, table) {
  const columns = await mysqlColumns(my, table);
  const cursorColumn = cursorFor(columns);
  let cursor = null;
  let copied = 0;

  while (true) {
    const sql = cursor === null
      ? `SELECT * FROM ${quoteMy(table)} ORDER BY ${quoteMy(cursorColumn)} ASC LIMIT ?`
      : `SELECT * FROM ${quoteMy(table)} WHERE ${quoteMy(cursorColumn)} > ? ORDER BY ${quoteMy(cursorColumn)} ASC LIMIT ?`;
    const [rows] = await my.query(sql, cursor === null ? [batchSize] : [cursor, batchSize]);
    if (rows.length === 0) break;

    const values = [];
    const records = rows.map((sourceRow) => {
      const row = { ...sourceRow };
      if (table === 'Transaction') row.relatedTransactionId = null;
      return row;
    });
    const numbered = records.map((row, rowIndex) =>
      `(${columns.map((column, columnIndex) => {
        values.push(postgresValue(row[column]));
        return `$${rowIndex * columns.length + columnIndex + 1}`;
      }).join(', ')})`
    ).join(', ');
    // PostgreSQL migrations seed a small number of pricing rows. Their UUIDs
    // can differ from MySQL even though the business key is the same, so use
    // that business key for those two pricing tables. The MySQL record is the
    // cutover source of truth and updates the pre-seeded row in place.
    const conflictColumns = table === 'ServicePricing'
      ? ['service']
      : table === 'DataPlanPricing'
        ? ['provider', 'providerPlanId']
        : [columns.includes('id') ? 'id' : columns[0]];
    const updateColumns = columns.filter((column) => !conflictColumns.includes(column) && column !== 'id');
    const conflictAction = updateColumns.length
      ? `DO UPDATE SET ${updateColumns.map((column) => `${quotePg(column)} = EXCLUDED.${quotePg(column)}`).join(', ')}`
      : 'DO NOTHING';
    await pg.query(
      `INSERT INTO ${quotePg(table)} (${columns.map(quotePg).join(', ')}) VALUES ${numbered} ON CONFLICT (${conflictColumns.map(quotePg).join(', ')}) ${conflictAction}`,
      values
    );
    copied += records.length;
    cursor = rows.at(-1)[cursorColumn];
    console.log(`${table}: copied/verified ${copied} row(s)...`);
  }
}

async function restoreTransactionReferences(my, pg) {
  let cursor = null;
  let restored = 0;
  while (true) {
    const sql = cursor === null
      ? 'SELECT id, relatedTransactionId FROM `Transaction` WHERE relatedTransactionId IS NOT NULL ORDER BY id ASC LIMIT ?'
      : 'SELECT id, relatedTransactionId FROM `Transaction` WHERE relatedTransactionId IS NOT NULL AND id > ? ORDER BY id ASC LIMIT ?';
    const [rows] = await my.query(sql, cursor === null ? [batchSize] : [cursor, batchSize]);
    if (rows.length === 0) break;
    for (const row of rows) {
      await pg.query('UPDATE "Transaction" SET "relatedTransactionId" = $1 WHERE id = $2', [row.relatedTransactionId, row.id]);
      restored += 1;
    }
    cursor = rows.at(-1).id;
  }
  console.log(`Transaction references restored: ${restored}`);
}

async function countRows(my, pg, table) {
  const [[source]] = await my.query(`SELECT COUNT(*) AS count FROM ${quoteMy(table)}`);
  const target = await pg.query(`SELECT COUNT(*)::text AS count FROM ${quotePg(table)}`);
  return { source: String(source.count), target: target.rows[0].count };
}

async function main() {
  const my = await mysql.createConnection({ uri: mysqlUrl, timezone: 'Z', supportBigNumbers: true, bigNumberStrings: true });
  const pg = new Client({ connectionString: postgresUrl });
  try {
    await pg.connect();
    await pg.query("SET TIME ZONE 'UTC'");
    await assertSchema(my, pg);
    if (dryRun) {
      console.log('Schema compatibility check passed; dry run did not write data.');
      return;
    }

    for (const table of tables) await copyTable(my, pg, table);
    await restoreTransactionReferences(my, pg);

    let mismatch = false;
    console.log('\nRow-count verification:');
    for (const table of tables) {
      const { source, target } = await countRows(my, pg, table);
      const ok = source === target;
      mismatch ||= !ok;
      console.log(`${table.padEnd(24)} MySQL=${source.padStart(8)} PostgreSQL=${target.padStart(8)} ${ok ? 'OK' : 'MISMATCH'}`);
    }
    if (mismatch) throw new Error('Row-count verification failed. Do not cut over.');
    console.log('\nMigration completed and all row counts match.');
  } finally {
    await Promise.allSettled([my.end(), pg.end()]);
  }
}

main().catch((error) => {
  console.error(`Migration paused: ${error instanceof Error ? error.message : String(error)}`);
  console.error('No MySQL source data was modified. Fix the issue and rerun safely.');
  process.exitCode = 1;
});
