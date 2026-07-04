import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

// NOTE: rate limiting lives in ./rateLimitMiddleware.ts now. It used to be
// defined here too, and since index.ts does `export *` from both files,
// having the same export name in two files is a TypeScript compile error
// (TS2308: Module has already exported a member named 'rateLimitMiddleware').

// Admin auth middleware
export const requireAdmin = async (context: functions.https.CallableContext) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }

  const userDoc = await admin.firestore().collection('users').doc(context.auth.uid).get();
  const role = userDoc.data()?.role;

  if (!['admin', 'superAdmin'].includes(role)) {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required');
  }
};

// Super admin auth middleware
export const requireSuperAdmin = async (context: functions.https.CallableContext) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }

  const userDoc = await admin.firestore().collection('users').doc(context.auth.uid).get();
  const role = userDoc.data()?.role;

  if (role !== 'superAdmin') {
    throw new functions.https.HttpsError('permission-denied', 'Super admin access required');
  }
};
