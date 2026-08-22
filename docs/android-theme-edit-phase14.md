# Android Theme editing — Phase 14 evidence

Issue: #400  
Pull request: #455

This phase adds canonical Theme selection to Task detail, including offline editing, restart recovery, rejection handling, and compatibility with Desktop versions that do not expose the Theme catalog. It advances, but does not close, the Android Companion MVP issue.

## Contract and command path

- Mobile Gateway exposes a read-scoped, paginated Theme catalog containing only `id` and `title`.
- Android `UpdateTask` sends a nullable `themeId`; the Gateway maps it to canonical `project_id` and delegates the mutation to the shared Task capability.
- Selecting no Theme normalizes to the canonical Personal Theme rather than introducing an Android-only value.
- A missing or logically deleted Theme returns HTTP 404 with `theme_not_found`, `retryable: false`, and the safe message `選択したThemeは削除済みか利用できません。`.
- Other invalid commands remain `validation_failed`; the dedicated mapping requires `INVALID_COMMAND` with a concrete `details.themeId`.

## Android behavior

- Task detail exposes the cached Theme catalog through one picker and shows the canonical Personal Theme as `個人業務`.
- Selection uses the existing Room outbox and optimistic projection. There is no direct Android-to-database write path.
- The catalog is owned by the paired server and cannot leak across re-pairing or delayed work from an older server.
- Process restart restores the optimistic Theme and pending state while Desktop is unavailable.
- A permanent rejection rolls the Task back to the canonical Theme and persists a visible card with `選び直す` and `取り下げる` actions.
- Desktop versions without `/v1/themes` keep Task detail usable while showing Theme as unsupported and disabled.

## Verification

- TypeScript typecheck: passed.
- Mobile Gateway contract and runtime tests: 16 passed.
- Windows-native Android Studio JBR/SDK: 42 JVM tests passed; `compileDebugAndroidTestKotlin` and `assembleDebug` passed.
- The current transport regression test covers HTTP 404 `theme_not_found` through Android parsing, Rejected outbox state, rollback, optimistic-state removal, and message projection. It compiled successfully.
- The feature build previously completed the API 35 instrumentation suite with 71 passing tests. The added transport regression was not rerun through instrumentation on the paired personal device because that test class intentionally clears connection-store state.
- Galaxy Z Fold 7 `SM-F966Q`, API 36: update installation used `adb install -r`; app data and pairing were preserved.
- The Fold journey passed old-Desktop unsupported behavior, new-Desktop catalog loading, online selection and canonical convergence, offline selection, Android process restart, pending restoration, Desktop recovery, permanent rejection, canonical rollback, reselect/discard controls, and cleanup.
- A second isolated Fold journey against commit `5576751` confirmed the exact corrected rejection message on screen. The disposable Task and Theme were then logically deleted, the rejection was discarded, and a cold app restart showed no remaining QA Task, rejection, or pending state.

## Remaining boundary

- Arbitrary due date and period editing remain incomplete.
- Checklist editing remains incomplete.
- The unfolded Fold currently reports a 750 dp window but still renders one pane; list-and-detail expanded layout acceptance remains open.
- Signed release APK verification remains open.
- API 37 beta instrumentation remains unverified.
- The isolated Windows Desktop Gateway was exercised successfully, but its renderer still hits the known Vite `/src/main.tsx` path-virtualization failure in this QA workspace. Desktop rendered signoff is therefore not claimed here.
