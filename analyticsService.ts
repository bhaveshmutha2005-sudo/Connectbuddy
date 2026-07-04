import * as admin from 'firebase-admin';

const db = admin.firestore();

export const getRevenueForPeriod = async (startDate: Date, endDate: Date): Promise<number> => {
  const snapshot = await db.collection('bookings')
    .where('status', '==', 'completed')
    .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(startDate))
    .where('createdAt', '<', admin.firestore.Timestamp.fromDate(endDate))
    .get();

  return snapshot.docs.reduce((sum, doc) => sum + (doc.data().totalAmount || 0), 0);
};

export const getBookingStatsForPeriod = async (startDate: Date, endDate: Date) => {
  const snapshot = await db.collection('bookings')
    .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(startDate))
    .where('createdAt', '<', admin.firestore.Timestamp.fromDate(endDate))
    .get();

  const stats: Record<string, number> = {
    total: 0, completed: 0, cancelled: 0, rejected: 0, pending: 0,
  };
  const byCategory: Record<string, number> = {};

  snapshot.docs.forEach((doc) => {
    const b = doc.data();
    stats.total++;
    if (stats[b.status] !== undefined) stats[b.status]++;
    byCategory[b.category] = (byCategory[b.category] || 0) + 1;
  });

  return { ...stats, byCategory };
};

// Aggregates the previous day's activity into a single analytics/{date}
// document so the admin dashboard can render trends without scanning the
// full bookings collection on every page load. Call this from a scheduled
// function (see analyticsTriggers.ts).
export const generateDailySnapshot = async (forDate: Date): Promise<void> => {
  const dayStart = new Date(forDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const [revenue, bookingStats, newUsersSnap, newCompanionsSnap] = await Promise.all([
    getRevenueForPeriod(dayStart, dayEnd),
    getBookingStatsForPeriod(dayStart, dayEnd),
    db.collection('users')
      .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(dayStart))
      .where('createdAt', '<', admin.firestore.Timestamp.fromDate(dayEnd))
      .count().get(),
    db.collection('companions')
      .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(dayStart))
      .where('createdAt', '<', admin.firestore.Timestamp.fromDate(dayEnd))
      .count().get(),
  ]);

  const dateKey = dayStart.toISOString().slice(0, 10);

  await db.collection('analytics').doc(dateKey).set({
    date: dateKey,
    revenue,
    bookingStats,
    newUsers: newUsersSnap.data().count,
    newCompanions: newCompanionsSnap.data().count,
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
};
