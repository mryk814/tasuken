# Tasken Android release signing

Date: 2026-08-22  
Parent: #400

Tasken release APKs are signed only with a user-owned local key. No keystore or password is committed to the repository.

## Configuration

Release signing reads the first non-empty value in this order:

1. ignored `android-app/keystore.properties`;
2. Gradle properties;
3. environment variables.

| Environment / Gradle property | `keystore.properties` key |
| --- | --- |
| `TASKEN_ANDROID_KEYSTORE` | `storeFile` |
| `TASKEN_ANDROID_KEYSTORE_PASSWORD` | `storePassword` |
| `TASKEN_ANDROID_KEY_ALIAS` | `keyAlias` |
| `TASKEN_ANDROID_KEY_PASSWORD` | `keyPassword` |

For the local-file route, copy `android-app/keystore.properties.example` to `android-app/keystore.properties` and fill it locally. The real properties file and common keystore file extensions under `android-app/` are ignored by Git.

## Create the long-lived key once

On Windows PowerShell, create a private directory and let `keytool` prompt for secrets. This avoids recording passwords in shell history.

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

Keep at least two secure backups of the keystore and its credentials. Android accepts an installed app update only when it is signed by the same application-signing key. Also increase `versionCode` before distributing an update build.

## Migrate an existing debug install without clearing data

Tasken development installs created before the first permanent release use the local Android debug certificate. Do not install a normally signed release APK over those installs: Android will reject the certificate mismatch, and uninstalling would remove Room, pairing, and Android Keystore state.

For the one-time transition, create an Android signing-certificate lineage from that exact legacy key to the permanent release key. The lineage must grant `installed-data` to the old signer and must not grant rollback. Keep the lineage and both keystores with the signing backup; API 26–32 APK signatures still require the oldest signer, while API 33+ uses the permanent rotated signer.

Configure all of the following environment values in addition to the four release values:

| Environment variable | Purpose |
| --- | --- |
| `TASKEN_ANDROID_LEGACY_KEYSTORE` | Exact keystore that signed the installed APK |
| `TASKEN_ANDROID_LEGACY_KEYSTORE_PASSWORD` | Legacy keystore password |
| `TASKEN_ANDROID_LEGACY_KEY_ALIAS` | Legacy key alias |
| `TASKEN_ANDROID_LEGACY_KEY_PASSWORD` | Legacy private-key password |
| `TASKEN_ANDROID_SIGNING_LINEAGE` | Binary lineage produced by `apksigner rotate` |
| `TASKEN_ANDROID_ROTATION_MIN_SDK_VERSION` | Optional; defaults to `33` |

The build script treats rotation as all-or-nothing and fails before signing when any required value or file is missing. Passwords are passed to `apksigner` by environment-variable reference, not as command-line values. The final APK is re-signed with the oldest and newest keys plus the lineage, then independently verified for Tasken's minimum SDK.

## Build and independently verify the APK

After configuring the four values, run from the repository root:

```powershell
.\android-app\scripts\build-signed-release.ps1
```

The script performs all of the following:

1. verifies that release-signing configuration is complete and the keystore exists;
2. builds `assembleRelease`;
3. requires the signed output `android-app/app/build/outputs/apk/release/app-release.apk`;
4. verifies the APK signature with Android `apksigner --print-certs`;
5. prints the SHA-256 digest and final APK path.

`assembleRelease`, bundle, packaging, signing, installation, and publication tasks fail closed when release signing is incomplete. Debug unit tests and debug APK builds remain independent of release credentials.

## CI verification

`.github/workflows/android-release-signing.yml` uses only a throwaway CI key. It proves that:

- debug unit tests and a debug APK succeed with no release secret;
- unsigned `assembleRelease` is rejected;
- an ephemeral JKS produces a release APK accepted by Android `apksigner`.
- an ephemeral old-to-new lineage produces a rotated release APK accepted from API 26 onward.

The throwaway CI certificate must never be used for the locally installed Tasken app.

## Official references

- Android build variants and signing configuration: https://developer.android.com/build/build-variants#signing
- Android app signing and key continuity: https://developer.android.com/studio/publish/app-signing
- Android `apksigner` rotation and lineage: https://developer.android.com/tools/apksigner
