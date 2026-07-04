import * as functions from 'firebase-functions';

// Thin wrapper around a transactional email provider. Plug in SendGrid,
// Postmark, AWS SES, etc. here - store the provider's API key as
// EMAIL_API_KEY in your function's environment config, the same way
// GEMINI_API_KEY is used in aiService.ts.
//
// This file intentionally does NOT hardcode a specific provider SDK so you
// can drop in whichever one your infra already uses. Example for SendGrid
// is left commented below.

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

export const sendEmail = async (payload: EmailPayload): Promise<{ success: boolean; error?: string }> => {
  const apiKey = process.env.EMAIL_API_KEY;

  if (!apiKey) {
    console.warn('EMAIL_API_KEY not configured - email not sent:', payload.subject, 'to', payload.to);
    return { success: false, error: 'Email provider not configured' };
  }

  try {
    // Example using SendGrid's HTTP API directly (no extra SDK dependency):
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: payload.to }] }],
        from: { email: process.env.EMAIL_FROM_ADDRESS || 'no-reply@buddyconnect.app', name: 'BuddyConnect' },
        subject: payload.subject,
        content: [{ type: 'text/html', value: payload.html }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Email send failed:', errText);
      return { success: false, error: errText };
    }

    return { success: true };
  } catch (error: any) {
    console.error('Email send error:', error);
    return { success: false, error: error.message };
  }
};

export const sendWelcomeEmail = (to: string, displayName: string) =>
  sendEmail({
    to,
    subject: 'Welcome to BuddyConnect',
    html: `<p>Hi ${displayName},</p><p>Welcome to BuddyConnect - your trusted platform for safe, public companionship. Explore verified companions near you and book your first activity today.</p>`,
  });

export const sendBookingConfirmationEmail = (to: string, category: string, dateTime: string, companionName: string) =>
  sendEmail({
    to,
    subject: 'Your BuddyConnect booking is confirmed',
    html: `<p>Your ${category} booking with ${companionName} on ${dateTime} is confirmed. Remember: always meet in the agreed public location.</p>`,
  });

export const sendVerificationStatusEmail = (to: string, approved: boolean) =>
  sendEmail({
    to,
    subject: approved ? 'You are verified on BuddyConnect' : 'BuddyConnect verification update',
    html: approved
      ? '<p>Congratulations, your companion profile has been verified. You can now accept bookings.</p>'
      : '<p>Your verification was not approved this time. Please check the app for details and resubmit your documents.</p>',
  });

export const sendPayoutEmail = (to: string, amount: number, currency: string = 'INR') =>
  sendEmail({
    to,
    subject: 'Withdrawal processed',
    html: `<p>Your withdrawal of ${currency} ${amount.toFixed(2)} has been processed.</p>`,
  });
