import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';

export type AdminSessionUser = {
  id: string;
  email: string;
  fullName: string;
  role: 'SUPER_ADMIN' | 'FINANCE' | 'SUPPORT';
};

export async function authenticateAdmin(
  email: string,
  password: string
): Promise<AdminSessionUser | null> {
  const admin = await prisma.adminUser.findUnique({
    where: { email: email.toLowerCase().trim() }
  });
  if (!admin || !admin.isActive) return null;

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) return null;

  await prisma.adminUser.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date() }
  });

  return {
    id: admin.id,
    email: admin.email,
    fullName: admin.fullName,
    role: admin.role as AdminSessionUser['role']
  };
}
