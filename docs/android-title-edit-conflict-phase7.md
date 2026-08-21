# Android title edit and conflict resolution — Phase 7 evidence

Issues: #399, #400

This phase connects title editing from the Android UI through Room and the ordered outbox to the canonical Mobile Gateway field-patch contract. It advances, but does not close, either issue.

## Behavior

- A Task title can be edited from the Android detail pane while offline.
- Saving writes the optimistic title and an immutable `UpdateTask` envelope in one Room transaction.
- The envelope records matching `base.title` and `changes.title` values for field-level merge semantics.
- A same-field server conflict preserves both the canonical Desktop title and the intended local title.
- `Desktopを採用` keeps the canonical title and clears the conflict.
- `この端末を採用` creates a replacement command with a new command ID, the current server title as its base, and the preserved local title as its intended change.
- Editing is disabled while the Task already has a pending command or unresolved conflict.

## Automated evidence

- Windows-native Android build completed for `testDebugUnitTest`, `assembleDebug`, and `assembleDebugAndroidTest`.
- Room migration 4 to 5 preserves existing conflicts and adds the nullable local title field.
- Outbox tests cover optimistic title persistence, envelope base/changes, same-field conflict persistence, and keep-local replacement.
- Compose tests cover title editing/submission and display of both conflict values.

## S23 device evidence

- Target model was verified as `SC-51D` before installation.
- The app and instrumentation APKs were installed with `adb install -r`; app data was not cleared or uninstalled.
- Instrumentation completed `OK (23 tests)`: migration 4, outbox 11, Compose UI 7, capture 1.
- A cold launch completed successfully (`LaunchState: COLD`, `TotalTime: 778 ms`).
- The process remained alive and filtered post-launch logs contained no fatal exception or ANR marker.
- The instrumentation APK was removed after verification; the app APK and personal app data were preserved.

## Remaining boundary

- A live Android-to-Desktop online race and eventual-convergence run has not yet been completed.
- Theme, schedule, checklist, background/reboot delivery, widget behavior, and the full Tasks/Capture/AI navigation remain outside this slice.
- These remaining acceptance boundaries keep #399 and #400 open.
