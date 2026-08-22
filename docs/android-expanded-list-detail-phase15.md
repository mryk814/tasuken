# Android expanded list-detail — phase 15

Date: 2026-08-22
Parent: #400

## Problem

Tasken already used `NavigableListDetailPaneScaffold`, but the library's standard Medium-width directive remained single-pane. The unfolded Galaxy Z Fold 7 reports about 750dp in the verified configuration, so list and detail did not coexist even though both were usable at that width.

## Decision

Keep Material 3 Adaptive as the layout engine and retain its calculated posture, hinge exclusions, spacers, and default pane sizing. Override only `maxHorizontalPartitions` when the current **window width** is at least 700dp.

This is deliberately window-driven rather than model-, orientation-, or pixel-driven:

- below 700dp: preserve the official directive unchanged;
- 700dp and wider: permit at least two horizontal partitions;
- any stronger directive or hinge exclusion calculated by Android is preserved.

The 700dp boundary leaves enough space for a useful list pane and editable detail pane while covering the unfolded Fold 7 portrait window. It does not force two panes into ordinary 600dp Medium windows.

## Automated evidence

`TaskenAdaptiveDirectiveTest` verifies:

- 750dp enables two panes;
- 699dp preserves the official directive;
- hinge exclusions and partition spacing survive the override.

The implementation job runs `testDebugUnitTest`, `compileDebugAndroidTestKotlin`, and `assembleDebug` before committing.

## Remaining local acceptance

On Fold 7, verify folded/unfolded and rotation continuity for selected Task, list scroll, edit draft, and open Theme menu. The implementation contains no Galaxy-specific branch.

References:

- https://developer.android.com/develop/adaptive-apps/guides/list-detail
- https://developer.android.com/reference/kotlin/androidx/compose/material3/adaptive/layout/PaneScaffoldDirective
