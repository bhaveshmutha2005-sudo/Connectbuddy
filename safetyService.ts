import * as admin from 'firebase-admin';

const db = admin.firestore();

const AUTO_SUSPEND_REPORT_THRESHOLD = 3;

// Checks how many pending reports exist against a user and auto-suspends
// their account (blocks them, requiring admin review to lift it) once the
// threshold is hit. Called from safetyTriggers.onReportCreated.
export const checkAndAutoSuspend = async (reportedUserId: string): Promise<boolean> => {
  const reportsSnap = await db.collection('reports')
    .where('reportedUserId', '==', reportedUserId)
    .where('status', '==', 'pending')
    .get();

  if (reportsSnap.size >= AUTO_SUSPEND_REPORT_THRESHOLD) {
    await db.collection('users').doc(reportedUserId).update({
      isBlocked: true,
      isActive: false,
      autoSuspended: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await db.collection('adminLogs').add({
      adminId: 'system',
      action: 'auto_suspend_user',
      targetUserId: reportedUserId,
      reason: `Reached ${reportsSnap.size} pending reports`,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    return true;
  }

  return false;
};

export const notifyAdminsOfReport = async (reportId: string, reportedUserId: string, reason: string): Promise<void> => {
  const admins = await db.collection('users').where('role', 'in', ['admin', 'superAdmin']).get();

  await Promise.all(admins.docs.map((adminDoc) =>
    db.collection('notifications').add({
      userId: adminDoc.id,
      title: 'New user report',
      body: `A user was reported: ${reason}`,
      type: 'report_admin',
      data: { reportId, reportedUserId },
      isRead: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  ));
};

// Lightweight keyword pre-filter for chat messages, run before the (slower,
// paid) Gemini-based aiSafetyCheck. Cheap first line of defense so obviously
// disallowed content never reaches the AI call or the other participant.
const BLOCKED_KEYWORDS = ['hotel room', 'private room', 'my address is', 'send nudes', 'venmo me', 'cashapp me'];

export const quickKeywordFilter = (text: string): { blocked: boolean; reason?: string } => {
  const lower = (text || '').toLowerCase();
  const hit = BLOCKED_KEYWORDS.find((kw) => lower.includes(kw));
  return hit ? { blocked: true, reason: `Message contains disallowed content` } : { blocked: false };
};
