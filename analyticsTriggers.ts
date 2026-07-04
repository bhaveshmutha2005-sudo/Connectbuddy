import * as functions from 'firebase-functions';
import { generateDailySnapshot } from '../services/analyticsService';

// Runs once daily and aggregates the previous day's bookings/revenue/signups
// into analytics/{date}, which powers the admin Analytics/Revenue dashboards
// without those dashboards having to scan the full bookings collection on
// every page load.
export const generateDailyAnalytics = functions.pubsub
  .schedule('every day 00:15')
  .timeZone('Asia/Kolkata')
  .onRun(async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    await generateDailySnapshot(yesterday);
    console.log(`Generated analytics snapshot for ${yesterday.toISOString().slice(0, 10)}`);
  });
