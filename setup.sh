#!/bin/bash

echo "🚀 BuddyConnect Setup Script"
echo "=============================="

# Check Flutter
if ! command -v flutter &> /dev/null; then
    echo "❌ Flutter not found. Please install Flutter first."
    echo "   Visit: https://docs.flutter.dev/get-started/install"
    exit 1
fi

echo "✅ Flutter found: $(flutter --version | head -1)"

# Check Flutter doctor
echo ""
echo "🔍 Running Flutter Doctor..."
flutter doctor

# Navigate to project
cd flutter_app

# Get dependencies
echo ""
echo "📦 Installing dependencies..."
flutter pub get

# Check for issues
echo ""
echo "🔍 Analyzing code..."
flutter analyze

# Run app
echo ""
echo "🚀 Ready to run! Use one of these commands:"
echo "   flutter run              # Android/iOS (default)"
echo "   flutter run -d chrome    # Web"
echo ""
echo "Make sure you have:"
echo "   1. Firebase config files placed (google-services.json, GoogleService-Info.plist)"
echo "   2. Android emulator running OR iOS simulator running OR physical device connected"
echo ""
