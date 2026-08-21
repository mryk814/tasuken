# Mobile bootstrap and cursor sync — Phase 5 evidence

Issue: #399

This phase adds the Task-only vertical slice for initial bootstrap and incremental pull. It does not close #399.

## Contract and convergence

- `GET /v1/bootstrap` returns a bounded active/recent Task snapshot and the current opaque Task change cursor.
- `GET /v1/sync?cursor=...` returns deterministic `(updated_at, id)` ordered Task upserts and tombstones.
- Reusing a cursor returns the same page while canonical data is unchanged; a page cursor advances only after the Room transaction applies every change.
- `serverId` is checked before applying a delta. A different Desktop identity triggers a new bootstrap instead of applying an old-server cursor.
- Bootstrap and delta transactions preserve Tasks with an optimistic outbox command or unresolved conflict.
- The foreground cycle pushes the outbox before pulling canonical deltas. Network failure continues to expose the existing Room cache.

## Automated evidence

- TypeScript typecheck: passed.
- Task/Mobile Gateway focused tests: 20 passed, including paged delta, cursor retry, tombstone, and changed `serverId`.
- Android `testDebugUnitTest assembleDebug assembleDebugAndroidTest`: passed on the Windows Android Studio JBR toolchain.
- Android contract tests reject ambiguous changes and incomplete bootstrap responses.
- Room instrumentation verifies atomic cursor advancement, canonical replacement, delta upsert, tombstone handling, and preservation of a pending local intent.

## S23 device evidence

Device: Samsung SC-51D connected through wireless debugging.

- App APK installed with `adb install -r`; app data was not cleared.
- Instrumentation: 19/19 passed.
- Cold launch: `LaunchState: COLD`, activity started successfully, and the app process remained alive.
- Filtered launch log contained no package FATAL exception or ANR marker.
- Test APK was removed after verification; the application APK and its data remain installed.

## Remaining #399 boundaries

- UpdateTask field-level patch conflict and three-way merge.
- A live Desktop-online race using a disposable fixture, including convergence after a real sleep/offline interval.
- WorkManager/background/reboot and Widget projection.
- Bootstrap currently covers Task cache only; Theme, Schedule, AI Inbox, and event summary remain later vertical slices.
