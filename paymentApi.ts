import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import Stripe from 'stripe';
import Razorpay from 'razorpay';

const db = admin.firestore();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-12-18.acacia' });
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || '',
  key_secret: process.env.RAZORPAY_KEY_SECRET || '',
});

// Create Stripe Payment Intent
export const createStripePaymentIntent = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { amount, currency = 'inr', bookingId, metadata = {} } = data;

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to smallest currency unit
      currency: currency.toLowerCase(),
      metadata: {
        userId: context.auth.uid,
        bookingId: bookingId || '',
        ...metadata,
      },
      automatic_payment_methods: { enabled: true },
    });

    // Store payment intent reference
    await db.collection('paymentIntents').doc(paymentIntent.id).set({
      id: paymentIntent.id,
      userId: context.auth.uid,
      bookingId: bookingId || null,
      amount: amount,
      currency: currency,
      status: 'pending',
      gateway: 'stripe',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    };
  } catch (error: any) {
    throw new functions.https.HttpsError('internal', error.message);
  }
});

// Create Razorpay Order
export const createRazorpayOrder = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { amount, currency = 'INR', bookingId, receipt, type = 'booking' } = data;

  if (!['booking', 'wallet_topup', 'subscription'].includes(type)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid order type');
  }

  try {
    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: currency,
      receipt: receipt || `receipt_${Date.now()}`,
      notes: {
        userId: context.auth.uid,
        bookingId: bookingId || '',
        type,
      },
    });

    // NOTE: `type` is required here - verifyRazorpayPayment relies on it to know
    // whether to credit a wallet top-up. Previously this field was never set,
    // so wallet top-ups were paid for but never credited.
    await db.collection('paymentOrders').doc(order.id).set({
      id: order.id,
      userId: context.auth.uid,
      bookingId: bookingId || null,
      amount: amount,
      currency: currency,
      status: 'created',
      gateway: 'razorpay',
      type,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
    };
  } catch (error: any) {
    throw new functions.https.HttpsError('internal', error.message);
  }
});

// Verify Razorpay Payment
export const verifyRazorpayPayment = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { orderId, paymentId, signature, bookingId } = data;

  try {
    const crypto = require('crypto');
    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    if (generatedSignature !== signature) {
      throw new Error('Invalid payment signature');
    }

    // Update payment status
    await db.collection('paymentOrders').doc(orderId).update({
      status: 'completed',
      paymentId: paymentId,
      signature: signature,
      verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Update booking payment status
    if (bookingId) {
      await db.collection('bookings').doc(bookingId).update({
        paymentStatus: 'completed',
        transactionId: paymentId,
        paymentMethod: 'razorpay',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // Process wallet top-up if applicable
    const orderDoc = await db.collection('paymentOrders').doc(orderId).get();
    const orderData = orderDoc.data();

    if (!orderData || orderData.userId !== context.auth.uid) {
      throw new functions.https.HttpsError('permission-denied', 'This order does not belong to you');
    }

    if (orderData.type === 'wallet_topup') {
      await db.collection('wallets').doc(orderData.userId).update({
        balance: admin.firestore.FieldValue.increment(orderData.amount),
        totalEarned: admin.firestore.FieldValue.increment(orderData.amount),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    return { success: true, message: 'Payment verified successfully' };
  } catch (error: any) {
    throw new functions.https.HttpsError('internal', error.message);
  }
});

// Stripe Webhook Handler
export const stripeWebhook = functions.https.onRequest(async (req, res) => {
  const sig = req.headers['stripe-signature'] as string;
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
  } catch (err: any) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      await handlePaymentSuccess(paymentIntent);
      break;

    case 'payment_intent.payment_failed':
      const failedPayment = event.data.object as Stripe.PaymentIntent;
      await handlePaymentFailure(failedPayment);
      break;

    case 'charge.refunded':
      const refund = event.data.object as Stripe.Charge;
      await handleRefund(refund);
      break;

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
});

async function handlePaymentSuccess(paymentIntent: Stripe.PaymentIntent) {
  const { userId, bookingId } = paymentIntent.metadata;

  await db.collection('paymentIntents').doc(paymentIntent.id).update({
    status: 'completed',
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  if (bookingId) {
    await db.collection('bookings').doc(bookingId).update({
      paymentStatus: 'completed',
      transactionId: paymentIntent.id,
      paymentMethod: 'stripe',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
}

async function handlePaymentFailure(paymentIntent: Stripe.PaymentIntent) {
  await db.collection('paymentIntents').doc(paymentIntent.id).update({
    status: 'failed',
    failedAt: admin.firestore.FieldValue.serverTimestamp(),
    errorMessage: paymentIntent.last_payment_error?.message || 'Unknown error',
  });
}

async function handleRefund(charge: Stripe.Charge) {
  const refundAmount = (charge.amount_refunded / 100);
  await db.collection('refunds').add({
    chargeId: charge.id,
    amount: refundAmount,
    currency: charge.currency,
    status: 'completed',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

// Wallet Top-up
export const topUpWallet = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { amount, paymentMethod } = data;
  const userId = context.auth.uid;

  if (amount < 100) {
    throw new functions.https.HttpsError('invalid-argument', 'Minimum top-up amount is Rs.100');
  }

  if (amount > 50000) {
    throw new functions.https.HttpsError('invalid-argument', 'Maximum top-up amount is Rs.50,000');
  }

  // Create transaction record
  const transactionRef = db.collection('transactions').doc();
  await transactionRef.set({
    id: transactionRef.id,
    walletId: userId,
    userId: userId,
    type: 'wallet_topup',
    amount: amount,
    currency: 'INR',
    status: 'pending',
    paymentMethod: paymentMethod,
    description: 'Wallet top-up',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    transactionId: transactionRef.id,
    amount: amount,
    message: 'Top-up initiated. Complete payment to add funds.',
  };
});

// Withdraw from Wallet
export const withdrawFromWallet = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { amount, bankDetails } = data;
  const userId = context.auth.uid;

  if (amount < 500) {
    throw new functions.https.HttpsError('invalid-argument', 'Minimum withdrawal is Rs.500');
  }

  // Balance is checked AND updated inside the transaction so two concurrent
  // withdrawal requests can't both pass the check and overdraw the wallet.
  await db.runTransaction(async (transaction) => {
    const walletRef = db.collection('wallets').doc(userId);
    const walletSnap = await transaction.get(walletRef);
    const wallet = walletSnap.data();

    if (!wallet || wallet.balance < amount) {
      throw new functions.https.HttpsError('failed-precondition', 'Insufficient balance');
    }

    transaction.update(walletRef, {
      balance: admin.firestore.FieldValue.increment(-amount),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const transactionRef = db.collection('transactions').doc();
    transaction.set(transactionRef, {
      id: transactionRef.id,
      walletId: userId,
      userId: userId,
      type: 'withdrawal',
      amount: -amount,
      currency: 'INR',
      status: 'pending',
      description: 'Wallet withdrawal',
      bankDetails: bankDetails,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return { success: true, message: 'Withdrawal request submitted for processing' };
});
