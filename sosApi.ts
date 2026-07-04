import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

// SOS Alert Handler
export const handleSOSAlert = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }

  const { latitude, longitude, bookingId } = data;
  const userId = context.auth.uid;

  // Create SOS log
  const sosLog = await db.collection('sosLogs').add({
    userId,
    latitude,
    longitude,
    bookingId: bookingId || null,
    status: 'active',
    resolved: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Get user details
  const userDoc = await db.collection('users').doc(userId).get();
  const userData = userDoc.data();

  // Notify emergency contacts
  const emergencyContacts = userData?.emergencyContacts || [];
  for (const contact of emergencyContacts) {
    if (contact['userId']) {
      await db.collection('notifications').add({
        userId: contact['userId'],
        title: 'EMERGENCY SOS ALERT',
        body: `${userData?.displayName || 'Your contact'} triggered an SOS alert!`,
        type: 'sos',
        data: {
          sosId: sosLog.id,
          latitude,
          longitude,
          mapsUrl: `https://maps.google.com/?q=${latitude},${longitude}`,
        },
        isRead: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }

  // Notify admins
  const admins = await db.collection('users').where('role', 'in', ['admin', 'superAdmin']).get();
  for (const adminDoc of admins.docs) {
    await db.collection('notifications').add({
      userId: adminDoc.id,
      title: 'SOS ALERT TRIGGERED',
      body: `User ${userData?.displayName || userId} triggered SOS at ${latitude}, ${longitude}`,
      type: 'sos_admin',
      data: {
        sosId: sosLog.id,
        userId,
        latitude,
        longitude,
      },
      isRead: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  return { success: true, sosId: sosLog.id };
});

// Resolve SOS Alert
export const resolveSOSAlert = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }

  const { sosId, resolution } = data;

  const sosRef = db.collection('sosLogs').doc(sosId);
  const sosDoc = await sosRef.get();
  const sosData = sosDoc.data();

  if (!sosData) {
    throw new functions.https.HttpsError('not-found', 'SOS alert not found');
  }

  // Only the user who triggered the SOS, or an admin, may resolve it.
  // Previously any authenticated user who knew/guessed the sosId could
  // dismiss someone else's active emergency alert.
  const callerId = context.auth.uid;
  if (sosData.userId !== callerId) {
    const callerDoc = await db.collection('users').doc(callerId).get();
    const role = callerDoc.data()?.role;
    if (!['admin', 'superAdmin'].includes(role)) {
      throw new functions.https.HttpsError('permission-denied', 'Not authorized to resolve this alert');
    }
  }

  await sosRef.update({
    status: 'resolved',
    resolved: true,
    resolution: resolution || 'Resolved by user',
    resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
    resolvedBy: callerId,
  });

  return { success: true };
});

// Live Location Sharing
export const updateLiveLocation = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }

  const { bookingId, latitude, longitude } = data;
  const userId = context.auth.uid;

  // Only a participant on this booking may update its live location.
  // Previously any authenticated user could overwrite any booking's location.
  const bookingDoc = await db.collection('bookings').doc(bookingId).get();
  const bookingData = bookingDoc.data();
  if (!bookingData || (bookingData.userId !== userId && bookingData.companionId !== userId)) {
    throw new functions.https.HttpsError('permission-denied', 'Not a participant on this booking');
  }

  // Update booking with live location
  await db.collection('bookings').doc(bookingId).update({
    'liveLocation': {
      userId,
      latitude,
      longitude,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});

// Safety Check - Validate meeting location
export const validateMeetingLocation = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }

  const { location, latitude, longitude } = data;

  // Check if location contains unsafe keywords
  const unsafeKeywords = ['hotel', 'motel', 'private room', 'bedroom', 'apartment', 'home', 'residence'];
  const isUnsafe = unsafeKeywords.some(keyword => 
    location.toLowerCase().includes(keyword)
  );

  if (isUnsafe) {
    throw new functions.https.HttpsError('invalid-argument', 
      'Meeting location must be a public place. Private rooms, hotels, and residences are not allowed for safety reasons.');
  }

  // Suggest nearby safe public places (simplified)
  const safeSuggestions = [
    'Starbucks Coffee - Main Street',
    'Central Park - Entrance Gate',
    'City Mall - Food Court',
    'Public Library - Main Hall',
    'Community Center - Lobby',
  ];

  return {
    isSafe: true,
    suggestions: safeSuggestions,
  };
});
