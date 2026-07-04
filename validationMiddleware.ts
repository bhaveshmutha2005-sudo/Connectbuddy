import * as functions from 'firebase-functions';

const BANNED_LOCATION_KEYWORDS = ['hotel', 'motel', 'private room', 'bedroom', 'apartment', 'home', 'residence', 'lodge', 'inn'];

export const sanitizeString = (input: unknown, maxLength: number = 1000): string => {
  if (typeof input !== 'string') return '';
  return input.trim().slice(0, maxLength);
};

export const requireFields = (data: Record<string, any>, fields: string[]): void => {
  const missing = fields.filter((f) => data[f] === undefined || data[f] === null || data[f] === '');
  if (missing.length > 0) {
    throw new functions.https.HttpsError('invalid-argument', `Missing required field(s): ${missing.join(', ')}`);
  }
};

export const validateAmount = (amount: unknown, min: number = 1, max: number = 1000000): number => {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new functions.https.HttpsError('invalid-argument', `Amount must be a number between ${min} and ${max}`);
  }
  return n;
};

export const validateCoordinates = (latitude: unknown, longitude: unknown): void => {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid coordinates');
  }
};

export const validateEmail = (email: string): void => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!re.test(email)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid email address');
  }
};

export const validatePhoneNumber = (phone: string): void => {
  const re = /^\+[1-9]\d{6,14}$/;
  if (!re.test(phone)) {
    throw new functions.https.HttpsError('invalid-argument', 'Phone number must be in E.164 format (e.g. +919876543210)');
  }
};

// Rejects meeting-location text that suggests a private, non-public venue.
// Used by bookingApi.createBooking and companionApi.updateCompanionProfile
// meeting-preferences so the "no private-room bookings" platform rule is
// enforced server-side, not just client-side.
export const validatePublicLocation = (locationText: string): void => {
  const lower = (locationText || '').toLowerCase();
  const hit = BANNED_LOCATION_KEYWORDS.find((kw) => lower.includes(kw));
  if (hit) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Meeting location must be a public place. Private rooms, hotels, and residences are not allowed.'
    );
  }
};

export const validatePagination = (limit: unknown): number => {
  const n = Number(limit);
  if (!Number.isFinite(n) || n < 1) return 20;
  return Math.min(n, 100);
};
