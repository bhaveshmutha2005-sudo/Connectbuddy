import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

// Note: applying a referral code lives in authTriggers.ts (applyReferralCode)
// since it's tied to new-user onboarding logic. This file covers viewing
// referral info.

export const getMyReferralCode = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');

  const doc = await db.collection('users').doc(context.auth.uid).get();
  const referralCode = doc.data()?.referralCode;
  if (!referralCode) throw new functions.https.HttpsError('not-found', 'No referral code found');

  return { referralCode, shareMessage: `Join me on BuddyConnect and get Rs.100! Use my code ${referralCode} when you sign up.` };
});

export const getReferralStats = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');

  const userId = context.auth.uid;
  const referredUsersSnap = await db.collection('users').where('referredBy', '==', userId).get();

  const referredUsers = referredUsersSnap.docs.map((d) => ({
    id: d.id,
    displayName: d.data().displayName,
    joinedAt: d.data().createdAt,
  }));

  // Referral bonus is a fixed Rs.100 per successful referral, credited
  // directly to the wallet in authTriggers.applyReferralCode (no separate
  // transaction record is written there), so we compute it from the count.
  const totalReferralEarnings = referredUsers.length * 100;

  return {
    totalReferrals: referredUsers.length,
    totalReferralEarnings,
    referredUsers,
  };
});
