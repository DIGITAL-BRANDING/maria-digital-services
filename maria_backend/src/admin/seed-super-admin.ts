import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';

async function main() {
  const rl = readline.createInterface({ input, output });

  const email = (
    process.env.SEED_ADMIN_EMAIL ?? (await rl.question('Super admin email: '))
  )
    .trim()
    .toLowerCase();
  const fullName = (
    process.env.SEED_ADMIN_NAME ?? (await rl.question('Full name: '))
  ).trim();
  const password =
    process.env.SEED_ADMIN_PASSWORD ?? (await rl.question('Password (min 8 chars): '));

  rl.close();

  if (!email.includes('@')) throw new Error('Enter a valid email address');
  if (password.length < 8) throw new Error('Password must be at least 8 characters');

  const passwordHash = await bcrypt.hash(password, 12);

  const admin = await prisma.adminUser.upsert({
    where: { email },
    update: { passwordHash, fullName, role: 'SUPER_ADMIN', isActive: true },
    create: { email, passwordHash, fullName, role: 'SUPER_ADMIN' }
  });

  // Also make sure the referral settings singleton exists so it's editable
  // in the admin panel immediately, rather than only appearing after the
  // first purchase/withdrawal/stats call self-seeds it.
  await prisma.referralSettings.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default' }
  });

  console.log(`\nSuper admin ready: ${admin.email} (id: ${admin.id})`);
  console.log('Log in at /admin with this email and the password you just set.');

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
