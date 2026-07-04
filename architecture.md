# BuddyConnect Architecture Documentation

## Overview
BuddyConnect is a production-ready marketplace application built with:
- **Flutter** for cross-platform mobile (iOS/Android) and Web
- **Firebase** for backend infrastructure
- **Google Cloud** for AI and Maps services

## Architecture Pattern
**Clean Architecture + MVVM + Repository Pattern**

```
lib/
  core/           # Constants, Theme, Utils, Services
  data/           # Models, Repositories, DataSources
  domain/         # Entities, Repository Interfaces
  presentation/   # BLoC/Cubit, Screens, Widgets
```

## Layer Responsibilities

### 1. Domain Layer (Innermost)
- **Entities**: Business objects (User, Companion, Booking, etc.)
- **Repository Interfaces**: Contracts for data operations
- **Use Cases**: Business logic operations

### 2. Data Layer
- **Models**: JSON serialization/deserialization
- **Repository Implementations**: Firebase Firestore operations
- **Data Sources**: Remote (Firebase) and local caching

### 3. Presentation Layer
- **BLoC/Cubit**: State management
- **Screens**: UI pages
- **Widgets**: Reusable UI components

## Firebase Architecture

### Collections Structure
```
users/              # User profiles and auth data
companions/         # Companion profiles with verification
bookings/           # Booking records with status tracking
chats/              # Chat rooms
  messages/         # Sub-collection for messages
wallets/            # User wallets
  transactions/     # Transaction history
reviews/            # Ratings and reviews
notifications/      # Push notification records
reports/            # User reports and complaints
verificationDocs/   # KYC documents
sosLogs/            # Emergency SOS records
adminLogs/          # Admin audit trail
```

### Cloud Functions
- **Auth Triggers**: User creation, deletion, email verification
- **Booking Triggers**: Status changes, notifications, payments
- **Payment APIs**: Stripe/Razorpay integration
- **AI Services**: Gemini API for matching, safety, recommendations
- **Admin APIs**: User management, verification, analytics
- **Safety APIs**: SOS handling, location validation

## Security Model

### Authentication
- Firebase Authentication (Email, Google, Phone OTP)
- Custom claims for role-based access
- JWT token validation

### Authorization
- Firestore Security Rules with RBAC
- Collection-level access control
- Field-level validation

### Data Protection
- Input validation and sanitization
- Adult content filtering
- Private location blocking
- AI-powered safety monitoring

## Scalability Considerations

### Database
- Composite indexes for query optimization
- Pagination for large datasets
- Denormalization for read performance
- Cloud Functions for complex transactions

### Caching
- Image caching with CachedNetworkImage
- Local state persistence
- Firestore offline persistence

### Performance
- Lazy loading for lists
- Debounced search
- Optimistic updates
- Background sync

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Flutter 3.x |
| State Management | BLoC / Cubit |
| Backend | Firebase Cloud Functions |
| Database | Cloud Firestore |
| Auth | Firebase Auth |
| Storage | Firebase Storage |
| Push Notifications | Firebase Cloud Messaging |
| Maps | Google Maps API |
| AI | Google Gemini API |
| Payments | Razorpay, Stripe |
| Analytics | Firebase Analytics |
| Crash Reporting | Firebase Crashlytics |

## Deployment Architecture

```
Production Environment:
  - Firebase Project (Production)
  - Google Cloud Project
  - App Store / Play Store
  - Web Hosting (Firebase Hosting)

Development Environment:
  - Firebase Project (Development)
  - Firebase Emulators
  - Local Flutter development
```

## Monitoring & Logging

- Firebase Crashlytics for crash reporting
- Firebase Performance Monitoring
- Cloud Functions logs
- Custom analytics events
- Admin audit logs
