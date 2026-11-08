import { Prisma, TransactionStatus, TransactionType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { koboToNaira } from '../lib/money.js';
import { sendTicketSubmittedEmails, sendTicketProcessingEmail, sendTicketCompletedEmails } from '../lib/email.js';

export const EMAIL_TICKET_TYPES = new Set<TransactionType>([
  TransactionType.IDENTITY_SERVICE_REQUEST,
  TransactionType.NIN_MODIFICATION,
  TransactionType.BVN_MODIFICATION,
  TransactionType.CAC_SERVICE_REQUEST,
  TransactionType.BVN_LICENSE_ONBOARDING,
  TransactionType.BIRTH_ATTESTATION,
  TransactionType.NEWSPAPER_PUBLICATION,
  TransactionType.BVN_CRM,
  TransactionType.TIN_CERTIFICATE_REQUEST
]);

function serviceLabel(value: unknown, description: string) {
  if (typeof value === 'string' && value.trim()) return value.replaceAll('_', ' ');
  return description.replace(/\s*[—–-]\s*/g, ' ').trim() || 'service request';
}

export async function emailTicketSubmitted(transactionId: string) {
  try {
    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { user: { select: { email: true, fullName: true } } }
    });
    if (!transaction || !EMAIL_TICKET_TYPES.has(transaction.type)) return;
    const metadata = transaction.metadata as Record<string, unknown> | null;
    await sendTicketSubmittedEmails({
      to: transaction.user.email,
      name: transaction.user.fullName,
      service: serviceLabel(metadata?.service, transaction.description),
      reference: transaction.reference,
      amount: `NGN${koboToNaira(transaction.amountKobo).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    });
  } catch (error) {
    console.error('[email] Could not send ticket-submitted emails', { transactionId, error });
  }
}

export async function emailTicketProcessing(transactionId: string) {
  try {
    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { user: { select: { email: true, fullName: true } } }
    });
    if (!transaction || transaction.status !== TransactionStatus.PENDING || !EMAIL_TICKET_TYPES.has(transaction.type)) {
      return { sent: false, reason: 'Request is not a pending ticket' };
    }
    const metadata = transaction.metadata as Record<string, unknown> | null;
    if (metadata?.processing_email_sent_at) return { sent: true, alreadySent: true };
    const result = await sendTicketProcessingEmail({
      to: transaction.user.email,
      name: transaction.user.fullName,
      service: serviceLabel(metadata?.service, transaction.description),
      reference: transaction.reference
    });
    if (!result.sent) return { sent: false, reason: 'Email could not be sent' };
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: { metadata: { ...metadata, processing_email_sent_at: new Date().toISOString() } as Prisma.InputJsonValue }
    });
    return { sent: true, alreadySent: false };
  } catch (error) {
    console.error('[email] Could not send ticket-processing email', { transactionId, error });
    return { sent: false, reason: 'Email could not be sent' };
  }
}

export async function emailTicketCompleted(transactionId: string, deliveryReady: boolean) {
  try {
    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { user: { select: { email: true, fullName: true } } }
    });
    if (!transaction || transaction.status !== TransactionStatus.SUCCESS || !EMAIL_TICKET_TYPES.has(transaction.type)) return;
    const metadata = transaction.metadata as Record<string, unknown> | null;
    if (metadata?.completion_email_sent_at) return;
    const result = await sendTicketCompletedEmails({
      to: transaction.user.email,
      name: transaction.user.fullName,
      service: serviceLabel(metadata?.service, transaction.description),
      reference: transaction.reference,
      provider: transaction.provider === 'ktech' || transaction.provider === 'ktech_dispatching' ? 'K-Tech' : 'Techhub',
      deliveryReady
    });
    if (!result.userSent && !result.adminSent) return;
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: { metadata: { ...metadata, completion_email_sent_at: new Date().toISOString(), completion_email_user_sent: result.userSent, completion_email_admin_sent: result.adminSent } as Prisma.InputJsonValue }
    });
  } catch (error) {
    console.error('[email] Could not send async completion emails', { transactionId, error });
  }
}
