import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { requireFields, sanitizeString, validateCoordinates } from '../middleware/validationMiddleware';

const db = admin.firestore();

export const registerCompanion = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  requireFields(data, ['categories', 'bio', 'languages']);

  const { categories, bio, languages, skills = [], pricing = {} } = data;
  const userId = context.auth.uid;

  const existing = await db.collection('companions').doc(userId).get();
  if (existing.exists) {
    throw new functions.https.HttpsError('already-exists', 'Companion profile already exists');
  }

  const userDoc = await db.collection('users').doc(userId).get();
  const userData = userDoc.data();

  await db.collection('companions').doc(userId).set({
    id: userId,
    userId,
    displayName: userData?.displayName || 'Companion',
    photoUrl: userData?.photoUrl || null,
    categories,
    bio: sanitizeString(bio, 1000),
    languages,
    skills,
    pricing, // { hourlyRate, halfDayRate, fullDayRate }
    rating: 0,
    totalReviews: 0,
    totalBookings: 0,
    isActive: true,
    isVerified: false,
    isAvailable: false,
    verificationStatus: 'pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, message: 'Companion profile created. Submit verification documents to start accepting bookings.' };
});

export const updateCompanionProfile = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');

  const allowed = ['bio', 'categories', 'languages', 'skills', 'pricing', 'photoUrl'];
  const updates: Record<string, any> = {};
  for (const key of allowed) {
    if (data[key] !== undefined) updates[key] = typeof data[key] === 'string' ? sanitizeString(data[key], 1000) : data[key];
  }
  if (Object.keys(updates).length === 0) {
    throw new functions.https.HttpsError('invalid-argument', 'No valid fields to update');
  }

  updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
  await db.collection('companions').doc(context.auth.uid).update(updates);
  return { success: true };
});

// Availability calendar: array of { date: 'YYYY-MM-DD', slots: [{start, end}] }
export const updateAvailability = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  requireFields(data, ['availability']);

  await db.collection('companions').doc(context.auth.uid).update({
    availability: data.availability,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { success: true };
});

export const toggleOnlineStatus = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  requireFields(data, ['isAvailable']);

  const companionDoc = await db.collection('companions').doc(context.auth.uid).get();
  const companion = companionDoc.data();
  if (!companion) throw new functions.https.HttpsError('not-found', 'Companion profile not found');
  if (!companion.isVerified) {
    throw new functions.https.HttpsError('failed-precondition', 'Complete verification before going online');
  }

  await db.collection('companions').doc(context.auth.uid).update({
    isAvailable: !!data.isAvailable,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { success: true };
});

// Simple bounding-box distance filter (no external geo library dependency).
// Good enough for city-scale "nearby" search; swap for GeoFirestore/geohash
// if you need to shard across very large datasets.
const kmBetween = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const searchCompanions = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');

  const {
    category, minPrice, maxPrice, minRating, language,
    latitude, longitude, radiusKm = 25, limit = 20,
  } = data;

  let query: FirebaseFirestore.Query = db.collection('companions')
    .where('isActive', '==', true)
    .where('isVerified', '==', true);

  if (category) query = query.where('categories', 'array-contains', category);

  const snapshot = await query.limit(200).get();
  let results = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as any));

  if (minPrice !== undefined) results = results.filter((c) => (c.pricing?.hourlyRate || 0) >= minPrice);
  if (maxPrice !== undefined) results = results.filter((c) => (c.pricing?.hourlyRate || 0) <= maxPrice);
  if (minRating !== undefined) results = results.filter((c) => (c.rating || 0) >= minRating);
  if (language) results = results.filter((c) => c.languages?.includes(language));

  if (latitude !== undefined && longitude !== undefined) {
    validateCoordinates(latitude, longitude);
    results = results
      .filter((c) => c.currentLocation?.latitude !== undefined)
      .map((c) => ({ ...c, distanceKm: kmBetween(latitude, longitude, c.currentLocation.latitude, c.currentLocation.longitude) }))
      .filter((c: any) => c.distanceKm <= radiusKm)
      .sort((a: any, b: any) => a.distanceKm - b.distanceKm);
  } else {
    results = results.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  }

  return { companions: results.slice(0, Math.min(limit, 100)) };
});

export const getCompanionDetails = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  requireFields(data, ['companionId']);

  const doc = await db.collection('companions').doc(data.companionId).get();
  if (!doc.exists) throw new functions.https.HttpsError('not-found', 'Companion not found');

  const reviewsSnap = await db.collection('reviews')
    .where('companionId', '==', data.companionId)
    .orderBy('createdAt', 'desc')
    .limit(10)
    .get();

  return {
    companion: { id: doc.id, ...doc.data() },
    recentReviews: reviewsSnap.docs.map((r) => ({ id: r.id, ...r.data() })),
  };
});

export const addToFavorites = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  requireFields(data, ['companionId']);

  await db.collection('users').doc(context.auth.uid)
    .collection('favorites').doc(data.companionId)
    .set({ companionId: data.companionId, createdAt: admin.firestore.FieldValue.serverTimestamp() });

  return { success: true };
});

export const removeFromFavorites = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  requireFields(data, ['companionId']);

  await db.collection('users').doc(context.auth.uid)
    .collection('favorites').doc(data.companionId)
    .delete();

  return { success: true };
});

export const getFavorites = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');

  const favSnap = await db.collection('users').doc(context.auth.uid).collection('favorites').get();
  const companionIds = favSnap.docs.map((d) => d.id);
  if (companionIds.length === 0) return { companions: [] };

  const chunks = [];
  for (let i = 0; i < companionIds.length; i += 10) chunks.push(companionIds.slice(i, i + 10));

  const results: any[] = [];
  for (const chunk of chunks) {
    const snap = await db.collection('companions').where(admin.firestore.FieldPath.documentId(), 'in', chunk).get();
    results.push(...snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }

  return { companions: results };
});

// Reviews can only be submitted for the user's own completed bookings, and
// only once per booking - both enforced here to prevent rating manipulation.
export const submitReview = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  requireFields(data, ['bookingId', 'rating']);

  const { bookingId, rating, comment = '' } = data;
  if (rating < 1 || rating > 5) {
    throw new functions.https.HttpsError('invalid-argument', 'Rating must be between 1 and 5');
  }

  const bookingDoc = await db.collection('bookings').doc(bookingId).get();
  const booking = bookingDoc.data();
  if (!booking) throw new functions.https.HttpsError('not-found', 'Booking not found');
  if (booking.userId !== context.auth.uid) {
    throw new functions.https.HttpsError('permission-denied', 'Only the customer can review this booking');
  }
  if (booking.status !== 'completed') {
    throw new functions.https.HttpsError('failed-precondition', 'You can only review completed bookings');
  }

  const existingReview = await db.collection('reviews').doc(bookingId).get();
  if (existingReview.exists) {
    throw new functions.https.HttpsError('already-exists', 'You already reviewed this booking');
  }

  await db.runTransaction(async (transaction) => {
    const companionRef = db.collection('companions').doc(booking.companionId);
    const companionSnap = await transaction.get(companionRef);
    const companion = companionSnap.data();
    if (!companion) throw new functions.https.HttpsError('not-found', 'Companion not found');

    const newTotalReviews = (companion.totalReviews || 0) + 1;
    const newRating = ((companion.rating || 0) * (companion.totalReviews || 0) + rating) / newTotalReviews;

    transaction.set(db.collection('reviews').doc(bookingId), {
      bookingId,
      userId: context.auth!.uid,
      companionId: booking.companionId,
      rating,
      comment: sanitizeString(comment, 1000),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    transaction.update(companionRef, {
      rating: Math.round(newRating * 100) / 100,
      totalReviews: newTotalReviews,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return { success: true };
});
