# Tasken Android release signing

Date: 2026-08-22
Parent: #400

Tasken release APKs are signed only with user-owned local credentials. No keystore or password is committed.

## Configuration sources

Use one of these sources, in precedence order:

1. ignored `android-app/keystore.properties`;
2. Gradle properties;
3. environment variables.

| Environment / Gradle property | `keystore.properties` key |
| --- | --- |
| `TASKEN_ANDROID_KEYSTORE` | `storeFile` |
| `TASKEN_ANDROID_KEYSTORE_PASSWORD` | `storePassword` |
| `TASKEN_ANDROID_KEY_ALIAS` | `keyAlias` |
| `TASKEN_ANDROID_KEY_PASSWORD` | `keyPassword` |

Copy `android-app/keystore.properties.example` for the local-file route. The real properties file and common keystore extensions under `android-app/` are ignored.

## Create the long-lived key once

Let `keytool` prompt for secrets instead of writing passwords into shell history:

```powershell
New-Item -ItemType Directory -Force "$HOME\.tasken" | Out-Null
keytool -genkeypair -v `
  -storetype JKS `
  -keystore "$HOME\.tasken\tasken-release.jks" `
  -alias tasken `
  -keyalg RSA `
  -keysize 4096 `
  -validity 10000
```

Keep multiple secure backups of the keystore and credentials. Future APK updates must use the same application signing key.

## Build and verify on Windows

After configuring the four values, run:

```powershell
.\android-app\scripts\build-signed-release.ps1
```

Output:

```text
android-app/app/build/outputs/apk/release/app-release.apk
```

Release packaging fails before execution when required values are missing or the keystore path is invalid. Debug builds do not require release credentials.

## Independent verification

The implementation CI proves all three properties:

- debug unit tests, Android-test compilation, and debug APK succeed without secrets;
- unsigned `assembleRelease` is rejected;
- a throwaway JKS produces an APK accepted by Android `apksigner`.

The throwaway CI key is never suitable for the locally installed Tasken app.

Official guidance:

- https://developer.android.com/build/build-variants#signing
- https://developer.android.com/studio/publish/app-signing
