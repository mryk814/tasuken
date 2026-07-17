# Tasken navigation audit — 2026-07-15

## Scope

Desktop app, 1466×973. Captured the current startup/theme view, Today, Inbox, ToDo, Timeline, Notes, Knowledge, Waiting, AI Import/Export, Settings, and a task detail drawer.

## User goal

Capture a thought quickly, decide where it belongs, turn it into work or knowledge, then keep the current context visible while planning and reviewing.

## Flow steps

1. Startup / selected Theme — visually calm and useful for a known Theme, but the first action is not obvious.
2. Today — strong daily overview, but several competing “look here next” areas are visible at once.
3. Inbox整理 — the capture-to-task conversion is compact, but “整理する” hides the destination and outcome.
4. ToDo — the list is easy to scan for a power user; small icon-only row actions need stronger cues.
5. Timeline — capable and information-rich, but the control vocabulary and dense Gantt make the first read difficult.
6. Notes / Knowledge — the separation is defensible, though the boundary between Note, Resource, Prompt, Chat reference, and Knowledge is learned rather than discovered.
7. Waiting — the core concept is clear; “受領” and incomplete “相手” data need stronger state explanation.
8. AI Import/Export — the two-way flow is visible, but implementation terminology leaks into the user-facing surface.
9. Task drawer — the detail/edit separation is clear; the drawer remains visible after navigation to another context.

## Highest-impact findings

1. **P1 — Startup has no explicit home contract.** The app opens on a Theme dashboard (`Taskenの開発`) while Today is the most obvious daily starting point. A new user may not know whether to begin in the Theme, Today, or Inbox.
2. **P1 — Inbox整理 is a semantic black box.** The row has `種類`, `Theme`, and `予定日`, but the primary action is only `整理する`. The user cannot infer whether this creates a Task, moves the capture, or merely saves fields.
3. **P1 — Drawer context leaks across routes.** After opening a ToDo task and navigating to the Theme, the old `タスク詳細` drawer remains visible. This makes the current page and the selected object disagree.
4. **P1 — Today duplicates attention signals.** Metrics, task sections, right-side “今見るもの”, and “再発見” all compete for the next action. It is efficient once learned, but not self-explanatory.
5. **P1 — AI Import/Export exposes maintenance concepts.** `Legacy → v2 マイグレーション`, `Legacy item`, and raw JSON are implementation language. The migration block should be hidden or moved to a maintenance area unless it needs user action.
6. **P2 — Navigation is organized by system structure, not user intent.** “横断ビュー” and “ツール” describe the app’s architecture. The user still has to remember whether a piece of work belongs in Inbox, Notes, Knowledge, Chat参照, or AI Import/Export.
7. **P2 — Timeline controls are dense and partly self-explanatory only after use.** The scale and dependency toggles need short labels/tooltips or a couple of named view presets.
8. **P2 — Vocabulary drifts by screen.** `Notes & Resources`, `メモ`, `リソース`, `Chat参照`, `チャットリンク`, `予定日`, `予定終了`, and `期限` make the same conceptual map feel larger than it is.

## Accessibility risks visible from screenshots

- Timeline controls and drawer metadata are small at the captured viewport.
- Several ToDo and Timeline actions are icon-only; add visible hover/focus descriptions and verify keyboard focus order.
- Status meaning relies partly on color and tiny badges; keep the text/status label as the primary signal.
- Keyboard, screen reader, resize/zoom, dark mode, and error-state behavior were not verified in this pass.

## Recommended order

1. Close or reset the drawer on route change.
2. Make the startup contract explicit: Today-first, or a clearly labeled Theme dashboard with a visible “今日” handoff.
3. Rename Inbox actions by destination, e.g. `タスクとして整理`, and show the post-save destination (`ToDoに追加しました`).
4. Remove or relocate the visible Legacy → v2 migration panel.
5. Reduce Today to one primary focus area plus compact links to Inbox, overdue work, and milestones.
6. Do one vocabulary pass across navigation, page titles, fields, and statuses.

## Evidence limits

This is a current-state desktop audit using the existing fixture data. It does not establish full accessibility compliance, performance, fresh-install onboarding quality, or the behavior of every save/error/import path.
