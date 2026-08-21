# Android Tasks navigation — Phase 12 evidence

Issue: #400

This phase adds the first Room-backed Tasks surface beside Today. It advances, but does not close, the Android Companion MVP issue.

## Tasks surface

- Compact navigation now has one canonical route each for `Today`, `Tasks`, and `追加`.
- `Tasks` observes the complete bounded Room cache instead of reusing only the Today projection.
- Search matches Task titles without changing the cached source of truth.
- Filters distinguish active, completed, and all cached Tasks.
- Today and Tasks retain independent list scroll positions.
- The active section, search query, filter, scroll positions, selected Task, and Capture draft use saveable pane state.
- The AI destination is intentionally absent until #402 provides a connected surface; this phase does not add a dead navigation item.

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

- The Tasks filters do not yet include Theme, Today/upcoming/unscheduled subdivisions, or AI work-state views.
- Task detail does not yet edit Theme, schedule, checklist, description/completion note, executor, or Work Receipt.
- Fold/unfold, landscape, multi-window, font-scale, and Fold7 visual/adaptive signoff remain unverified.
- Signed release APK verification remains open.
