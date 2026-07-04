import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

// Send push notification to user
export const sendPushNotification = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }

  const { userId, title, body, data: payloadData } = data;

  // Only the platform (via other backend functions) or an admin should be
  // able to push a notification to an arbitrary user. Previously any
  // authenticated user could send any title/body to any other user,
  // which is an impersonation/spam vector. Callers pushing to themselves
  // are still allowed (e.g. "send me a test notification").
  if (userId !== context.auth.uid) {
    const callerDoc = await db.collection('users').doc(context.auth.uid).get();
    const role = callerDoc.data()?.role;
    if (!['admin', 'superAdmin'].includes(role)) {
      throw new functions.https.HttpsError('permission-denied', 'Not authorized to notify this user');
    }
  }

  const userDoc = await db.collection('users').doc(userId).get();
  const fcmToken = userDoc.data()?.fcmToken;

  if (!fcmToken) {
    return { success: false, message: 'User has no FCM token' };
  }

  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: {
        title,
        body,
      },
      data: payloadData || {},
      android: {
        priority: 'high',
        notification: {
          channelId: 'buddyconnect_notifications',
          sound: 'default',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    });

    return { success: true };
  } catch (error: any) {
    console.error('Failed to send notification:', error);
    return { success: false, message: error.message };
  }
});

// Send bulk notification to multiple users
export const sendBulkNotification = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }

  const userDoc = await db.collection('users').doc(context.auth.uid).get();
  if (!['admin', 'superAdmin'].includes(userDoc.data()?.role)) {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required');
  }

  const { userIds, title, body, data: payloadData } = data;

  const tokens: string[] = [];
  for (const userId of userIds) {
    const user = await db.collection('users').doc(userId).get();
    if (user.data()?.fcmToken) {
      tokens.push(user.data()!.fcmToken);
    }
  }

  if (tokens.length === 0) {
    return { success: false, message: 'No valid FCM tokens found' };
  }

  const message = {
    tokens,
    notification: { title, body },
    data: payloadData || {},
  };

  const response = await admin.messaging().sendEachForMulticast(message);

  return {
    success: true,
    sent: response.successCount,
    failed: response.failureCount,
  };
});

// Scheduled notification cleanup
export const cleanupOldNotifications = functions.pubsub
  .schedule('every 24 hours')
  .onRun(async (context) => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const oldNotifications = await db.collection('notifications')
      .where('createdAt', '<', admin.firestore.Timestamp.fromDate(thirtyDaysAgo))
      .where('isRead', '==', true)
      .limit(500)
      .get();

    const batch = db.batch();
    for (const doc of oldNotifications.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();

    console.log(`Cleaned up ${oldNotifications.size} old notifications`);
  });
