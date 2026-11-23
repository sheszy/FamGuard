# Android APK

The Android wrapper uses Capacitor 6 with application ID `com.famguard.app`. Build and copy the current Vite assets with:

```powershell
npm run android:sync
npm run android:apk
```

The debug APK is written to `android\app\build\outputs\apk\debug\app-debug.apk` and is signed with Android's debug key. Open the `android` folder in Android Studio to run it on a device or emulator. Use JDK 17, Android SDK Platform 36, and Android SDK Build-Tools 36; accept the Android SDK licenses. The Gradle wrapper pins Gradle 8.11.1 and the Android Gradle plugin is 8.10.1. The app targets Android 14 (API 34) for the foreground-service overlay permission model.

To enable the floating launcher, open **Settings & tasks → Floating quick launcher** and turn it on. Android opens the **Display over other apps** permission page; allow FamGuard, return to the app, and enable the setting. The overlay service displays an ongoing Android notification while enabled. The style selector chooses either the snap-to-edge bubble/drawer or the 3 × 3 action grid. If the permission is declined, the setting remains off. In a normal browser or installed PWA the same setting shows an in-app launcher and does not request system overlay permission.

Google sign-in in the APK uses the system browser and the `com.famguard.app://callback` PKCE redirect. Add that redirect URL to the Supabase project's allowed redirect URLs. Keep the existing web origin and Google OAuth provider configuration as-is for browser sign-in. Calendar events and tasks continue syncing through the existing Supabase tables; no schema migration is required.

For a signed release APK, provide these environment variables to Gradle without committing them or a keystore:

```text
FAMGUARD_RELEASE_STORE_FILE
FAMGUARD_RELEASE_STORE_PASSWORD
FAMGUARD_RELEASE_KEY_ALIAS
FAMGUARD_RELEASE_KEY_PASSWORD
```

Then run `.\gradlew.bat assembleRelease` from the `android` directory. Debug builds do not need release signing credentials.
