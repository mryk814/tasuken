# Android Today widget and background sync — Phase 10 evidence

Issue: #399

This phase adds the first Room-backed home-screen surface and a persistent background pull cycle. It advances, but does not close, #399.

## Widget vertical slice

- `TaskenTodayWidget` renders up to three Today Tasks from the private Room cache; rendering does not require network access.
- Each row can complete or reopen its Task. The receiver writes the action through `AndroidMobileTaskRepository`, which updates Room optimistically and appends the existing versioned Application Command to the outbox.
- The header and add affordance open the app. The compact status prioritizes conflict count, then pending count, then local sync state.
- Widget redraw uses one path after local action, one-shot outbox delivery, periodic sync, app start, and platform widget update.
- The provider is not exported and no Task body, token, local path, or Note content leaves app-private storage.

## Background sync

- App startup registers one unique 15-minute periodic WorkManager job, the Android platform minimum for periodic work.
- The job requires network connectivity but does not require charging, battery-not-low, or device idle.
- Each run recovers an interrupted `sending` command, pushes the outbox, pulls bootstrap/cursor delta when paired, then redraws the widget.
- Retry keeps the existing exponential policy. WorkManager persists and reschedules periodic work across process death and device reboot; no custom foreground service or always-on socket was added.

## Verification

- Windows-native `testDebugUnitTest assembleDebug assembleDebugAndroidTest`: passed.
- Widget status precedence unit test: passed.
- S23 update install used `adb install -r`; app data, Room, Keystore pairing, and personal data were preserved.
- S23 full instrumentation: `OK (24 tests)`.
- S23 package manager resolved `TaskenTodayWidget` for `APPWIDGET_UPDATE`.
- S23 JobScheduler registered `MobileBackgroundSyncWorker` with connectivity required and no charging, battery-not-low, or idle constraint.
- A forced periodic run completed and was rescheduled under a new JobScheduler id with the next 15-minute window.
- S23 cold launch succeeded in 825 ms; Today remained empty with no pending/conflict indicator.

## Remaining boundary

- The widget has not yet been placed on the user's Samsung launcher, so rendered widget pixels and a launcher-originated offline action are not signed off.
- Device reboot persistence, Doze execution, and Wi-Fi/cellular transition still need physical-device runs. Reboot and network transition are deferred because this session depends on wireless ADB.
- Cached Schedule notifications are not implemented yet.
