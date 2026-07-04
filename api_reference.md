# BuddyConnect API Documentation

## Authentication APIs

### `loginWithEmail(email, password)`
Authenticates user with email and password.

**Parameters:**
- `email` (string): User email
- `password` (string): User password

**Returns:** `AuthAuthenticated` state with UserEntity

### `loginWithGoogle()`
Authenticates user with Google Sign-In.

**Returns:** `AuthAuthenticated` state with UserEntity

### `sendPhoneOTP(phoneNumber)`
Sends OTP to phone number.

**Parameters:**
- `phoneNumber` (string): Phone with country code (+91...)

**Returns:** `AuthPhoneVerificationSent` with verificationId

### `verifyPhoneOTP(verificationId, smsCode)`
Verifies phone OTP.

**Parameters:**
- `verificationId` (string): Verification session ID
- `smsCode` (string): 6-digit OTP

## Booking APIs

### `createBooking(BookingEntity booking)`
Creates a new booking request.

**Parameters:**
- `booking`: Booking details (companion, date, time, location)

**Returns:** Created BookingEntity

### `updateBookingStatus(bookingId, status)`
Updates booking status.

**Status Values:**
- `pending` - Initial request
- `accepted` - Companion accepted
- `rejected` - Companion declined
- `confirmed` - Payment completed
- `ongoing` - Meeting in progress
- `completed` - Meeting finished
- `cancelled` - Cancelled by user/companion

### `cancelBooking(bookingId, reason)`
Cancels booking with automatic refund calculation.

**Refund Policy:**
- >24 hours before: 100% refund
- 12-24 hours: 75% refund
- 6-12 hours: 50% refund
- 2-6 hours: 25% refund
- <2 hours: No refund

## Payment APIs

### `createStripePaymentIntent(amount, currency, bookingId)`
Creates Stripe payment intent.

**Returns:** `{ clientSecret, paymentIntentId }`

### `createRazorpayOrder(amount, currency, receipt)`
Creates Razorpay order.

**Returns:** `{ orderId, amount, currency, keyId }`

### `verifyRazorpayPayment(orderId, paymentId, signature, bookingId)`
Verifies Razorpay payment signature.

**Returns:** `{ success, message }`

### `topUpWallet(amount, paymentMethod)`
Adds funds to wallet.

### `withdrawFromWallet(amount, bankDetails)`
Requests wallet withdrawal (min Rs.500).

## AI APIs

### `aiMatchCompanion(userId, category, preferences)`
AI-powered companion matching.

**Returns:** `{ matches: [{ companionId, matchScore, reason }] }`

### `aiChatAssistant(message, chatHistory)`
AI chatbot for user support.

**Returns:** `{ response, timestamp }`

### `aiSafetyCheck(content, type)`
Content moderation and safety check.

**Returns:** `{ isSafe, violations[], severity, action }`

### `aiWriteProfile(category, skills, languages, experience)`
AI-generated companion bio.

**Returns:** `{ bio }`

## Safety APIs

### `handleSOSAlert(latitude, longitude, bookingId)`
Triggers emergency SOS alert.

**Actions:**
- Logs SOS event
- Notifies emergency contacts
- Notifies admins
- Calls emergency number (112)

### `validateMeetingLocation(location, latitude, longitude)`
Validates meeting location for safety.

**Returns:** `{ isSafe, suggestions[] }`

### `updateLiveLocation(bookingId, latitude, longitude)`
Updates live location during active booking.

## Admin APIs

### `getAdminStats()`
Returns dashboard statistics.

**Returns:** `{ totalUsers, activeCompanions, totalBookings, pendingVerifications, pendingReports, todayBookings }`

### `adminBlockUser(userId, action, reason)`
Blocks or unblocks user.

### `adminVerifyCompanion(companionId, status, notes)`
Approves or rejects companion verification.

### `adminGetUsers(limit, lastDocId, searchQuery)`
Paginated user list for admin.

## Companion APIs

### `getCompanions(filters)`
Gets companions with filters.

**Filters:**
- categories (List<String>)
- minRating (double)
- maxPrice (double)
- gender (String)
- languages (List<String>)
- isOnline (bool)
- isVerified (bool)

### `getNearbyCompanions(latitude, longitude, radiusKm, categories, limit)`
Gets companions near location.

### `searchCompanions(query)`
Searches companions by name or bio.

## Chat APIs

### `createChat(bookingId, participants)`
Creates chat room for booking.

### `sendMessage(chatId, MessageEntity message)`
Sends message to chat.

**Message Types:**
- `text` - Text message
- `image` - Image attachment
- `voice` - Voice message
- `location` - Location sharing
- `system` - System notification

### `getMessages(chatId, limit, lastMessageId)`
Gets paginated messages.

### `markMessagesAsRead(chatId, userId)`
Marks messages as read.
