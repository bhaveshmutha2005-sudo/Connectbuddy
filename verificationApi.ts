import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { requireFields } from '../middleware/validationMiddleware';

const db = admin.firestore();

// Documents are uploaded to Firebase Storage client-side first; this
// endpoint just records the resulting storage paths/URLs and flips status
// to pending so an admin can review them via adminApi.adminVerifyCompanion.
export const submitVerificationDocs = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  requireFields(data, ['idDocumentUrl', 'idType']);

  const { idDocumentUrl, idType, addressProofUrl } = data;
  const userId = context.auth.uid;

  const companionDoc = await db.collection('companions').doc(userId).get();
  if (!companionDoc.exists) {
    throw new functions.https.HttpsError('failed-precondition', 'Create a companion profile first');
  }

  await db.collection('verificationDocs').doc(userId).set({
    userId,
    idType,
    idDocumentUrl,
    addressProofUrl: addressProofUrl || null,
    status: 'pending',
    submittedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  await db.collection('companions').doc(userId).update({
    verificationStatus: 'pending',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, message: 'Documents submitted for review' };
});

// Face verification: compares a live selfie against the submitted ID photo.
// Actual biometric matching should go through a dedicated provider (AWS
// Rekognition, Azure Face API, etc) - this endpoint validates inputs, calls
// the provider, and records the result. Plug the provider call in where
// marked; we do not implement face-matching math ourselves.
export const submitFaceVerification = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  requireFields(data, ['selfieUrl']);

  const userId = context.auth.uid;
  const verificationDoc = await db.collection('verificationDocs').doc(userId).get();
  if (!verificationDoc.exists) {
    throw new functions.https.HttpsError('failed-precondition', 'Submit your ID document before face verification');
  }

  // TODO: call your face-matching provider here, e.g.:
  //   const matchResult = await faceMatchProvider.compare(data.selfieUrl, verificationDoc.data().idDocumentUrl);
  // For now this records the submission as pending manual/admin review.
  await db.collection('verificationDocs').doc(userId).update({
    selfieUrl: data.selfieUrl,
    faceVerificationStatus: 'pending_review',
    faceVerificationSubmittedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, message: 'Selfie submitted for review' };
});

export const getVerificationStatus = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');

  const doc = await db.collection('verificationDocs').doc(context.auth.uid).get();
  if (!doc.exists) return { status: 'not_submitted' };

  const d = doc.data()!;
  return {
    status: d.status,
    faceVerificationStatus: d.faceVerificationStatus || 'not_submitted',
    rejectionReason: d.rejectionReason || null,
  };
});

export const resubmitVerification = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  requireFields(data, ['idDocumentUrl']);

  const userId = context.auth.uid;
  const existing = await db.collection('verificationDocs').doc(userId).get();
  if (!existing.exists || existing.data()?.status !== 'rejected') {
    throw new functions.https.HttpsError('failed-precondition', 'Resubmission is only allowed after a rejection');
  }

  await db.collection('verificationDocs').doc(userId).update({
    idDocumentUrl: data.idDocumentUrl,
    addressProofUrl: data.addressProofUrl || null,
    status: 'pending',
    resubmittedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db.collection('companions').doc(userId).update({
    verificationStatus: 'pending',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});
