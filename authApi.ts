import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { generateAndSendOtp, verifyOtp } from '../services/smsService';
import { validatePhoneNumber, sanitizeString, requireFields } from '../middleware/validationMiddleware';
import { checkFirestoreRateLimit } from '../middleware/rateLimitMiddleware';

const db = admin.firestore();

// Update the caller's own profile. Note: role, isVerified, isBlocked, and
// other trust/security fields are deliberately NOT accepted here - those
// can only be changed by admin endpoints (see adminApi.ts) or triggers.
export const updateUserProfile = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }

  const allowed = ['displayName', 'photoUrl', 'bio', 'preferredLanguage', 'isDarkMode'];
  const updates: Record<string, any> = {};
  for (const key of allowed) {
    if (data[key] !== undefined) {
      updates[key] = typeof data[key] === 'string' ? sanitizeString(data[key], 500) : data[key];
    }
  }

  if (Object.keys(updates).length === 0) {
    throw new functions.https.HttpsError('invalid-argument', 'No valid fields to update');
  }

  updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
  await db.collection('users').doc(context.auth.uid).update(updates);

  return { success: true };
});

export const updateFcmToken = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }
  requireFields(data, ['fcmToken']);

  await db.collection('users').doc(context.auth.uid).update({
    fcmToken: data.fcmToken,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});

export const updateEmergencyContacts = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }

  const { contacts } = data;
  if (!Array.isArray(contacts) || contacts.length > 5) {
    throw new functions.https.HttpsError('invalid-argument', 'Provide up to 5 emergency contacts');
  }

  await db.collection('users').doc(context.auth.uid).update({
    emergencyContacts: contacts,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});

// Self-service soft delete. Auth record deletion (which triggers
// authTriggers.onUserDeleted) is left to the client SDK after this call
// succeeds, since deleting the Auth user requires the user's own session.
export const requestAccountDeletion = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }

  await db.collection('users').doc(context.auth.uid).update({
    deletionRequested: true,
    deletionRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, message: 'Account deletion requested. You can now sign out and delete your session.' };
});

// Custom OTP flow for verifying a secondary phone number (e.g. an emergency
// contact's number). Primary login OTP is handled by Firebase Phone Auth
// client-side and does not need a backend endpoint.
export const sendPhoneVerificationOtp = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }
  requireFields(data, ['phoneNumber']);
  validatePhoneNumber(data.phoneNumber);

  // Hard cap: max 3 OTP sends per phone number per 10 minutes, enforced
  // across all instances via Firestore (not the in-memory limiter).
  await checkFirestoreRateLimit(`otp:${data.phoneNumber}`, 3, 600);

  const result = await generateAndSendOtp(data.phoneNumber);
  return result;
});

export const verifyPhoneOtp = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }
  requireFields(data, ['phoneNumber', 'otp']);

  const isValid = await verifyOtp(data.phoneNumber, data.otp);
  if (!isValid) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid or expired OTP');
  }

  return { success: true, verified: true };
});

// Report a user (harassment, unsafe behavior, policy violation, etc).
export const reportUser = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }
  requireFields(data, ['reportedUserId', 'reason']);

  const { reportedUserId, reason, bookingId, details } = data;

  if (reportedUserId === context.auth.uid) {
    throw new functions.https.HttpsError('invalid-argument', 'You cannot report yourself');
  }

  const reportRef = await db.collection('reports').add({
    reporterId: context.auth.uid,
    reportedUserId,
    reason: sanitizeString(reason, 200),
    details: sanitizeString(details || '', 1000),
    bookingId: bookingId || null,
    status: 'pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, reportId: reportRef.id };
});

// Block another user - prevents them from booking/messaging the caller.
// This is distinct from adminBlockUser, which suspends an account platform-wide.
export const blockUser = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }
  requireFields(data, ['blockedUserId']);

  const { blockedUserId } = data;
  if (blockedUserId === context.auth.uid) {
    throw new functions.https.HttpsError('invalid-argument', 'You cannot block yourself');
  }

  await db.collection('users').doc(context.auth.uid)
    .collection('blockedUsers').doc(blockedUserId)
    .set({ blockedUserId, createdAt: admin.firestore.FieldValue.serverTimestamp() });

  return { success: true };
});

export const unblockUser = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }
  requireFields(data, ['blockedUserId']);

  await db.collection('users').doc(context.auth.uid)
    .collection('blockedUsers').doc(data.blockedUserId)
    .delete();

  return { success: true };
});
