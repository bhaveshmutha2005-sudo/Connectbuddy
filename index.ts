import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

admin.initializeApp();

// Export all function modules
export * from './triggers/authTriggers';
export * from './triggers/bookingTriggers';
export * from './triggers/paymentTriggers';
export * from './triggers/notificationTriggers';
export * from './triggers/safetyTriggers';
export * from './triggers/analyticsTriggers';

export * from './api/authApi';
export * from './api/bookingApi';
export * from './api/paymentApi';
export * from './api/companionApi';
export * from './api/adminApi';
export * from './api/aiApi';
export * from './api/verificationApi';
export * from './api/referralApi';
export * from './api/sosApi';

export * from './services/aiService';
export * from './services/notificationService';
export * from './services/paymentService';
export * from './services/emailService';
export * from './services/smsService';
export * from './services/analyticsService';
export * from './services/safetyService';

export * from './middleware/authMiddleware';
export * from './middleware/rateLimitMiddleware';
export * from './middleware/validationMiddleware';

export { admin };
