import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { calculateBookingAmount } from '../services/paymentService';
import { requireFields, validatePublicLocation, validateCoordinates } from '../middleware/validationMiddleware';

const db = admin.firestore();

// Creates a booking in 'pending' status. Payment is expected to already be
// authorized (wallet balance sufficient, or a payment order verified) before
// this is called from the client - createBooking does not move money itself,
// it just checks the user can cover the cost and reserves the wallet amount
// for wallet payments. Card/UPI payments are confirmed separately via
// paymentApi.verifyRazorpayPayment / the Stripe webhook, which then flips
// paymentStatus to 'completed'.
export const createBooking = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }

  requireFields(data, ['companionId', 'category', 'durationType', 'startTime', 'meetingLocation', 'paymentMethod']);
  const { companionId, category, durationType, hours = 1, startTime, meetingLocation, latitude, longitude, paymentMethod, isInstant = false } = data;

  validatePublicLocation(meetingLocation);
  if (latitude !== undefined && longitude !== undefined) validateCoordinates(latitude, longitude);

  const userId = context.auth.uid;

  const [userDoc, companionDoc] = await Promise.all([
    db.collection('users').doc(userId).get(),
    db.collection('companions').doc(companionId).get(),
  ]);

  const userData = userDoc.data();
  const companionData = companionDoc.data();

  if (!companionData || !companionData.isActive || !companionData.isVerified) {
    throw new functions.https.HttpsError('failed-precondition', 'Companion is not available for booking');
  }
  if (!companionData.categories?.includes(category)) {
    throw new functions.https.HttpsError('invalid-argument', 'Companion does not offer this category');
  }
  if (isInstant && !companionData.isAvailable) {
    throw new functions.https.HttpsError('failed-precondition', 'Companion is not online for instant booking');
  }

  // Check caller hasn't blocked / been blocked by this companion
  const blockedDoc = await db.collection('users').doc(userId).collection('blockedUsers').doc(companionData.userId || companionId).get();
  if (blockedDoc.exists) {
    throw new functions.https.HttpsError('failed-precondition', 'You have blocked this companion');
  }

  const totalAmount = calculateBookingAmount(companionData.pricing || {}, durationType, hours);

  const bookingRef = db.collection('bookings').doc();
  const bookingData = {
    id: bookingRef.id,
    userId,
    userName: userData?.displayName || 'User',
    companionId,
    companionName: companionData.displayName || 'Companion',
    category,
    durationType,
    hours,
    startTime: admin.firestore.Timestamp.fromDate(new Date(startTime)),
    meetingLocation,
    latitude: latitude || null,
    longitude: longitude || null,
    totalAmount,
    currency: 'INR',
    isInstant,
    status: 'pending',
    paymentStatus: paymentMethod === 'wallet' ? 'pending' : 'awaiting_payment',
    paymentMethod,
    reminderSent: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (paymentMethod === 'wallet') {
    // Reserve funds atomically so the user can't spend the same balance twice
    // across two bookings created back-to-back.
    await db.runTransaction(async (transaction) => {
      const walletRef = db.collection('wallets').doc(userId);
      const walletSnap = await transaction.get(walletRef);
      const wallet = walletSnap.data();

      if (!wallet || wallet.balance < totalAmount) {
        throw new functions.https.HttpsError('failed-precondition', 'Insufficient wallet balance');
      }

      transaction.update(walletRef, {
        balance: admin.firestore.FieldValue.increment(-totalAmount),
        totalSpent: admin.firestore.FieldValue.increment(totalAmount),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      transaction.set(bookingRef, { ...bookingData, paymentStatus: 'completed' });
      transaction.set(db.collection('transactions').doc(), {
        walletId: userId,
        userId,
        type: 'payment',
        amount: -totalAmount,
        currency: 'INR',
        status: 'completed',
        description: `Payment for ${category} booking`,
        bookingId: bookingRef.id,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
  } else {
    await bookingRef.set(bookingData);
  }

  return { success: true, bookingId: bookingRef.id, totalAmount };
});

const assertParticipant = (booking: any, uid: string) => {
  if (booking.userId !== uid && booking.companionId !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not a participant on this booking');
  }
};

export const acceptBooking = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  requireFields(data, ['bookingId']);

  const bookingRef = db.collection('bookings').doc(data.bookingId);
  const bookingDoc = await bookingRef.get();
  const booking = bookingDoc.data();
  if (!booking) throw new functions.https.HttpsError('not-found', 'Booking not found');
  if (booking.companionId !== context.auth.uid) {
    throw new functions.https.HttpsError('permission-denied', 'Only the companion can accept this booking');
  }
  if (booking.status !== 'pending') {
    throw new functions.https.HttpsError('failed-precondition', `Booking is already ${booking.status}`);
  }

  await bookingRef.update({ status: 'accepted', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  return { success: true };
});

export const rejectBooking = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  requireFields(data, ['bookingId']);

  const bookingRef = db.collection('bookings').doc(data.bookingId);
  const bookingDoc = await bookingRef.get();
  const booking = bookingDoc.data();
  if (!booking) throw new functions.https.HttpsError('not-found', 'Booking not found');
  if (booking.companionId !== context.auth.uid) {
    throw new functions.https.HttpsError('permission-denied', 'Only the companion can reject this booking');
  }
  if (!['pending', 'accepted'].includes(booking.status)) {
    throw new functions.https.HttpsError('failed-precondition', `Booking is already ${booking.status}`);
  }

  await bookingRef.update({
    status: 'rejected',
    rejectionReason: data.reason || null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { success: true };
});

export const cancelBooking = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  requireFields(data, ['bookingId']);

  const bookingRef = db.collection('bookings').doc(data.bookingId);
  const bookingDoc = await bookingRef.get();
  const booking = bookingDoc.data();
  if (!booking) throw new functions.https.HttpsError('not-found', 'Booking not found');
  assertParticipant(booking, context.auth.uid);

  if (['completed', 'cancelled', 'rejected'].includes(booking.status)) {
    throw new functions.https.HttpsError('failed-precondition', `Booking is already ${booking.status}`);
  }

  // Refund tiers are computed in bookingTriggers.onBookingUpdated once
  // status flips to 'cancelled', so this just performs the status change.
  await bookingRef.update({
    status: 'cancelled',
    cancelledBy: context.auth.uid,
    cancellationReason: data.reason || null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { success: true };
});

export const rescheduleBooking = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  requireFields(data, ['bookingId', 'newStartTime']);

  const bookingRef = db.collection('bookings').doc(data.bookingId);
  const bookingDoc = await bookingRef.get();
  const booking = bookingDoc.data();
  if (!booking) throw new functions.https.HttpsError('not-found', 'Booking not found');
  assertParticipant(booking, context.auth.uid);

  if (!['pending', 'accepted', 'confirmed'].includes(booking.status)) {
    throw new functions.https.HttpsError('failed-precondition', 'This booking can no longer be rescheduled');
  }

  await bookingRef.update({
    startTime: admin.firestore.Timestamp.fromDate(new Date(data.newStartTime)),
    status: 'pending', // requires re-acceptance from the companion after reschedule
    rescheduledFrom: booking.startTime,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db.collection('notifications').add({
    userId: booking.companionId === context.auth.uid ? booking.userId : booking.companionId,
    title: 'Booking Rescheduled',
    body: `The booking has been rescheduled and needs to be re-confirmed.`,
    type: 'booking_rescheduled',
    data: { bookingId: data.bookingId },
    isRead: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});

// Extend an in-progress booking by additional hours (hourly bookings only).
// Charges the difference from the wallet immediately.
export const extendBooking = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  requireFields(data, ['bookingId', 'additionalHours']);

  const bookingRef = db.collection('bookings').doc(data.bookingId);
  const bookingDoc = await bookingRef.get();
  const booking = bookingDoc.data();
  if (!booking) throw new functions.https.HttpsError('not-found', 'Booking not found');
  if (booking.userId !== context.auth.uid) {
    throw new functions.https.HttpsError('permission-denied', 'Only the customer can extend a booking');
  }
  if (booking.durationType !== 'hourly') {
    throw new functions.https.HttpsError('failed-precondition', 'Only hourly bookings can be extended');
  }
  if (!['accepted', 'confirmed'].includes(booking.status)) {
    throw new functions.https.HttpsError('failed-precondition', 'Booking must be active to extend');
  }

  const companionDoc = await db.collection('companions').doc(booking.companionId).get();
  const hourlyRate = companionDoc.data()?.pricing?.hourlyRate;
  if (!hourlyRate) throw new functions.https.HttpsError('failed-precondition', 'Companion has no hourly rate set');

  const additionalHours = Number(data.additionalHours);
  const additionalAmount = Math.round(hourlyRate * additionalHours * 100) / 100;

  await db.runTransaction(async (transaction) => {
    const walletRef = db.collection('wallets').doc(context.auth!.uid);
    const walletSnap = await transaction.get(walletRef);
    const wallet = walletSnap.data();
    if (!wallet || wallet.balance < additionalAmount) {
      throw new functions.https.HttpsError('failed-precondition', 'Insufficient wallet balance to extend booking');
    }

    transaction.update(walletRef, {
      balance: admin.firestore.FieldValue.increment(-additionalAmount),
      totalSpent: admin.firestore.FieldValue.increment(additionalAmount),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    transaction.update(bookingRef, {
      hours: admin.firestore.FieldValue.increment(additionalHours),
      totalAmount: admin.firestore.FieldValue.increment(additionalAmount),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    transaction.set(db.collection('transactions').doc(), {
      walletId: context.auth!.uid,
      userId: context.auth!.uid,
      type: 'payment',
      amount: -additionalAmount,
      currency: 'INR',
      status: 'completed',
      description: `Booking extension (+${additionalHours}h)`,
      bookingId: data.bookingId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return { success: true, additionalAmount };
});

export const getBookingDetails = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  requireFields(data, ['bookingId']);

  const bookingDoc = await db.collection('bookings').doc(data.bookingId).get();
  const booking = bookingDoc.data();
  if (!booking) throw new functions.https.HttpsError('not-found', 'Booking not found');

  const userDoc = await db.collection('users').doc(context.auth.uid).get();
  const isAdmin = ['admin', 'superAdmin'].includes(userDoc.data()?.role);
  assertParticipant(booking, isAdmin ? booking.userId : context.auth.uid);

  return { booking: { id: bookingDoc.id, ...booking } };
});

export const getMyBookings = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');

  const { role = 'user', status, limit = 20 } = data;
  const field = role === 'companion' ? 'companionId' : 'userId';

  let query = db.collection('bookings').where(field, '==', context.auth.uid).orderBy('createdAt', 'desc').limit(Math.min(limit, 100));
  if (status) query = query.where('status', '==', status);

  const snapshot = await query.get();
  return { bookings: snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) };
});
