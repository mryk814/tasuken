# Android Tasks navigation — Phase 12 evidence

Issue: #400

This phase adds the first Room-backed Tasks surface beside Today. It advances, but does not close, the Android Companion MVP issue.

## Shared Desktop concepts (2026-08-31)

- The Android destination is now labeled `ToDo`, matching Desktop. Its route key remains `AppSection.Tasks`, so saved navigation and deep links are unchanged.
- The open filter is labeled `未完了`: it includes todo, doing, waiting, and review, not only doing. Completed Tasks offer `未完了に戻す`; pending completion can be changed with `未完了に変更`. Commands and human-review restrictions are unchanged.
- Today, ToDo, and AI Task/Proposal cards display the related Theme name from the existing catalog. Long names wrap to at most two lines; unknown or unavailable catalog entries do not expose raw IDs or invent a Theme name.
- Catalog updates use the existing observed state, including cached/offline names. This adds no Theme color payload, filter, persistence, or write path.
- Regression coverage is in `TaskListContextUiTest`, `TaskListFilterTest`, `TaskEntryFlowUiTest`, and `TaskStateActionUiTest`. Fixture rendering does not replace the live Gateway/device acceptance tracked in #477.

The sections below record the original Phase 12 implementation and validation, not the current completion status of #400 or #402.

## Tasks surface

- Compact navigation now has one canonical route each for `Today`, `Tasks`, and `追加`.
- `Tasks` observes the complete bounded Room cache instead of reusing only the Today projection.
- Search matches Task titles without changing the cached source of truth.
- Filters distinguish active, completed, and all cached Tasks.
- Today and Tasks retain independent list scroll positions.
- The active section, search query, filter, scroll positions, selected Task, and Capture draft use saveable pane state.
- The AI destination was intentionally absent here. Phase 0 of #402 adds the connected read-only AI Inbox; see `docs/android-ai-inbox-phase0.md`.

## Detail and deep links

- Selecting a Task resolves its detail from the complete cache, including Tasks that are not scheduled for Today.
- `tasken://task/{id}` switches to Tasks and opens the same adaptive detail path.
- Leaving search for a Task detail clears focus and dismisses the software keyboard.
- Stored work-state values are displayed through Japanese labels instead of exposing internal snake_case values.

## Verification

- Windows-native `testDebugUnitTest assembleDebug assembleDebugAndroidTest`: passed.
- Unit coverage includes Tasks filter/search behavior, saveable section/filter/search/scroll state, and work-state labels.
- S23 update installs used `adb install -r`; app data, Room cache, pairing metadata, and personal Tasks were preserved.
- S23 full instrumentation: `OK (24 tests)`.
- On the real S23 cache, Tasks displayed active items, completed filtering displayed completed items, and the `XRD` query reduced the list to the matching Task.
- A real cached Task with no Today date opened from `tasken://task/{id}` while the app was already running.
- The resulting detail showed the expected title and `作業状態  未委任`; the prior search keyboard was dismissed.

## Remaining boundary

- The Tasks filters do not yet include Theme, Today/upcoming/unscheduled subdivisions.
- Task detail does not yet edit checklist, description/completion note, or executor. Work Receipt is read-only in the AI Inbox (Phase 0).
- Fold/unfold, landscape, multi-window, font-scale, and Fold7 visual/adaptive signoff remain unverified.
- Signed release APK verification remains open.
