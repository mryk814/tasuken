# Android planned start/duration editing — Phase 16

Issue: #400

This slice lets Android edit canonical `planned_start_time` and `planned_duration_minutes` without touching `todayDate` or the date-range Schedule entity.

## Contract and command path

- Mobile `UpdateTask` accepts one additional atomic patch: `plannedSchedule: { startTime, durationMinutes }`.
- Both values are nullable. Clearing them is a valid patch. Invalid `HH:mm` and non-positive duration fail closed.
- The Gateway maps that object to canonical Task fields `planned_start_time` and `planned_duration_minutes` before the shared Task capability.
- `changes` and `base` stay same-field. Receipts and version conflicts return the planned fields so Room converges from the canonical result.
- Today list projection still omits these fields, matching the existing `todayDate` leak-minimizing projection. Bootstrap, sync, command receipts, and conflicts include them.

## Android behavior

- Task detail has a 時刻 editor independent of 予定 (date range) and 今日に入れる.
- Saving enqueues the existing outbox `UpdateTask` path. No Android-only timeboxing rule is added.
- Room schema v9 stores the planned fields on cache and conflict rows. Migration preserves cache, outbox, pairing, and existing conflicts.
- Planned-schedule conflicts keep the server values in cache and the local intent on the conflict row. `この端末を採用` / `Desktopを採用` resend the atomic patch.

## Remaining boundary

- Fold 7 unfolded list-detail and the 時刻 editor were visually confirmed on SM-F966Q. Physical fold/unfold continuity still needs a hand check.
- Live paired Gateway mutation against a personal Task is still an environment-dependent check (Desktop/Tailscale was unreachable during this run).
- Checklist editing and #401 / #402 remain separate slices.
