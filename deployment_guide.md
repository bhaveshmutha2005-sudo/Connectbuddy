# BuddyConnect Deployment Guide

## Prerequisites

### Development Environment
- Flutter SDK 3.0+
- Dart SDK 3.0+
- Firebase CLI
- Node.js 20+
- Google Cloud SDK

### Accounts Required
- Firebase account
- Google Cloud Platform account
- Stripe account (for payments)
- Razorpay account (for Indian payments)
- Google Play Console (for Android)
- Apple Developer Account (for iOS)

## Firebase Setup

### 1. Create Firebase Project
```bash
firebase login
firebase projects:create buddyconnect-prod
```

### 2. Enable Services
- Authentication (Email, Google, Phone)
- Cloud Firestore
- Cloud Storage
- Cloud Functions
- Cloud Messaging
- Analytics
- Crashlytics
- Performance Monitoring

### 3. Configure Firebase
```bash
cd firebase
firebase init
# Select: Firestore, Functions, Storage, Hosting
```

### 4. Set Environment Variables
```bash
firebase functions:config:set   stripe.secret_key="sk_live_..."   stripe.webhook_secret="whsec_..."   razorpay.key_id="rzp_live_..."   razorpay.key_secret="..."   gemini.api_key="..."   twilio.sid="..."   twilio.token="..."
```

## Flutter App Configuration

### 1. Firebase Configuration
Add `google-services.json` (Android) and `GoogleService-Info.plist` (iOS) to the project.

### 2. Android Setup
```xml
<!-- AndroidManifest.xml -->
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/>
<uses-permission android:name="android.permission.CAMERA"/>
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE"/>
<uses-permission android:name="android.permission.RECORD_AUDIO"/>
```

### 3. iOS Setup
```xml
<!-- Info.plist -->
<key>NSLocationWhenInUseUsageDescription</key>
<string>BuddyConnect needs your location to find nearby companions</string>
<key>NSCameraUsageDescription</key>
<string>BuddyConnect needs camera access for profile verification</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>BuddyConnect needs photo access for profile pictures</string>
<key>NSMicrophoneUsageDescription</key>
<string>BuddyConnect needs microphone access for voice messages</string>
```

## Build & Deploy

### Android
```bash
cd flutter_app
flutter build apk --release
flutter build appbundle --release
# Upload to Google Play Console
```

### iOS
```bash
cd flutter_app
flutter build ios --release
# Open in Xcode and archive
# Upload to App Store Connect
```

### Web
```bash
cd flutter_app
flutter build web --release
firebase deploy --only hosting
```

### Admin Dashboard (Web)
```bash
cd admin_dashboard
flutter build web --release
firebase deploy --only hosting:admin
```

### Cloud Functions
```bash
cd firebase/functions
npm install
npm run build
firebase deploy --only functions
```

### Security Rules
```bash
firebase deploy --only firestore:rules
firebase deploy --only storage:rules
```

## Environment Configuration

### Development
```
Firebase Project: buddyconnect-dev
API Base URL: https://us-central1-buddyconnect-dev.cloudfunctions.net
Stripe: Test keys
Razorpay: Test keys
```

### Staging
```
Firebase Project: buddyconnect-staging
API Base URL: https://us-central1-buddyconnect-staging.cloudfunctions.net
Stripe: Test keys
Razorpay: Test keys
```

### Production
```
Firebase Project: buddyconnect-prod
API Base URL: https://us-central1-buddyconnect-prod.cloudfunctions.net
Stripe: Live keys
Razorpay: Live keys
Gemini: Production API key
```

## Post-Deployment Checklist

### Verification
- [ ] User registration works
- [ ] Email verification sends
- [ ] Phone OTP works
- [ ] Google Sign-In works
- [ ] Companion search works
- [ ] Booking creation works
- [ ] Payment processing works
- [ ] Chat messaging works
- [ ] Push notifications work
- [ ] SOS feature works
- [ ] Admin dashboard loads
- [ ] Analytics tracking works

### Monitoring
- [ ] Crashlytics dashboard configured
- [ ] Performance monitoring enabled
- [ ] Custom events tracked
- [ ] Error alerts configured
- [ ] Uptime monitoring set up

### Security
- [ ] Firestore rules deployed
- [ ] Storage rules deployed
- [ ] API keys rotated
- [ ] Webhook endpoints secured
- [ ] SSL certificates valid
- [ ] Rate limiting enabled

## Rollback Plan

### Database
- Daily automated backups
- Point-in-time recovery
- Test restore procedures

### App
- Previous version kept in stores
- Feature flags for gradual rollout
- Emergency hotfix capability

### Functions
- Versioned deployments
- Blue-green deployment
- Quick rollback commands

## Scaling Considerations

### Database
- Monitor read/write quotas
- Optimize indexes
- Consider sharding for scale

### Functions
- Monitor cold start times
- Optimize memory allocation
- Consider regional deployment

### Storage
- Monitor bandwidth usage
- Implement CDN for images
- Optimize image sizes

## Support & Maintenance

### Regular Tasks
- Weekly: Review error logs
- Weekly: Monitor performance
- Monthly: Security audit
- Monthly: Update dependencies
- Quarterly: User feedback review

### Emergency Contacts
- Firebase Support
- Stripe Support
- Razorpay Support
- Google Cloud Support
