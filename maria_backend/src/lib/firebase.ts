import admin from 'firebase-admin';
import { env } from '../config/env.js';

export function getFirebaseAdmin() {
  if (admin.apps.length > 0) return admin;

  if (!env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_BASE64 is required');
  }

  const serviceAccount = JSON.parse(
    Buffer.from(env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8')
  );

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });

  return admin;
}
