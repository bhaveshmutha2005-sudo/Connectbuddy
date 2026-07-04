import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { GoogleGenAI } from '@google/genai';

const db = admin.firestore();

// Initialize Gemini AI with API key from environment
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

// AI Companion Matching
export const aiMatchCompanion = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { userId, category, preferences = {} } = data;

  try {
    // Get user's past bookings and preferences
    const userBookings = await db.collection('bookings')
      .where('userId', '==', userId)
      .where('status', '==', 'completed')
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();

    const pastCompanionIds = userBookings.docs.map(doc => doc.data().companionId);

    // Get available companions in category
    const companionsSnapshot = await db.collection('companions')
      .where('categories', 'array-contains', category)
      .where('isActive', '==', true)
      .where('isVerified', '==', true)
      .where('isAvailable', '==', true)
      .limit(50)
      .get();

    const companions = companionsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Filter out previously booked companions for variety
    const newCompanions = companions.filter(c => !pastCompanionIds.includes(c.id));
    const candidates = newCompanions.length > 0 ? newCompanions : companions;

    if (candidates.length === 0) {
      return { matches: [], message: 'No companions available in this category' };
    }

    // Use Gemini for intelligent matching
    const prompt = `
You are an AI matching assistant for BuddyConnect, a safe public companionship platform.

User preferences: ${JSON.stringify(preferences)}
Available companions: ${JSON.stringify(candidates.map(c => ({
  id: c.id,
  name: c.displayName,
  bio: c.bio,
  rating: c.rating,
  languages: c.languages,
  skills: c.skills,
  hourlyRate: c.hourlyRate,
  totalReviews: c.totalReviews,
})))}

Analyze the user preferences and companion profiles. Return the TOP 5 most compatible companion IDs in order of best match, with a brief reason for each match.
Format: JSON array of objects with fields: companionId, matchScore (0-1), reason
`;

    const response = await genAI.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    const responseText = response.text || '';
    let matches = [];

    try {
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        matches = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error('Failed to parse AI response:', e);
      // Fallback: sort by rating
      matches = candidates
        .sort((a, b) => (b.rating || 0) - (a.rating || 0))
        .slice(0, 5)
        .map((c, i) => ({
          companionId: c.id,
          matchScore: 0.9 - (i * 0.05),
          reason: 'Highly rated companion',
        }));
    }

    // Log AI match for analytics
    await db.collection('aiMatches').add({
      userId,
      category,
      preferences,
      matches,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { matches, totalAvailable: candidates.length };
  } catch (error: any) {
    console.error('AI matching error:', error);
    throw new functions.https.HttpsError('internal', 'AI matching failed');
  }
});

// AI Chat Assistant
export const aiChatAssistant = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { message, chatHistory = [] } = data;

  const systemPrompt = `You are Buddy, the AI assistant for BuddyConnect - a safe, public companionship platform.

RULES:
- Only discuss non-romantic, non-intimate companionship
- Suggest public meeting places like cafes, parks, malls, events
- Provide safety tips for meeting new people
- Help users find the right companion category
- Answer questions about the platform features
- NEVER suggest private rooms, hotels, or intimate settings
- NEVER discuss adult services or dating
- Keep responses helpful, friendly, and safety-focused

User message: ${message}`;

  try {
    const response = await genAI.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: systemPrompt,
    });

    return {
      response: response.text,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    };
  } catch (error: any) {
    console.error('AI chat error:', error);
    throw new functions.https.HttpsError('internal', 'AI assistant unavailable');
  }
});

// AI Safety Monitoring - Content Moderation
export const aiSafetyCheck = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { content, type = 'message' } = data;

  const safetyPrompt = `Analyze the following content for safety violations on a public companionship platform.

Content: "${content}"

Check for:
1. Sexual/adult content or solicitations
2. Requests for private room meetings
3. Personal information sharing (addresses, IDs)
4. Threats or harassment
5. Spam or promotional content
6. Drug or illegal activity references

Return JSON: { "isSafe": boolean, "violations": string[], "severity": "low"|"medium"|"high", "action": "allow"|"warn"|"block" }`;

  try {
    const response = await genAI.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: safetyPrompt,
    });

    const responseText = response.text || '';
    let result = { isSafe: true, violations: [], severity: 'low', action: 'allow' };

    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error('Failed to parse safety check:', e);
    }

    // Log safety check
    await db.collection('safetyChecks').add({
      userId: context.auth.uid,
      content: content.substring(0, 500),
      type,
      result,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return result;
  } catch (error: any) {
    console.error('Safety check error:', error);
    return { isSafe: true, violations: [], severity: 'low', action: 'allow' };
  }
});

// AI Profile Writer
export const aiWriteProfile = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { category, skills, languages, experience } = data;

  const prompt = `Write a professional, friendly companion profile bio for BuddyConnect (a safe public companionship platform).

Details:
- Category: ${category}
- Skills: ${skills.join(', ')}
- Languages: ${languages.join(', ')}
- Experience: ${experience || 'New to the platform'}

Requirements:
- Highlight skills and personality
- Mention safety and professionalism
- Keep it under 200 words
- Friendly but professional tone
- NO romantic or intimate language
- Focus on public activities and companionship`;

  try {
    const response = await genAI.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    return { bio: response.text?.trim() };
  } catch (error: any) {
    throw new functions.https.HttpsError('internal', 'Failed to generate profile');
  }
});

// AI Fraud Detection
export const aiFraudDetection = functions.firestore
  .document('bookings/{bookingId}')
  .onCreate(async (snap, context) => {
    const booking = snap.data();

    // Check for suspicious patterns
    const recentBookings = await db.collection('bookings')
      .where('userId', '==', booking.userId)
      .where('createdAt', '>', admin.firestore.Timestamp.fromDate(new Date(Date.now() - 24 * 60 * 60 * 1000)))
      .get();

    // Flag if more than 5 bookings in 24 hours
    if (recentBookings.size > 5) {
      await db.collection('fraudAlerts').add({
        userId: booking.userId,
        bookingId: context.params.bookingId,
        reason: 'Excessive bookings in 24 hours',
        severity: 'medium',
        status: 'pending_review',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // Check for unusual amount
    if (booking.totalAmount > 50000) {
      await db.collection('fraudAlerts').add({
        userId: booking.userId,
        bookingId: context.params.bookingId,
        reason: 'Unusually high booking amount',
        severity: 'high',
        status: 'pending_review',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  });

// AI Booking Suggestions
export const aiBookingSuggestions = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { userId } = data;

  // Get user's booking history
  const bookingsSnapshot = await db.collection('bookings')
    .where('userId', '==', userId)
    .where('status', '==', 'completed')
    .orderBy('createdAt', 'desc')
    .limit(5)
    .get();

  const categories = bookingsSnapshot.docs.map(doc => doc.data().category);
  const uniqueCategories = [...new Set(categories)];

  // Get popular companions in those categories
  const suggestions = [];
  for (const category of uniqueCategories.slice(0, 3)) {
    const companions = await db.collection('companions')
      .where('categories', 'array-contains', category)
      .where('isVerified', '==', true)
      .where('isAvailable', '==', true)
      .orderBy('rating', 'desc')
      .limit(3)
      .get();

    suggestions.push({
      category,
      companions: companions.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      })),
    });
  }

  return { suggestions };
});
