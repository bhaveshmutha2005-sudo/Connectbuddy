import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { GoogleGenAI } from '@google/genai';
import { checkAndAutoSuspend, notifyAdminsOfReport, quickKeywordFilter } from '../services/safetyService';

const db = admin.firestore();
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export const onReportCreated = functions.firestore
  .document('reports/{reportId}')
  .onCreate(async (snap, context) => {
    const report = snap.data();
    await notifyAdminsOfReport(context.params.reportId, report.reportedUserId, report.reason);
    await checkAndAutoSuspend(report.reportedUserId);
  });

// Real-time chat moderation. Assumes chat messages are written to
// chats/{chatId}/messages/{messageId}. Runs a free keyword pre-filter first;
// only calls Gemini (which costs money/latency) if the message survives
// that check, matching the "cheap filter -> AI check" pattern used for
// cost control.
export const onChatMessageCreated = functions.firestore
  .document('chats/{chatId}/messages/{messageId}')
  .onCreate(async (snap, context) => {
    const message = snap.data();
    if (!message?.text) return;

    const quickCheck = quickKeywordFilter(message.text);
    if (quickCheck.blocked) {
      await snap.ref.update({
        isFlagged: true,
        isHidden: true,
        moderationReason: quickCheck.reason,
        moderatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return;
    }

    try {
      const prompt = `Analyze this chat message from a public companionship platform for safety violations (sexual content, requests for private meetings, personal info sharing, harassment, spam). Message: "${message.text}"
Return JSON only: { "isSafe": boolean, "severity": "low"|"medium"|"high" }`;

      const response = await genAI.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
      const text = response.text || '{}';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const result = jsonMatch ? JSON.parse(jsonMatch[0]) : { isSafe: true, severity: 'low' };

      if (!result.isSafe) {
        await snap.ref.update({
          isFlagged: true,
          isHidden: result.severity === 'high',
          moderationReason: 'Flagged by AI safety check',
          moderationSeverity: result.severity,
          moderatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        if (result.severity === 'high') {
          await db.collection('safetyChecks').add({
            userId: message.senderId,
            chatId: context.params.chatId,
            messageId: context.params.messageId,
            content: message.text.substring(0, 500),
            result,
            status: 'pending_review',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      }
    } catch (error) {
      // Fail open on the AI check (message stays visible) - the keyword
      // filter above is the hard backstop, this is a soft secondary layer.
      console.error('Chat moderation error:', error);
    }
  });
