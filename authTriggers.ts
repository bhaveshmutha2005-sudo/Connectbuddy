import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { v4 as uuidv4 } from 'uuid';

const db = admin.firestore();

// Trigger when new user is created via Firebase Auth
export const onUserCreated = functions.auth.user().onCreate(async (user) => {
  const userRef = db.collection('users').doc(user.uid);

  const userData = {
    id: user.uid,
    email: user.email || '',
    phoneNumber: user.phoneNumber || null,
    displayName: user.displayName || 'User',
    photoUrl: user.photoURL || null,
    role: 'user',
    isEmailVerified: user.emailVerified,
    isPhoneVerified: !!user.phoneNumber,
    isCompanion: false,
    isActive: true,
    isBlocked: false,
    referralCode: uuidv4().substring(0, 8).toUpperCase(),
    referredBy: null,
    fcmToken: null,
    preferredLanguage: 'en',
    isDarkMode: false,
    settings: {
      notificationsEnabled: true,
      locationSharingEnabled: true,
      sosEnabled: true,
      autoAcceptBookings: false,
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await userRef.set(userData);

  // Create wallet for user
  const walletRef = db.collection('wallets').doc(user.uid);
  await walletRef.set({
    id: user.uid,
    userId: user.uid,
    balance: 0,
    totalEarned: 0,
    totalSpent: 0,
    totalRefunded: 0,
    currency: 'INR',
    isActive: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Send welcome notification
  await db.collection('notifications').add({
    userId: user.uid,
    title: 'Welcome to BuddyConnect!',
    body: 'Your account has been created successfully. Start exploring safe companionship options.',
    type: 'welcome',
    isRead: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`User created: ${user.uid}`);
});

// Trigger when user is deleted
export const onUserDeleted = functions.auth.user().onDelete(async (user) => {
  await db.collection('users').doc(user.uid).update({
    isActive: false,
    isBlocked: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const companionSnapshot = await db.collection('companions')
    .where('userId', '==', user.uid)
    .limit(1)
    .get();

  if (!companionSnapshot.empty) {
    await companionSnapshot.docs[0].ref.update({
      isActive: false,
      isAvailable: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  console.log(`User soft-deleted: ${user.uid}`);
});

// Handle referral code application
export const applyReferralCode = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { referralCode } = data;
  const userId = context.auth.uid;

  const referrerSnapshot = await db.collection('users')
    .where('referralCode', '==', referralCode.toUpperCase())
    .limit(1)
    .get();

  if (referrerSnapshot.empty) {
    throw new functions.https.HttpsError('not-found', 'Invalid referral code');
  }

  const referrer = referrerSnapshot.docs[0];
  const referrerId = referrer.id;

  if (referrerId === userId) {
    throw new functions.https.HttpsError('invalid-argument', 'Cannot use your own referral code');
  }

  // The referredBy check happens INSIDE the transaction (via transaction.get)
  // so two rapid calls can't both pass the check before either one commits
  // and double-claim the bonus.
  await db.runTransaction(async (transaction) => {
    const userRef = db.collection('users').doc(userId);
    const userSnap = await transaction.get(userRef);
    const userData = userSnap.data();

    if (userData?.referredBy) {
      throw new functions.https.HttpsError('already-exists', 'Referral code already applied');
    }

    transaction.update(userRef, {
      referredBy: referrerId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    transaction.update(db.collection('wallets').doc(referrerId), {
      balance: admin.firestore.FieldValue.increment(100),
      totalEarned: admin.firestore.FieldValue.increment(100),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    transaction.update(db.collection('wallets').doc(userId), {
      balance: admin.firestore.FieldValue.increment(100),
      totalEarned: admin.firestore.FieldValue.increment(100),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  await db.collection('notifications').add({
    userId: userId,
    title: 'Referral Bonus Applied',
    body: 'You received Rs.100 welcome bonus!',
    type: 'referral',
    isRead: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db.collection('notifications').add({
    userId: referrerId,
    title: 'Referral Bonus Earned',
    body: 'You earned Rs.100 for referring a new user!',
    type: 'referral',
    isRead: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, message: 'Referral applied successfully' };
});
