# Task予定・ChecklistのMobile書き込み契約

Issue #534では、既存のTask予定開始時刻と所要時間をMobileから編集できるようにする。
新しい日程概念は追加しない。

- `CreateTask.task.plannedStartTime` と `plannedDurationMinutes` は任意・nullable。
- `UpdateTask.changes/base.plannedSchedule` は `{ startTime, durationMinutes }`。
  開始時刻は `HH:mm`、所要時間は1〜10,080分の整数、解除はnull。
- `plannedSchedule` 単独、日付 `schedule` 単独、両方の同時変更を受け付ける。
  名前やThemeなど他の項目との混在は受け付けない。
  changesとbaseは同じ項目集合を持つ。
- 時刻・所要時間はTaskの `planned_start_time` / `planned_duration_minutes` へ保存し、Task versionで保護する。
  日付は別EntityのScheduleへ保存し、`expectedScheduleVersion` で保護する。
  日付を変えない要求は `expectedScheduleVersion: null` とする。
- 同時変更は既存Application Commandの一つのtransactionで保存する。
  どちらかが競合・保存失敗になれば両方を残し、部分保存しない。
  `today_date` の今日割当とScheduleの期限・期間は分離したまま。
- 競合応答は実際に異なるversionを見て `conflictField: task | schedule` を返す。
  canonical Taskに時刻・所要時間と日付Scheduleを含め、ローカルの元要求を保持して解決する。

Checklistは同一Taskのversionが進んだ場合、base・ローカル・canonicalのitem IDごとに比較する。
別itemの変更や追加は既存IDとsort orderを保持して合成する。
同じitemの異なる編集、削除と編集、同じ順序位置への異なる追加、100件を超える合成は競合にする。
配列を無条件に置き換えて他端末の変更を消さない。
再送時には永続化済みchange eventの変更前snapshotから同じ合成を再現し、同じreceiptへ収束する。

`mobile-gateway-phase4a.test.mjs` はMobile schema、Coreへの変換、予定の同時保存・解除、Task/Schedule競合、Checklistの合成・競合・再送を検証する。
`application-command.test.mjs` はSQLiteでの予定同時保存失敗のrollbackと再起動後receipt replayを検証する。
AndroidのRoom、入力draft、幅変更、先行receipt後の再投影はAndroid側の検証で扱う。
