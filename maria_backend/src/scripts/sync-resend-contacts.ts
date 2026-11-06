import { prisma } from '../lib/prisma.js';
import { addUserToResendAudience, listResendAudienceContactEmails } from '../lib/email.js';

const PAGE_SIZE = 500;

async function main() {
  console.log('[resend:sync-contacts] Reading current Resend Audience contacts...');
  const knownEmails = await listResendAudienceContactEmails();
  console.log(`[resend:sync-contacts] Found ${knownEmails.size} existing contacts.`);

  let cursorId: string | undefined;
  let scanned = 0;
  let added = 0;
  let failed = 0;

  while (true) {
    const users = await prisma.user.findMany({
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      select: { id: true, email: true, fullName: true }
    });
    if (users.length === 0) break;

    for (const user of users) {
      scanned += 1;
      const email = user.email.trim().toLowerCase();
      if (!email || knownEmails.has(email)) continue;

      const result = await addUserToResendAudience({ email, name: user.fullName });
      if (result.added) {
        knownEmails.add(email);
        added += 1;
        console.log(`[resend:sync-contacts] Added ${email}`);
      } else {
        failed += 1;
        console.error(`[resend:sync-contacts] Could not add ${email}`);
      }
    }

    cursorId = users[users.length - 1].id;
    console.log(`[resend:sync-contacts] Scanned ${scanned}; added ${added}; failed ${failed}.`);
    if (users.length < PAGE_SIZE) break;
  }

  console.log(`[resend:sync-contacts] Complete. Scanned ${scanned}; added ${added}; already present ${scanned - added - failed}; failed ${failed}.`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error('[resend:sync-contacts] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
