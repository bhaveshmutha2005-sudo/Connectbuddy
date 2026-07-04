import * as functions from 'firebase-functions';

// In-memory sliding-window rate limiter.
//
// LIMITATION: Cloud Functions can run many concurrent instances, and this
// Map is per-instance, so the effective limit under heavy concurrent load
// is (maxRequests * number_of_warm_instances), not a hard global cap. That's
// fine for abuse-deterrence on normal traffic. If you need a hard global
// limit (e.g. for OTP sending or payment creation), use
// checkFirestoreRateLimit below instead, which is slower but consistent
// across instances.
const rateLimits = new Map<string, { count: number; resetTime: number }>();

export const rateLimitMiddleware = (
  maxRequests: number = 100,
  windowMs: number = 60000
) => {
  return async (context: functions.https.CallableContext) => {
    const userId = context.auth?.uid;
    if (!userId) return;

    const now = Date.now();
    const userLimit = rateLimits.get(userId);

    if (!userLimit || now > userLimit.resetTime) {
      rateLimits.set(userId, { count: 1, resetTime: now + windowMs });
      return;
    }

    if (userLimit.count >= maxRequests) {
      throw new functions.https.HttpsError('resource-exhausted', 'Rate limit exceeded. Please try again shortly.');
    }

    userLimit.count++;
  };
};

// Firestore-backed rate limiter for sensitive, low-frequency, high-value
// actions (OTP send, payment order creation, SOS trigger) where you need a
// hard limit that holds even across different function instances.
import * as admin from 'firebase-admin';

export const checkFirestoreRateLimit = async (
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<void> => {
  const db = admin.firestore();
  const ref = db.collection('rateLimits').doc(key);
  const now = Date.now();

  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const data = snap.data();

    if (!data || now > data.resetTime) {
      transaction.set(ref, { count: 1, resetTime: now + windowSeconds * 1000 });
      return;
    }

    if (data.count >= maxRequests) {
      throw new functions.https.HttpsError(
        'resource-exhausted',
        `Too many requests. Please wait before trying again.`
      );
    }

    transaction.update(ref, { count: admin.firestore.FieldValue.increment(1) });
  });
};

// Cleanup job for stale rate limit docs (run daily)
export const cleanupRateLimits = functions.pubsub
  .schedule('every 24 hours')
  .onRun(async () => {
    const db = admin.firestore();
    const now = Date.now();
    const stale = await db.collection('rateLimits')
      .where('resetTime', '<', now)
      .limit(500)
      .get();

    const batch = db.batch();
    stale.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  });
