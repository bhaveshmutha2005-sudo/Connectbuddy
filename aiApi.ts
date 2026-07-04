import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { GoogleGenAI } from '@google/genai';
import { requireFields } from '../middleware/validationMiddleware';

const db = admin.firestore();
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

// Natural-language companion search, e.g. "a calm study partner near me for
// tomorrow evening". This is distinct from aiService.aiMatchCompanion, which
// ranks candidates against structured preferences for a known category -
// this endpoint's job is turning free text into that structured query first.
export const aiSearchCompanions = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  requireFields(data, ['query']);

  const categoriesList = [
    'Shopping Partner', 'Movie Partner', 'Event Partner', 'Restaurant Companion', 'Travel Companion',
    'Study Partner', 'Gaming Partner', 'Local Guide', 'Senior Companion', 'Personal Assistant',
    'Walking Partner', 'Fitness Partner', 'Language Exchange Partner', 'Co-working Partner',
    'Photography Partner', 'City Tour Partner', 'Volunteer Partner', 'Networking Event Partner',
    'Airport Companion', 'Hospital Companion',
  ];

  const prompt = `You are a search-query parser for BuddyConnect, a public companionship platform.
Valid categories: ${categoriesList.join(', ')}

User search: "${data.query}"

Extract structured search parameters as JSON only, no other text:
{ "category": one of the valid categories or null, "minRating": number or null, "languageHint": string or null, "timeHint": string or null }`;

  try {
    const response = await genAI.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
    const text = response.text || '{}';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

    let query: FirebaseFirestore.Query = db.collection('companions').where('isActive', '==', true).where('isVerified', '==', true);
    if (parsed.category) query = query.where('categories', 'array-contains', parsed.category);

    const snapshot = await query.limit(50).get();
    let companions = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as any));

    if (parsed.minRating) companions = companions.filter((c) => (c.rating || 0) >= parsed.minRating);
    companions = companions.sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, 20);

    return { companions, interpretedQuery: parsed };
  } catch (error: any) {
    console.error('AI search error:', error);
    throw new functions.https.HttpsError('internal', 'Search is temporarily unavailable, try the filter search instead');
  }
});

// Personalized home-feed recommendations, separate from
// aiService.aiBookingSuggestions (which only looks at past categories) -
// this blends past behavior with trending/highly-rated companions the user
// hasn't seen yet.
export const aiGetRecommendations = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');

  const userId = context.auth.uid;

  const [bookingsSnap, topRatedSnap] = await Promise.all([
    db.collection('bookings').where('userId', '==', userId).where('status', '==', 'completed').limit(20).get(),
    db.collection('companions').where('isActive', '==', true).where('isVerified', '==', true)
      .orderBy('rating', 'desc').limit(20).get(),
  ]);

  const bookedCompanionIds = new Set(bookingsSnap.docs.map((d) => d.data().companionId));
  const categoryFrequency: Record<string, number> = {};
  bookingsSnap.docs.forEach((d) => {
    const cat = d.data().category;
    categoryFrequency[cat] = (categoryFrequency[cat] || 0) + 1;
  });

  const topRated = topRatedSnap.docs
    .map((d) => ({ id: d.id, ...d.data() } as any))
    .filter((c) => !bookedCompanionIds.has(c.id));

  const favoriteCategories = Object.entries(categoryFrequency).sort((a, b) => b[1] - a[1]).map(([cat]) => cat);

  return {
    trending: topRated.slice(0, 10),
    favoriteCategories,
    hasHistory: bookingsSnap.size > 0,
  };
});
