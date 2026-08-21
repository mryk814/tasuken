# Android Companion Phase 0B

## Scope

Phase 0B replaces the launch marker with one connected `Today` route owned by #400.

- `MobileTaskRepository` is the Android read boundary. Desktop SQLite remains the only canonical database.
- `TodayViewModel` exposes immutable loading, empty, error, and success states.
- Production currently uses `DisconnectedMobileTaskRepository`, so it reports the unavailable Gateway and recovery action truthfully. It does not ship dummy or seed Tasks.
- `currentWindowAdaptiveInfo` and Material 3 Adaptive 1.2.0's list-detail navigator choose compact, medium, and expanded pane behavior from official window posture/size information. No device-name or hand-written `600dp` split exists.
- Selected Task and list scroll position use saveable state and have recreation tests.
- Light and dark Tasken color schemes define primary, secondary, tertiary, and container roles explicitly; Material's default purple roles do not leak into the app.

`contracts/mobile/v1/today-response.golden.json` is the single language-neutral golden fixture matching the strict `/v1/today` success response. The TypeScript Zod contract test parses that file, and Gradle exposes the same root file directly to Kotlin DTO tests without copying it into Android resources. Production never displays fixture data.

## Reachable states

| State | Source | User-facing result |
|---|---|---|
| Loading | Initial state and each retry | Progress indicator |
| Empty | Successful repository response with zero Tasks | Empty Today message |
| Error | Gateway unavailable or repository failure | Cause, recovery action, retry button |
| Success | Successful repository response with Tasks | Adaptive list and selected detail pane |

All four are unit tested at the state-holder boundary. The current production repository reaches Error until authenticated Gateway transport is connected in the next vertical slice.

## Validation ladder

Run from a Windows-native copy with Android Studio JBR and SDK configured:

```powershell
.\gradlew.bat --version
.\gradlew.bat :app:testDebugUnitTest
.\gradlew.bat :app:assembleDebug
```

For a physical device, select it explicitly and preserve app data:

```powershell
adb -s <serial> install -r app\build\outputs\apk\debug\app-debug.apk
adb -s <serial> shell am start -W -n jp.personal.tasken.companion/.MainActivity
```

Build success and the S23 Error-state smoke do not prove a real authenticated `/v1/today` Success response, selection restoration with actual Tasks, or visual signoff across compact/medium/expanded windows. Those remain explicit acceptance boundaries.

## Evidence (2026-08-21)

- Windows 11, Android Studio JBR 21, Gradle Wrapper 9.6.1: `:app:testDebugUnitTest` and `:app:assembleDebug` are the required gates. Exact post-P1 counts are recorded in the delivery evidence rather than frozen here.
- Galaxy S23 SC-51D: serial-targeted `adb install -r` succeeded and explicit `.MainActivity` cold launch completed in 876 ms without an AndroidRuntime/FATAL/ANR/process-died marker.
- Portrait hierarchy was `1080x2340` with one Today pane and the truthful Gateway error/retry state.
- Landscape hierarchy was `2340x1080` with list bounds `[98,247][1043,1041]` and detail bounds `[1106,247][2340,1041]`. The process remained alive through recreation, and device rotation settings were restored to their original values.
- The captured screenshot could not receive visual signoff in the WSL session because its image-view sandbox dependency was unavailable. Pairing, a real Today success payload, task selection/scroll restoration with live Tasks, medium/expanded window breadth, Fold continuity, and offline restart remain unverified.
