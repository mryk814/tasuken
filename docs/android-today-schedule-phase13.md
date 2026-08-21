# Android Today schedule editing — Phase 13 evidence

Issue: #400

This phase adds one explicit schedule operation to Task detail: put a Task on Today or remove it from Today. It advances, but does not close, the Android Companion MVP issue.

## Contract and command path

- Mobile `UpdateTask` accepts exactly one patch field: `title` or nullable `todayDate`.
- The Gateway maps mobile `todayDate` to the canonical Task `today_date` field before calling the shared Task capability.
- `changes` and `base` must contain the same single field, preserving three-way merge and same-field conflict behavior.
- Command receipts and version conflicts now return `todayDate`, so Android reconciles Room from the canonical result rather than retaining an optimistic date.
- Unknown fields, mixed-field patches, invalid dates, mismatched base fields, and forged command metadata still fail closed.

## Android behavior

- Task detail displays `日付  未設定`, `日付  今日`, or the explicit date.
- `今日に入れる` and `今日から外す` enqueue the existing `UpdateTask` outbox path; no Android-only schedule grouping or second write path was added.
- Room updates optimistically while the command is pending.
- Schedule conflicts retain the server date and nullable local intent separately, and the existing `この端末を採用` / `Desktopを採用` actions work for both title and schedule changes.
- Room schema v6 adds only the conflict fields needed to restore that intent; migration preserves existing cache, outbox, pairing, and conflict data.

## Verification

- TypeScript typecheck: passed.
- Mobile Gateway contract/integration test: 11 passed, including set and clear of canonical `today_date`.
- Windows-native `testDebugUnitTest assembleDebug assembleDebugAndroidTest`: passed.
- S23 update install used `adb install -r`; the real Room database migrated from v5 to v6 with app data and pairing preserved.
- S23 full instrumentation: `OK (28 tests)`.
- Instrumentation covers v5→v6 migration, nullable schedule envelopes, optimistic Room state, explicit conflict resolution, visible schedule action, and schedule conflict values.
- On the S23 real Task detail, an unscheduled cached Task displayed `日付  未設定` and the enabled `今日に入れる` action without clipping.

## Remaining boundary

- The currently running Desktop runtime predates this contract extension, so a personal Task was not mutated through the live paired Gateway in this slice.
- Arbitrary date, period, due/date-kind, reminder, and planning-shelf editing remain incomplete.
- Theme and checklist editing remain incomplete.
- Fold/unfold and Fold7 adaptive visual signoff remain unverified.
- Signed release APK verification remains open.
