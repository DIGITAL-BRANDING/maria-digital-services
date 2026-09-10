import { spawn } from 'node:child_process';

const runMigrationsOnStart = process.env.RUN_MIGRATIONS_ON_START === 'true';
const migrationTimeoutMs = Number(process.env.MIGRATION_TIMEOUT_MS ?? 45_000);

function run(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    console.log(`[start] Running: ${command} ${args.join(' ')}`);
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32'
    });

    const timeout = setTimeout(() => {
      console.error(`[start] ${command} timed out after ${timeoutMs}ms`);
      child.kill('SIGTERM');
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on('exit', (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        console.log(`[start] ${command} completed successfully`);
        return resolve();
      }

      const exitInfo = code !== null ? `code ${code}` : `signal ${signal}`;
      reject(new Error(`${command} exited with ${exitInfo}`));
    });
  });
}

process.on('uncaughtException', (error) => {
  console.error('[start] uncaught exception', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[start] unhandled rejection', reason);
  process.exit(1);
});

console.log('[start] Starting production deployment sequence');

if (runMigrationsOnStart) {
  console.log('[start] RUN_MIGRATIONS_ON_START=true, running migrations');
  await run('npx', ['prisma', 'migrate', 'deploy'], migrationTimeoutMs);
} else {
  console.log('[start] Skipping migrations on app startup');
  console.log('[start] Set RUN_MIGRATIONS_ON_START=true only for a one-off migration deploy');
}

console.log('[start] Starting API server');
await import('../dist/server.js');
