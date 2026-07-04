import * as admin from 'firebase-admin';
import * as crypto from 'crypto';

const db = admin.firestore();

// Thin wrapper around an SMS provider (Twilio, MSG91, etc). Store the
// provider credentials as SMS_API_KEY / SMS_SENDER_ID in your function's
// environment config.
export const sendSms = async (to: string, message: string): Promise<{ success: boolean; error?: string }> => {
  const apiKey = process.env.SMS_API_KEY;

  if (!apiKey) {
    console.warn('SMS_API_KEY not configured - SMS not sent to', to);
    return { success: false, error: 'SMS provider not configured' };
  }

  try {
    // Example using Twilio's HTTP API directly (no extra SDK dependency).
    // Swap this block out for whichever provider you use.
    const accountSid = process.env.TWILIO_ACCOUNT_SID || '';
    const authToken = apiKey;
    const fromNumber = process.env.SMS_SENDER_ID || '';

    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: fromNumber, Body: message }).toString(),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('SMS send failed:', errText);
      return { success: false, error: errText };
    }

    return { success: true };
  } catch (error: any) {
    console.error('SMS send error:', error);
    return { success: false, error: error.message };
  }
};

const OTP_TTL_SECONDS = 300; // 5 minutes
const OTP_MAX_ATTEMPTS = 5;

const hashOtp = (otp: string, phoneNumber: string) =>
  crypto.createHash('sha256').update(`${otp}:${phoneNumber}:${process.env.OTP_SALT || 'buddyconnect'}`).digest('hex');

// Generates a 6-digit OTP, stores its hash (never the raw code) in Firestore
// with a short TTL, and sends it via SMS. Used for custom phone-number
// verification flows that sit alongside Firebase's own phone auth (e.g.
// verifying a secondary/emergency-contact phone number).
export const generateAndSendOtp = async (phoneNumber: string): Promise<{ success: boolean }> => {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otpHash = hashOtp(otp, phoneNumber);

  await db.collection('otpRequests').doc(phoneNumber.replace(/\D/g, '')).set({
    phoneNumber,
    otpHash,
    attempts: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: Date.now() + OTP_TTL_SECONDS * 1000,
  });

  const result = await sendSms(phoneNumber, `Your BuddyConnect verification code is ${otp}. It expires in 5 minutes.`);
  return { success: result.success };
};

export const verifyOtp = async (phoneNumber: string, otp: string): Promise<boolean> => {
  const docId = phoneNumber.replace(/\D/g, '');
  const ref = db.collection('otpRequests').doc(docId);
  const snap = await ref.get();
  const data = snap.data();

  if (!data) return false;
  if (Date.now() > data.expiresAt) {
    await ref.delete();
    return false;
  }
  if (data.attempts >= OTP_MAX_ATTEMPTS) {
    await ref.delete();
    return false;
  }

  const isValid = data.otpHash === hashOtp(otp, phoneNumber);

  if (isValid) {
    await ref.delete();
    return true;
  }

  await ref.update({ attempts: admin.firestore.FieldValue.increment(1) });
  return false;
};

export const sendBookingReminderSms = (to: string, category: string, timeText: string) =>
  sendSms(to, `Reminder: your ${category} booking on BuddyConnect starts at ${timeText}. Meet only in the agreed public place.`);
