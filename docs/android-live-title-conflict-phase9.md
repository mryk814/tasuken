# Android live title conflict — Phase 9 evidence

Issues: #399, #400

This phase verifies both explicit same-field title conflict choices against the real paired S23 and Desktop canonical Task service. It fixes a draft-reset defect found during that device run. It advances, but does not close, either issue.

## Live conflict sequence

A disposable Task was created from the S23 UI and first converged to Desktop with server version 1 and an empty outbox.

### Desktop choice

1. Desktop changed the canonical title at expected version 1, producing version 2.
2. The still-stale Android detail edited the same title and sent a field patch based on version 1.
3. Android received and persisted a real version conflict showing both values:
   - `Desktop  Desktop-choice-1`
   - `この端末  Local-choice-1`
4. `Desktopを採用` cleared the conflict and retained the Desktop title.

The run exposed a defect: the detail heading used the accepted Desktop title, but the editable draft still contained the rejected local title. That left an accidental re-save path.

### Local-device choice

After fixing and reinstalling with `adb install -r`:

1. Desktop changed the canonical title again at expected version 2, producing version 3.
2. Android sent another same-field patch based on version 2 and displayed the second real conflict.
3. `この端末を採用` created the replacement command against the current server base.
4. Desktop Core returned the intended local title at version 4.
5. Android cleared its conflict and showed the same local title without a stale draft.

## Fix

- The title draft now follows the canonical Task title after `ConflictResolved` for the selected Task.
- The update is limited to the explicit conflict-resolution state, so ordinary background Task updates do not overwrite an unrelated in-progress edit draft.
- A Compose regression test reproduces `local draft → conflict → Desktop choice` and verifies that the editable value resets and the save button is disabled.

## Cleanup and final state

- The disposable version-4 Task was removed through the canonical, expected-version `DeleteTask` command.
- After Android process stop and cold start, the tombstone removed it from Room.
- Final device state: disposable Task count 0, outbox 0, conflicts 0, sync error null, Today empty.
- The instrumentation APK and all temporary UI hierarchy files were removed. The app APK, pairing, Room database, and personal app data were preserved.

## Verification

- Windows-native `testDebugUnitTest assembleDebug assembleDebugAndroidTest`: passed.
- S23 focused Compose suite: `OK (8 tests)`.
- S23 full instrumentation: `OK (24 tests)`.
- Final cold launch: successful in 772 ms.

## Remaining boundary

- Scheduled background delivery under Doze, reboot rescheduling, Wi-Fi/cellular transition, and widget projection remain unverified for #399.
- Theme, schedule, checklist, Tasks navigation/filtering, and other #400 MVP fields remain outside this slice.
