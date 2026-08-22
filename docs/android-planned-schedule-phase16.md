# Android planned start/duration — withdrawn

Issue: #400  
Date: 2026-08-23

Phase 16 shipped an Android Task detail 「時刻」 editor for canonical `planned_start_time` / `planned_duration_minutes`, independent of 予定 (date range) and 今日に入れる.

## Product decision

時刻欄は製品として採用しない。Desktop にも Android にも「時刻」編集 UI は置かない。Fold 7 の時刻往復確認は打ち切った。

## What remains

- Gateway / Room は canonical `planned_start_time` と `planned_duration_minutes` を bootstrap / sync の読み取り投影として残す。契約を大きく戻さないため。
- Mobile `UpdateTask` の `plannedSchedule` write は撤去した。隠れた時刻書き込み API を残さない。
- 日付レンジの 予定 と 今日に入れる はそのまま。

## What was removed

- Android Task detail の「時刻」editor（開始時刻・所要・保存・解除）
- ViewModel / outbox の `plannedSchedule` enqueue
- 時刻 editor 専用の UI / command テスト

#400 の Desktop 時刻表示ギャップは後段。この文書は生きた機能説明ではない。
