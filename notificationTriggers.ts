import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

// Central push-sending point. Every other module (bookingTriggers,
// authTriggers, sosApi, adminApi, etc) writes a 'notifications' Firestore
// doc and this trigger is solely responsible for turning that into an FCM
// push. This avoids the earlier pattern where several files each called
// admin.messaging().send() directly with slightly different payload shapes.
export const onNotificationCreated = functions.firestore
  .document('notifications/{notificationId}')
  .onCreate(async (snap) => {
    const notification = snap.data();
    if (!notification?.userId) return;

    const userDoc = await db.collection('users').doc(notification.userId).get();
    const fcmToken = userDoc.data()?.fcmToken;
    const notificationsEnabled = userDoc.data()?.settings?.notificationsEnabled !== false;

    if (!fcmToken || !notificationsEnabled) return;

    try {
      await admin.messaging().send({
        token: fcmToken,
        notification: {
          title: notification.title,
          body: notification.body,
        },
        data: Object.fromEntries(
          Object.entries({ type: notification.type, ...(notification.data || {}) })
            .map(([k, v]) => [k, String(v)])
        ),
        android: {
          priority: notification.type?.startsWith('sos') ? 'high' : 'normal',
          notification: { channelId: 'buddyconnect_notifications', sound: 'default' },
        },
        apns: {
          payload: { aps: { sound: 'default' } },
        },
      });
    } catch (error: any) {
      // Invalid/expired token - clear it so we stop retrying against it.
      if (error.code === 'messaging/registration-token-not-registered') {
        await db.collection('users').doc(notification.userId).update({ fcmToken: null });
      } else {
        console.error('Push send failed:', error);
      }
    }
  });

// Booking reminder: runs every 15 minutes, finds accepted/confirmed
// bookings starting in the next hour that haven't been reminded yet, and
// notifies both participants.
export const sendBookingReminders = functions.pubsub
  .schedule('every 15 minutes')
  .onRun(async () => {
    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

    const snapshot = await db.collection('bookings')
      .where('status', 'in', ['accepted', 'confirmed'])
      .where('startTime', '>=', admin.firestore.Timestamp.fromDate(now))
      .where('startTime', '<=', admin.firestore.Timestamp.fromDate(oneHourFromNow))
      .where('reminderSent', '==', false)
      .get();

    const batch = db.batch();

    for (const doc of snapshot.docs) {
      const booking = doc.data();

      batch.set(db.collection('notifications').doc(), {
        userId: booking.userId,
        title: 'Upcoming Booking',
        body: `Your ${booking.category} booking with ${booking.companionName} starts soon`,
        type: 'booking_reminder',
        data: { bookingId: doc.id },
        isRead: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      batch.set(db.collection('notifications').doc(), {
        userId: booking.companionId,
        title: 'Upcoming Booking',
        body: `Your ${booking.category} booking with ${booking.userName} starts soon`,
        type: 'booking_reminder',
        data: { bookingId: doc.id },
        isRead: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      batch.update(doc.ref, { reminderSent: true });
    }

    await batch.commit();
    console.log(`Sent reminders for ${snapshot.size} bookings`);
  });
