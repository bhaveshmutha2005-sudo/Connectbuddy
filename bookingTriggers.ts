import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

export const onBookingCreated = functions.firestore
  .document('bookings/{bookingId}')
  .onCreate(async (snap, context) => {
    const booking = snap.data();
    const bookingId = context.params.bookingId;

    await db.collection('notifications').add({
      userId: booking.companionId,
      title: 'New Booking Request',
      body: `${booking.userName} requested a ${booking.category} booking`,
      type: 'booking_request',
      data: { bookingId: bookingId },
      isRead: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    // Note: the actual push send now happens centrally in
    // notificationTriggers.onNotificationCreated, which fires whenever any
    // 'notifications' doc (like the one above) is created. Sending it again
    // here directly would double-notify the companion.

    await db.collection('chats').doc(bookingId).set({
      id: bookingId,
      participants: [booking.userId, booking.companionId],
      bookingId: bookingId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastMessage: null,
      lastMessageTime: null,
      lastMessageSenderId: null,
      isActive: true,
    });

    console.log(`Booking created: ${bookingId}`);
  });

export const onBookingUpdated = functions.firestore
  .document('bookings/{bookingId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    const bookingId = context.params.bookingId;

    if (before.status === after.status) return;

    switch (after.status) {
      case 'accepted':
        await db.collection('notifications').add({
          userId: after.userId,
          title: 'Booking Accepted',
          body: `${after.companionName} accepted your ${after.category} booking`,
          type: 'booking_accepted',
          data: { bookingId },
          isRead: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        break;

      case 'rejected':
        await db.collection('notifications').add({
          userId: after.userId,
          title: 'Booking Rejected',
          body: `${after.companionName} declined your booking request`,
          type: 'booking_rejected',
          data: { bookingId },
          isRead: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        if (after.paymentStatus === 'completed') {
          await processRefund(bookingId, after.totalAmount, 'Booking rejected by companion');
        }
        break;

      case 'confirmed':
        await db.collection('notifications').add({
          userId: after.userId,
          title: 'Booking Confirmed',
          body: `Your ${after.category} booking is confirmed!`,
          type: 'booking_confirmed',
          data: { bookingId },
          isRead: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        break;

      case 'completed':
        // Was `after.amount` - that field doesn't exist on the booking doc
        // (schema uses `totalAmount` everywhere else), so companions were
        // being paid NaN/0 on every completed booking.
        await processCompanionPayment(bookingId, after.companionId, after.totalAmount);
        await db.collection('notifications').add({
          userId: after.userId,
          title: 'Rate Your Experience',
          body: `How was your time with ${after.companionName}?`,
          type: 'review_request',
          data: { bookingId, companionId: after.companionId },
          isRead: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        break;

      case 'cancelled':
        const cancellationTime = new Date();
        const bookingTime = after.startTime.toDate();
        const hoursDiff = (bookingTime.getTime() - cancellationTime.getTime()) / (1000 * 60 * 60);
        let refundPercent = 0;
        if (hoursDiff >= 24) refundPercent = 1.0;
        else if (hoursDiff >= 12) refundPercent = 0.75;
        else if (hoursDiff >= 6) refundPercent = 0.5;
        else if (hoursDiff >= 2) refundPercent = 0.25;
        const refundAmount = after.totalAmount * refundPercent;
        if (refundAmount > 0) {
          await processRefund(bookingId, refundAmount, `Cancelled ${hoursDiff.toFixed(1)} hours before booking`);
        }
        break;
    }

    console.log(`Booking ${bookingId} status: ${before.status} -> ${after.status}`);
  });

async function processRefund(bookingId: string, amount: number, reason: string) {
  const bookingRef = db.collection('bookings').doc(bookingId);
  const booking = await bookingRef.get();
  const bookingData = booking.data();
  if (!bookingData) return;

  await db.runTransaction(async (transaction) => {
    transaction.update(bookingRef, {
      refundAmount: amount,
      refundStatus: 'completed',
      refundedAt: admin.firestore.FieldValue.serverTimestamp(),
      paymentStatus: amount >= bookingData.totalAmount ? 'refunded' : 'partially_refunded',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    transaction.update(db.collection('wallets').doc(bookingData.userId), {
      balance: admin.firestore.FieldValue.increment(amount),
      totalRefunded: admin.firestore.FieldValue.increment(amount),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    transaction.set(db.collection('transactions').doc(), {
      walletId: bookingData.userId,
      userId: bookingData.userId,
      type: 'refund',
      amount: amount,
      currency: 'INR',
      status: 'completed',
      description: `Refund for booking ${bookingId}: ${reason}`,
      bookingId: bookingId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
}

async function processCompanionPayment(bookingId: string, companionId: string, amount: number) {
  const platformFee = amount * 0.15;
  const companionEarnings = amount - platformFee;

  await db.runTransaction(async (transaction) => {
    transaction.update(db.collection('wallets').doc(companionId), {
      balance: admin.firestore.FieldValue.increment(companionEarnings),
      totalEarned: admin.firestore.FieldValue.increment(companionEarnings),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    transaction.set(db.collection('transactions').doc(), {
      walletId: companionId,
      userId: companionId,
      type: 'earning',
      amount: companionEarnings,
      currency: 'INR',
      status: 'completed',
      description: `Earnings for booking ${bookingId}`,
      bookingId: bookingId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    transaction.update(db.collection('companions').doc(companionId), {
      totalBookings: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
}
