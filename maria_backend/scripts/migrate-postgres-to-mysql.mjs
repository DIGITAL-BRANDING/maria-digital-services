/**
 * One-off, restartable PostgreSQL -> MySQL data copy for the cutover window.
 *
 * Required environment variables (never put either URL in source control):
 *   PG_SOURCE_URL=postgresql://readonly-user:password@source-host:5432/database
 *   MYSQL_DATABASE_URL=mysql://user:password@mysql-host:3306/infoverify
 *
 * Run only after the MySQL baseline migration has been applied and writes to
 * PostgreSQL have been paused. The script keeps foreign keys enabled, streams
 * source rows in batches, fails on conversion/database warnings, and verifies
 * source/destination row counts before returning success. It is safe to rerun:
 * an existing primary key is left unchanged, but malformed new data is never
 * silently ignored.
 */
import 'dotenv/config';
import { Client } from 'pg';
import mysql from 'mysql2/promise';

const sourceUrl = process.env.PG_SOURCE_URL;
const destinationUrl = process.env.MYSQL_DATABASE_URL;
const sourceMode = process.env.MIGRATION_SOURCE ?? 'postgresql';
const supabaseSourceUrl = (process.env.SUPABASE_SOURCE_URL ?? process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const supabaseServiceRoleKey = process.env.SUPABASE_SOURCE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const batchSize = Number.parseInt(process.env.MIGRATION_BATCH_SIZE ?? '250', 10);
const dryRun = process.env.MIGRATION_DRY_RUN === 'true';

if (!['postgresql', 'supabase-api'].includes(sourceMode)) {
  throw new Error('MIGRATION_SOURCE must be either postgresql or supabase-api.');
}
if (sourceMode === 'postgresql' && !sourceUrl?.startsWith('postgres')) {
  throw new Error('PG_SOURCE_URL must be a PostgreSQL URL.');
}
if (sourceMode === 'supabase-api' && (!supabaseSourceUrl.startsWith('https://') || !supabaseServiceRoleKey)) {
  throw new Error('SUPABASE_SOURCE_URL and SUPABASE_SOURCE_SERVICE_ROLE_KEY are required for MIGRATION_SOURCE=supabase-api.');
}
if (!destinationUrl?.startsWith('mysql://')) throw new Error('MYSQL_DATABASE_URL must use mysql://.');
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
  throw new Error('MIGRATION_BATCH_SIZE must be an integer between 1 and 1000.');
}

// Parent rows always precede their children. Transaction is self-referencing
// and has its relatedTransactionId restored in a second, explicit pass.
const tables = [
  'AdminUser',
  'User',
  'DataPlanPricing',
  'ServicePricing',
  'ReferralSettings',
  'AppConfig',
  'PricingSettings',
  'WhatsAppSession',
  'ProviderBalanceStatus',
  'ProviderLedgerBalance',
  'Transaction',
  'RefreshToken',
  'PasswordResetCode',
  'Coupon',
  'ProviderLedgerEntry',
  'DeviceToken',
  'NotificationBroadcast',
  'Notification',
  'AssistantAuditEvent',
  'UserDelivery',
  'SupportTicket',
  'SupportTicketMessage',
  'AdminAuditLog'
];

const quotePg = (identifier) => `"${identifier.replaceAll('"', '""')}"`;
const quoteMysql = (identifier) => `\`${identifier.replaceAll('`', '``')}\``;
const cursorColumnFor = (columns) => (columns.includes('id') ? 'id' : 'provider');
const bigintColumns = new Set([
  'walletBalanceKobo', 'referralEarningsKobo', 'referralWithdrawnKobo',
  'amountKobo', 'balanceBeforeKobo', 'balanceAfterKobo', 'costKobo',
  'providerCostKobo', 'sellingPriceKobo', 'minWithdrawalKobo', 'valueKobo'
]);

function mysqlValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'bigint') return value.toString();
  return value;
}

function parseSupabaseRows(body) {
  // PostgREST serializes PostgreSQL bigint as JSON numbers. Convert the raw
  // number tokens for our money columns before JSON.parse so JavaScript cannot
  // round a value beyond Number.MAX_SAFE_INTEGER.
  const bigintPattern = new RegExp(`("(?:${[...bigintColumns].join('|')})"\\s*:\\s*)(-?\\d+)(?=\\s*[,}])`, 'g');
  return JSON.parse(body.replace(bigintPattern, '$1"$2"'));
}

async function supabaseRequest(table, parameters, { count = false } = {}) {
  const query = new URLSearchParams(parameters);
  const requestUrl = `${supabaseSourceUrl}/rest/v1/${encodeURIComponent(table)}?${query}`;
  let response;
  try {
    response = await fetch(requestUrl, {
      headers: {
        apikey: supabaseServiceRoleKey,
        Authorization: `Bearer ${supabaseServiceRoleKey}`,
        Accept: 'application/json',
        ...(count ? { Prefer: 'count=exact' } : {})
      }
    });
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : '';
    throw new Error(`Cannot reach Supabase Data API at ${supabaseSourceUrl}${cause}`);
  }
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase Data API ${table} request failed (${response.status}): ${body.slice(0, 500)}`);
  return { rows: body ? parseSupabaseRows(body) : [], count: response.headers.get('content-range') };
}

async function apiCountRows(table, columns) {
  const result = await supabaseRequest(table, { select: columns.join(','), limit: '1' }, { count: true });
  const match = result.count?.match(/\/(\d+)$/);
  if (!match) throw new Error(`${table}: Supabase did not return an exact row count.`);
  return match[1];
}

async function assertApiSchemaCompatibility(my) {
  for (const table of tables) {
    const columns = await destinationColumns(my, table);
    if (columns.length === 0) throw new Error(`${table}: destination table does not exist.`);
    // Selecting every expected destination field validates the source schema
    // even for an empty source table.
    await supabaseRequest(table, { select: columns.join(','), limit: '1' });
  }
}

async function copyApiTable(my, table) {
  const columns = await destinationColumns(my, table);
  const cursorColumn = cursorColumnFor(columns);
  let cursor = null;
  let copied = 0;
  while (true) {
    const parameters = { select: columns.join(','), order: `${cursorColumn}.asc`, limit: String(batchSize) };
    if (cursor !== null) parameters[cursorColumn] = `gt.${cursor}`;
    const result = await supabaseRequest(table, parameters);
    if (result.rows.length === 0) break;
    const rows = result.rows.map((sourceRow) => {
      const row = { ...sourceRow };
      if (table === 'Transaction') row.relatedTransactionId = null;
      return row;
    });
    await insertBatch(my, table, columns, rows);
    copied += rows.length;
    cursor = result.rows.at(-1)[cursorColumn];
    console.log(`${table}: processed ${copied} source rows...`);
  }
  console.log(`${table}: processed ${copied} source rows`);
}

async function restoreApiTransactionReferences(my) {
  let cursor = null;
  let restored = 0;
  while (true) {
    const parameters = {
      select: 'id,relatedTransactionId',
      relatedTransactionId: 'not.is.null',
      order: 'id.asc',
      limit: String(batchSize)
    };
    if (cursor !== null) parameters.id = `gt.${cursor}`;
    const result = await supabaseRequest('Transaction', parameters);
    if (result.rows.length === 0) break;
    for (const row of result.rows) {
      await my.execute('UPDATE `Transaction` SET `relatedTransactionId` = ? WHERE `id` = ?', [row.relatedTransactionId, row.id]);
      restored += 1;
    }
    cursor = result.rows.at(-1).id;
    console.log(`Transaction references restored: ${restored}...`);
  }
  console.log(`Transaction references restored: ${restored}`);
}

async function apiMain(my) {
  await assertApiSchemaCompatibility(my);
  if (dryRun) {
    console.log('Supabase Data API schema compatibility check passed; dry run did not write data.');
    return;
  }
  for (const table of tables) await copyApiTable(my, table);
  await restoreApiTransactionReferences(my);

  let mismatch = false;
  console.log('\nRow-count verification:');
  for (const table of tables) {
    const columns = await destinationColumns(my, table);
    const [sourceCount, destination] = await Promise.all([
      apiCountRows(table, columns),
      my.query(`SELECT COUNT(*) AS count FROM ${quoteMysql(table)}`)
    ]);
    const destinationCount = String(destination[0][0].count);
    const ok = sourceCount === destinationCount;
    mismatch ||= !ok;
    console.log(`${table.padEnd(24)} Supabase=${sourceCount.padStart(8)} MySQL=${destinationCount.padStart(8)} ${ok ? 'OK' : 'MISMATCH'}`);
  }
  if (mismatch) throw new Error('Row-count verification failed. Do not cut over.');
  console.log('\nMigration completed and all row counts match.');
}

async function connectSource() {
  const client = new Client({ connectionString: sourceUrl, connectionTimeoutMillis: 20_000 });
  // A pooler can reset an individual backend connection. Keep the error handled
  // so the query retry below can replace this client instead of crashing Node.
  client.on('error', (error) => console.error(`[source] PostgreSQL connection error: ${error.message}`));
  await client.connect();
  await client.query("SET TIME ZONE 'UTC'");
  return client;
}

async function sourceQuery(source, query, values = []) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await source.client.query(query, values);
    } catch (error) {
      lastError = error;
      console.error(`[source] Query failed (attempt ${attempt}/3): ${error.message}; reconnecting...`);
      await source.client.end().catch(() => undefined);
      source.client = await connectSource();
    }
  }
  throw lastError;
}

async function sourceColumns(source, table) {
  const result = await sourceQuery(source,
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [table]
  );
  return result.rows.map((row) => row.column_name);
}

async function destinationColumns(my, table) {
  const [rows] = await my.query(
    `SELECT COLUMN_NAME AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ORDINAL_POSITION`,
    [table]
  );
  return rows.map((row) => row.columnName);
}

async function assertSchemaCompatibility(source, my) {
  for (const table of tables) {
    const [sourceTableColumns, destination] = await Promise.all([sourceColumns(source, table), destinationColumns(my, table)]);
    if (sourceTableColumns.length === 0) throw new Error(`Source table ${table} does not exist.`);
    if (destination.length === 0) throw new Error(`Destination table ${table} does not exist. Apply the baseline migration first.`);
    const missing = sourceTableColumns.filter((column) => !destination.includes(column));
    if (missing.length > 0) throw new Error(`${table}: destination is missing source columns: ${missing.join(', ')}`);
  }
}

async function countRows(source, my, table) {
  const [sourceCount, destination] = await Promise.all([
    sourceQuery(source, `SELECT COUNT(*)::text AS count FROM ${quotePg(table)}`),
    my.query(`SELECT COUNT(*) AS count FROM ${quoteMysql(table)}`)
  ]);
  return { source: sourceCount.rows[0].count, destination: String(destination[0][0].count) };
}

async function insertBatch(my, table, columns, rows) {
  if (rows.length === 0) return;
  const rowMarkers = `(${columns.map(() => '?').join(', ')})`;
  const primaryKey = columns.includes('id') ? 'id' : columns[0];
  const sql = `INSERT INTO ${quoteMysql(table)} (${columns.map(quoteMysql).join(', ')}) VALUES ${rows.map(() => rowMarkers).join(', ')} ON DUPLICATE KEY UPDATE ${quoteMysql(primaryKey)} = ${quoteMysql(primaryKey)}`;
  const values = rows.flatMap((row) => columns.map((column) => mysqlValue(row[column])));
  try {
    await my.execute(sql, values);
  } catch (error) {
    // Large encrypted documents/PII can make one multi-row statement exceed
    // MySQL's packet limit. Split only this batch; a one-row failure remains
    // visible so a server-limit adjustment is never silently bypassed.
    if (rows.length > 1 && /max_allowed_packet|packet bigger/i.test(String(error))) {
      const midpoint = Math.ceil(rows.length / 2);
      console.log(`${table}: packet too large; retrying as smaller batches...`);
      await insertBatch(my, table, columns, rows.slice(0, midpoint));
      await insertBatch(my, table, columns, rows.slice(midpoint));
      return;
    }
    throw error;
  }
}

async function copyTable(source, my, table) {
  const columns = await sourceColumns(source, table);
  const cursorColumn = cursorColumnFor(columns);
  if (!columns.includes(cursorColumn)) throw new Error(`${table}: no stable pagination column found.`);

  let cursor = null;
  let copied = 0;

  // Do not use pg-query-stream here. Supabase poolers can terminate server-side
  // cursors between batches; ordinary keyset-paginated queries are pooler-safe.
  while (true) {
    const query = cursor === null
      ? `SELECT * FROM ${quotePg(table)} ORDER BY ${quotePg(cursorColumn)} ASC LIMIT $1`
      : `SELECT * FROM ${quotePg(table)} WHERE ${quotePg(cursorColumn)} > $1 ORDER BY ${quotePg(cursorColumn)} ASC LIMIT $2`;
    const values = cursor === null ? [batchSize] : [cursor, batchSize];
    const result = await sourceQuery(source, query, values);
    if (result.rows.length === 0) break;

    const rows = result.rows.map((sourceRow) => {
      const row = { ...sourceRow };
      if (table === 'Transaction') row.relatedTransactionId = null;
      return row;
    });
    await insertBatch(my, table, columns, rows);
    copied += rows.length;
    cursor = result.rows.at(-1)[cursorColumn];
    console.log(`${table}: processed ${copied} source rows...`);
  }
  console.log(`${table}: processed ${copied} source rows`);
}

async function restoreTransactionReferences(source, my) {
  let cursor = null;
  let restored = 0;
  while (true) {
    const query = cursor === null
      ? 'SELECT "id", "relatedTransactionId" FROM "Transaction" WHERE "relatedTransactionId" IS NOT NULL ORDER BY "id" ASC LIMIT $1'
      : 'SELECT "id", "relatedTransactionId" FROM "Transaction" WHERE "relatedTransactionId" IS NOT NULL AND "id" > $1 ORDER BY "id" ASC LIMIT $2';
    const result = await sourceQuery(source, query, cursor === null ? [batchSize] : [cursor, batchSize]);
    if (result.rows.length === 0) break;
    for (const row of result.rows) {
      await my.execute('UPDATE `Transaction` SET `relatedTransactionId` = ? WHERE `id` = ?', [row.relatedTransactionId, row.id]);
      restored += 1;
    }
    cursor = result.rows.at(-1).id;
    console.log(`Transaction references restored: ${restored}...`);
  }
  console.log(`Transaction references restored: ${restored}`);
}

async function main() {
  // mysql2 otherwise serializes JavaScript Date values in the host's local
  // timezone. The source query and destination session are both pinned to UTC.
  const my = await mysql.createConnection({ uri: destinationUrl, timezone: 'Z' });
  let source;
  try {
    await my.query("SET time_zone = '+00:00'");
    await my.query("SET SESSION sql_mode = CONCAT_WS(',', @@sql_mode, 'STRICT_ALL_TABLES')");

    if (sourceMode === 'supabase-api') {
      await apiMain(my);
      return;
    }

    source = { client: await connectSource() };

    await assertSchemaCompatibility(source, my);
    if (dryRun) {
      console.log('Schema compatibility check passed; dry run did not write data.');
      return;
    }

    for (const table of tables) await copyTable(source, my, table);
    await restoreTransactionReferences(source, my);

    let mismatch = false;
    console.log('\nRow-count verification:');
    for (const table of tables) {
      const counts = await countRows(source, my, table);
      const ok = counts.source === counts.destination;
      mismatch ||= !ok;
      console.log(`${table.padEnd(24)} PostgreSQL=${counts.source.padStart(8)} MySQL=${counts.destination.padStart(8)} ${ok ? 'OK' : 'MISMATCH'}`);
    }
    if (mismatch) throw new Error('Row-count verification failed. Do not cut over.');
    console.log('\nMigration completed and all row counts match.');
  } finally {
    await Promise.allSettled([source?.client.end(), my.end()]);
  }
}

main().catch((error) => {
  console.error(`Migration paused: ${error instanceof Error ? error.message : String(error)}`);
  console.error('No source data was deleted. Re-run the same command after the source connection is stable; existing destination IDs are safe to resume.');
  process.exitCode = 1;
});
