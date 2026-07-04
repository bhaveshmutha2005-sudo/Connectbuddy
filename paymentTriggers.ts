import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

// Notify the user whenever a transaction posts to their wallet, so they get
// a receipt-style notification independent of whichever flow created it
// (top-up, refund, earning, withdrawal, booking payment).
export const onTransactionCreated = functions.firestore
  .document('transactions/{transactionId}')
  .onCreate(async (snap) => {
    const tx = snap.data();
    if (!tx?.userId) return;

    const labels: Record<string, string> = {
      wallet_topup: 'Wallet top-up successful',
      withdrawal: 'Withdrawal requested',
      refund: 'Refund credited',
      earning: 'Earnings credited',
      payment: 'Payment made',
    };

    await db.collection('notifications').add({
      userId: tx.userId,
      title: labels[tx.type] || 'Wallet update',
      body: `${tx.amount >= 0 ? '+' : ''}${tx.currency || 'INR'} ${Math.abs(tx.amount).toFixed(2)} - ${tx.description || ''}`,
      type: 'wallet_transaction',
      data: { transactionId: snap.id },
      isRead: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

// Withdrawal requests are created with status 'pending' by
// paymentApi.withdrawFromWallet and are expected to be actioned by an admin
// (bank transfer, payout API, etc) - this trigger just notifies admins so
// nothing sits unnoticed.
export const onWithdrawalRequested = functions.firestore
  .document('transactions/{transactionId}')
  .onCreate(async (snap) => {
    const tx = snap.data();
    if (tx?.type !== 'withdrawal') return;

    const admins = await db.collection('users').where('role', 'in', ['admin', 'superAdmin']).get();
    const batch = db.batch();
    admins.docs.forEach((adminDoc) => {
      batch.set(db.collection('notifications').doc(), {
        userId: adminDoc.id,
        title: 'New Withdrawal Request',
        body: `A withdrawal of ${tx.currency || 'INR'} ${Math.abs(tx.amount).toFixed(2)} needs processing`,
        type: 'withdrawal_admin',
        data: { transactionId: snap.id, userId: tx.userId },
        isRead: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
  });

// Cleanup: Razorpay/Stripe orders that were created but never completed
// (user abandoned checkout) sit as 'created'/'pending' forever otherwise.
// Marks anything older than 1 hour as 'expired' so it stops showing as an
// open order in the admin payment dashboard.
export const expireStalePaymentOrders = functions.pubsub
  .schedule('every 1 hours')
  .onRun(async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const [staleOrders, staleIntents] = await Promise.all([
      db.collection('paymentOrders')
        .where('status', '==', 'created')
        .where('createdAt', '<', admin.firestore.Timestamp.fromDate(oneHourAgo))
        .limit(200).get(),
      db.collection('paymentIntents')
        .where('status', '==', 'pending')
        .where('createdAt', '<', admin.firestore.Timestamp.fromDate(oneHourAgo))
        .limit(200).get(),
    ]);

    const batch = db.batch();
    staleOrders.docs.forEach((d) => batch.update(d.ref, { status: 'expired' }));
    staleIntents.docs.forEach((d) => batch.update(d.ref, { status: 'expired' }));
    await batch.commit();

    console.log(`Expired ${staleOrders.size} orders and ${staleIntents.size} payment intents`);
  });
