# BuddyConnect — Backend

This repo contains the **Firebase Cloud Functions backend** for BuddyConnect,
plus Firestore/Storage security rules and project docs.

## What's in this repo

```
functions/src/
├── index.ts          re-exports everything below as deployable functions
├── api/              callable endpoints (auth, booking, payment, companion,
│                      admin, ai, verification, referral, SOS)
├── triggers/          Firestore/pubsub triggers (auth, booking, payment,
│                      notification, safety, analytics)
├── services/          shared helpers (AI, notifications, payments, email,
│                      SMS, analytics, safety) — not deployed as functions
│                      themselves, just imported by api/ and triggers/
└── middleware/        auth role checks, rate limiting, input validation

firestore.rules        Firestore security rules
storage.rules           Storage security rules
firestore.indexes.json  composite indexes required by the queries in api/
docs/                   architecture, API reference, security & deployment guides
preview/                a static HTML mockup of the app UI
```

## What is NOT in this repo

This is the backend only. The following are referenced in `docs/architecture.md`
but were never generated in the conversation this repo came from, so they are
genuinely absent — not just untracked:

- The Flutter client app (`lib/core`, `lib/data`, `lib/domain`, `lib/presentation`)
- The Admin / Super Admin dashboard frontend
- Android/iOS native project scaffolding, CI/CD pipelines

If you already have those from a different session, drop this repo's
`functions/`, `firestore.rules`, and `storage.rules` into that project's
existing structure rather than treating this as a full monorepo.

## Setup

```bash
cd functions
npm install
cp .env.example .env   # fill in real API keys - see .env.example
npm run build
```

Then from the repo root:

```bash
firebase login
firebase use --add          # select/create your Firebase project
firebase deploy --only firestore:rules,storage:rules,functions
```

For local testing before deploying:

```bash
firebase emulators:start --only functions,firestore,storage
```

## Known gaps to close before production

These are called out inline in the relevant files too, but the important ones:

- **Face verification** (`api/verificationApi.ts`) has a TODO where you need
  to wire in an actual biometric-matching provider (AWS Rekognition, Azure
  Face API, etc). It currently just records submissions for manual review.
- **Email/SMS providers** (`services/emailService.ts`, `services/smsService.ts`)
  call SendGrid/Twilio's HTTP APIs directly as an example — swap for whatever
  provider you actually use, and set the corresponding keys in `.env`.
- **Nearby search** (`api/companionApi.ts`) uses a haversine bounding-box
  filter over all active companions. Fine at city scale; switch to
  GeoFirestore/geohashing if the companions collection grows large.
- Run `firebase deploy --only firestore:indexes` — several queries in
  `api/` need the composite indexes defined in `firestore.indexes.json`.

## Platform rules enforced in code

Per the product spec, this is a **non-romantic, public-companionship**
platform. `validationMiddleware.validatePublicLocation` rejects booking/meeting
locations that look like hotels, private rooms, or residences, and
`safetyTriggers.onChatMessageCreated` runs both a keyword filter and a
Gemini-based check on chat messages for the same reason. These are
deterrents, not guarantees — pair them with the admin moderation dashboard
and human review for reports.
