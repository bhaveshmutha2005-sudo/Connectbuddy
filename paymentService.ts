import * as admin from 'firebase-admin';

const db = admin.firestore();

export const PLATFORM_FEE_PERCENT = 0.15;

export const calculatePlatformFee = (amount: number): number => {
  return Math.round(amount * PLATFORM_FEE_PERCENT * 100) / 100;
};

export const calculateCompanionEarnings = (amount: number): number => {
  return Math.round((amount - calculatePlatformFee(amount)) * 100) / 100;
};

// Pricing model: hourly / half-day (up to 4h) / full-day (up to 8h)
export const calculateBookingAmount = (
  pricing: { hourlyRate?: number; halfDayRate?: number; fullDayRate?: number },
  durationType: 'hourly' | 'half_day' | 'full_day',
  hours: number = 1
): number => {
  switch (durationType) {
    case 'half_day':
      if (!pricing.halfDayRate) throw new Error('Companion has not set a half-day rate');
      return pricing.halfDayRate;
    case 'full_day':
      if (!pricing.fullDayRate) throw new Error('Companion has not set a full-day rate');
      return pricing.fullDayRate;
    case 'hourly':
    default:
      if (!pricing.hourlyRate) throw new Error('Companion has not set an hourly rate');
      return Math.round(pricing.hourlyRate * hours * 100) / 100;
  }
};

export const generateInvoiceNumber = (bookingId: string): string => {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `INV-${datePart}-${bookingId.slice(0, 6).toUpperCase()}`;
};

export const formatCurrency = (amount: number, currency: string = 'INR'): string => {
  const symbol = currency.toUpperCase() === 'INR' ? '\u20B9' : currency.toUpperCase() === 'USD' ? '$' : currency.toUpperCase();
  return `${symbol}${amount.toFixed(2)}`;
};

export const generateInvoice = async (bookingId: string): Promise<Record<string, any>> => {
  const bookingDoc = await db.collection('bookings').doc(bookingId).get();
  const booking = bookingDoc.data();
  if (!booking) throw new Error('Booking not found');

  const platformFee = calculatePlatformFee(booking.totalAmount);
  const invoice = {
    invoiceNumber: generateInvoiceNumber(bookingId),
    bookingId,
    userId: booking.userId,
    companionId: booking.companionId,
    category: booking.category,
    subtotal: booking.totalAmount,
    platformFee,
    companionEarnings: booking.totalAmount - platformFee,
    currency: booking.currency || 'INR',
    paymentStatus: booking.paymentStatus,
    paymentMethod: booking.paymentMethod || null,
    issuedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection('invoices').doc(bookingId).set(invoice);
  return invoice;
};
