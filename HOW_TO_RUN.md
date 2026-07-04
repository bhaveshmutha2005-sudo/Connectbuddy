# 🚀 BuddyConnect - How to Run

## Prerequisites (Install These First)

### 1. Flutter SDK
```bash
# macOS
brew install flutter

# Windows
# Download from https://docs.flutter.dev/get-started/install

# Verify installation
flutter doctor
```

### 2. Android Studio (for Android)
- Download from https://developer.android.com/studio
- Install Android SDK
- Create an Android Virtual Device (AVD)

### 3. Xcode (for iOS - macOS only)
- Install from Mac App Store
- Install Xcode Command Line Tools: `xcode-select --install`

### 4. Firebase Setup
1. Go to https://console.firebase.google.com
2. Create a new project named "buddyconnect"
3. Add Android app (package name: com.buddyconnect.app)
4. Add iOS app (bundle ID: com.buddyconnect.app)
5. Download `google-services.json` (Android) and `GoogleService-Info.plist` (iOS)
6. Place them in the correct locations (see below)

---

## 📁 Project Setup

### Step 1: Place Firebase Config Files
```
flutter_app/android/app/google-services.json
flutter_app/ios/Runner/GoogleService-Info.plist
```

### Step 2: Install Dependencies
```bash
cd flutter_app
flutter pub get
```

### Step 3: Fix Known Issues (Run These Commands)

```bash
# Fix Android build.gradle
cd flutter_app/android

# Add to android/app/build.gradle inside defaultConfig:
# minSdkVersion 23
# targetSdkVersion 34

# Add to android/build.gradle:
# classpath 'com.google.gms:google-services:4.4.0'

# Add to android/app/build.gradle at bottom:
# apply plugin: 'com.google.gms.google-services'
```

### Step 4: Run the App

```bash
# For Android (make sure emulator is running or device is connected)
flutter run

# For iOS (macOS only)
flutter run -d ios

# For Web
flutter run -d chrome
```

---

## 🔧 Common Issues & Fixes

### Issue 1: `minSdkVersion` too low
**Fix:** In `android/app/build.gradle`, change:
```gradle
minSdkVersion 23
```

### Issue 2: MultiDex error
**Fix:** In `android/app/build.gradle`, add:
```gradle
defaultConfig {
    multiDexEnabled true
}
dependencies {
    implementation 'androidx.multidex:multidex:2.0.1'
}
```

### Issue 3: Missing `google-services.json`
**Fix:** Download from Firebase Console and place in `android/app/`

### Issue 4: iOS build fails
**Fix:** Run these commands:
```bash
cd ios
pod install --repo-update
```

### Issue 5: `flutter_bloc` not found
**Fix:** 
```bash
flutter clean
flutter pub get
```

---

## 🧪 Testing the App

### Without Firebase (Offline Mode)
The app will show the login screen but won't authenticate without Firebase setup.

### With Firebase Emulator (Local Testing)
```bash
# Install Firebase CLI
npm install -g firebase-tools

# Start emulators
cd firebase
firebase emulators:start

# Run app pointing to emulator
flutter run --dart-define=USE_EMULATOR=true
```

### With Real Firebase (Production)
After completing Firebase setup, the app will connect to your real Firebase project.

---

## 📱 What You'll See

1. **Splash Screen** - BuddyConnect logo with loading animation
2. **Login Screen** - Email, Google, and Phone login options
3. **Home Screen** - Bottom navigation with Search, Bookings, Chat, Wallet, Profile
4. **Search Screen** - Category filters, companion cards, map view
5. **SOS Button** - Floating emergency button on search screen

---

## 🎨 Customization

### Change App Name
Edit `flutter_app/android/app/src/main/AndroidManifest.xml`:
```xml
<application android:label="BuddyConnect">
```

### Change Primary Color
Edit `flutter_app/lib/core/theme/app_theme.dart`:
```dart
static const Color primaryColor = Color(0xFF6C63FF);
```

### Add Your Logo
Replace `flutter_app/assets/icons/logo.png` with your logo.

---

## 🚀 Building for Release

### Android APK
```bash
flutter build apk --release
```
Output: `build/app/outputs/flutter-apk/app-release.apk`

### Android App Bundle (for Play Store)
```bash
flutter build appbundle --release
```

### iOS
```bash
flutter build ios --release
```
Then archive in Xcode and upload to App Store Connect.

---

## 📞 Need Help?

1. Run `flutter doctor` to check your setup
2. Check the documentation in `docs/` folder
3. Review Firebase setup guide: https://firebase.google.com/docs/flutter/setup
