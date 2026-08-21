# Android entry surfaces — Phase 11 evidence

Issues: #400, #401

This phase connects launcher shortcuts, widget navigation, app deep links, and the Android text share sheet to the existing Today/Capture flow. It advances, but does not close, either issue.

## Shared entry routing

- `tasken://today` opens the canonical Today surface.
- `tasken://capture/new` opens the existing saveable Capture sheet.
- `tasken://task/{id}` selects the matching cached Today Task and opens its adaptive detail pane.
- Entry requests carry an explicit source (`app_shortcut`, `widget`, `share_target`, or ordinary deep link) and are consumed once per Intent delivery.
- `MainActivity` uses `singleTop`, so a shortcut, widget, or share action delivered while Tasken is already visible updates the existing activity instead of stacking another copy.
- Unknown schemes, unknown routes, invalid Task ids, empty shares, and non-plain-text shares fail closed.

## Input surfaces

- Two static launcher shortcuts are registered: `Taskを追加` and `Todayを開く`.
- Android `ACTION_SEND text/plain` opens the same Capture sheet with the exact trimmed shared text or URL retained for user confirmation; it does not auto-save or send content to AI.
- Widget header, add, and Task-title actions now use the same deep links instead of generic activity launches.
- Save still uses the existing Room optimistic cache and CreateTask outbox, so online and offline entry paths do not gain a second write implementation.

## Verification

- Windows-native `testDebugUnitTest assembleDebug assembleDebugAndroidTest`: passed.
- Resolver unit tests cover shortcut Capture, widget Today/Task, exact text share retention, empty share, foreign scheme, and invalid Task id.
- S23 update install used `adb install -r`; app data, Room, Keystore pairing, and personal data were preserved.
- S23 full instrumentation: `OK (24 tests)`.
- S23 package manager resolved the browsable `tasken` scheme and `ACTION_SEND text/plain` to `MainActivity`.
- S23 ShortcutService registered both static shortcuts against `MainActivity`.
- S23 cold shortcut-equivalent Capture launch reached the real sheet in 793 ms.
- With Today already running, Capture and Share Intents were delivered to the same top activity; the real sheet retained `singleTop-share-retained` without saving it.
- All temporary UI hierarchy files and the instrumentation APK were removed.

## Remaining boundary

- Launcher long-press pixels and tapping the shortcuts by hand are not visually signed off; registration and actual equivalent Intents are proven.
- A real cached Task was not opened from `tasken://task/{id}` in this slice; route validation is unit-tested and the same selected-Task detail path is used.
- Voice dictation, Capture provenance persistence, Theme selection, continued-entry/Undo, and process-death/fold validation for external drafts remain for #401.
- Full Tasks/Capture/AI navigation, Theme/schedule/checklist editing, signed release APK, and Fold7 visual/adaptive signoff remain for #400.
