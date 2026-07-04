import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

// Get admin dashboard stats
export const getAdminStats = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }

  // Verify admin role
  const userDoc = await db.collection('users').doc(context.auth.uid).get();
  const userData = userDoc.data();

  if (!userData || !['admin', 'superAdmin'].includes(userData.role)) {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required');
  }

  const [
    usersCount,
    companionsCount,
    bookingsCount,
    pendingVerifications,
    pendingReports,
    todayBookings,
  ] = await Promise.all([
    db.collection('users').count().get(),
    db.collection('companions').where('isActive', '==', true).count().get(),
    db.collection('bookings').count().get(),
    db.collection('verificationDocs').where('status', '==', 'pending').count().get(),
    db.collection('reports').where('status', '==', 'pending').count().get(),
    db.collection('bookings')
      .where('createdAt', '>=', new Date(Date.now() - 24 * 60 * 60 * 1000))
      .count().get(),
  ]);

  return {
    totalUsers: usersCount.data().count,
    activeCompanions: companionsCount.data().count,
    totalBookings: bookingsCount.data().count,
    pendingVerifications: pendingVerifications.data().count,
    pendingReports: pendingReports.data().count,
    todayBookings: todayBookings.data().count,
  };
});

// Admin: Block/Unblock user
export const adminBlockUser = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }

  const userDoc = await db.collection('users').doc(context.auth.uid).get();
  if (!['admin', 'superAdmin'].includes(userDoc.data()?.role)) {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required');
  }

  const { userId, action, reason } = data;

  await db.collection('users').doc(userId).update({
    isBlocked: action === 'block',
    isActive: action !== 'block',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db.collection('adminLogs').add({
    adminId: context.auth.uid,
    action: `${action}_user`,
    targetUserId: userId,
    reason: reason,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, message: `User ${action}ed successfully` };
});

// Admin: Get all users with pagination
export const adminGetUsers = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }

  const userDoc = await db.collection('users').doc(context.auth.uid).get();
  if (!['admin', 'superAdmin'].includes(userDoc.data()?.role)) {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required');
  }

  const { limit = 50, lastDocId, searchQuery } = data;

  let query = db.collection('users').orderBy('createdAt', 'desc').limit(limit);

  if (lastDocId) {
    const lastDoc = await db.collection('users').doc(lastDocId).get();
    if (lastDoc.exists) {
      query = query.startAfter(lastDoc);
    }
  }

  const snapshot = await query.get();
  const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  return { users, hasMore: users.length === limit };
});

// Admin: Approve/Reject companion verification
export const adminVerifyCompanion = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }

  const userDoc = await db.collection('users').doc(context.auth.uid).get();
  if (!['admin', 'superAdmin'].includes(userDoc.data()?.role)) {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required');
  }

  const { companionId, status, notes } = data;

  await db.runTransaction(async (transaction) => {
    transaction.update(db.collection('companions').doc(companionId), {
      verificationStatus: status,
      isVerified: status === 'approved',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    transaction.update(db.collection('users').doc(companionId), {
      isCompanion: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    transaction.set(db.collection('adminLogs').doc(), {
      adminId: context.auth.uid,
      action: `companion_${status}`,
      targetCompanionId: companionId,
      notes: notes,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  // Send notification to companion
  await db.collection('notifications').add({
    userId: companionId,
    title: `Verification ${status === 'approved' ? 'Approved' : 'Rejected'}`,
    body: status === 'approved' 
      ? 'Your companion profile has been verified! You can now accept bookings.'
      : 'Your verification was rejected. Please review and resubmit.',
    type: 'verification_update',
    isRead: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});
