# Android Companion Phase 0A

## Scope

`android-app/` is an independent Gradle project with one `:app` module. Phase 0A establishes only a launchable Kotlin/Compose shell and a JVM unit-test path.

This slice intentionally does not add feature/core Gradle modules, Room, networking, Tailscale, pairing, sync, widgets, or fake Today data. The first screen is a shell marker, not a product screen.

Ownership is deliberately split by issue: #400 owns `app/` shell, UI, and future feature/domain wiring; #399 owns `data.local` and `data.sync`; #398 owns `data.remote` and the Mobile Gateway boundary. Changes to `app/build.gradle.kts` are serialised through this scaffold before those slices add dependencies.

The future contract consumer may be placed under `android-app/app/src/main` after the Mobile Gateway contract is generated. Kotlin must consume a language-neutral schema or golden JSON fixtures; it must not import Desktop TypeScript or Zod directly, and no Desktop database is copied into this project.

## Toolchain choice

The versions below are already used by other local Android workspaces and available in the local Windows SDK/Gradle caches on 2026-08-21:

| Component | Version | Reason |
| --- | --- | --- |
| Gradle | 9.6.1 | Existing wrapper distribution and executable wrapper in the local cache |
| Android Gradle Plugin | 9.3.1 | Latest cached AGP used by the current local `ashiato` workspace |
| Kotlin Compose plugin | 2.3.20 | Latest cached Kotlin plugin used by the current local `ashiato` workspace |
| compileSdk / targetSdk | 36 | Stable installed local SDK platform `android-36`; avoids the locally installed API 37 preview |
| minSdk | 26 | Covers the intended modern foldable/devices without adding legacy compatibility code |
| Compose BOM | 2026.06.01 | Latest cached BOM used by the current `ashiato` project |
| Activity Compose | 1.13.0 | Latest cached version used by other local Android workspaces |

Java/Kotlin compilation is pinned to Java 17, matching the Android Gradle Plugin 9.x development baseline. AGP 9.3.1 + Gradle 9.6.1 is the pair already used by the current local `ashiato` workspace and was used to validate this scaffold. The Windows Android Studio JBR and Android SDK remain environment prerequisites; they are not committed to this repository.

## Validation boundary

The intended ladder is:

```powershell
.\gradlew.bat --version
.\gradlew.bat :app:testDebugUnitTest
.\gradlew.bat :app:assembleDebug
```

This WSL checkout can provide the source and wrapper, but Windows Android Studio JBR/SDK and a Windows-native checkout are the evidence boundary for the exact commands above. Physical-device install, launch, Fold posture, and rendered UI remain out of scope for Phase 0A.
