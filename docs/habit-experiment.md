# Habitの最小実験（#454後半 / O単位）

`docs/issue-design-plan-2026-09-20.md` の「Habitの最小実験」を実装するための契約。
**手動記録だけ**を扱い、日付ごとのTaskを自動生成しない。連続日数・達成率・失敗を強調する表示は持たない。

## 保存するもの

| Entity        | 役割          | 主なfield                                                                                                                                                                          |
| ------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `habit`       | 続けること    | `title`、`schedule_kind`（`daily` / `weekly`）、`weekly_target`（1〜7、weeklyのみ）、`state`（`active` / `paused`）、`started_on`、`paused_at`、`resumed_at`、`note`、`project_id` |
| `habit_entry` | 1回の実施記録 | `habit_id`、`performed_on`（YYYY-MM-DD）、`sequence`（1〜50）、`recorded_at`、`corrected_at`、`note`                                                                               |

- どちらも **Entity** として保存し、Snapshot/Exportの対象になる（`src/shared/entityRegistry.mjs`）。
- `habit_entry` は `habit` が無いと保存できない（`requireV2`）。`habit` を削除すると実施記録も一緒に外れ、**復元で一緒に戻る**。
- **Taskは作らない。** Habitの記録から `task` を自動生成しない（テストで固定）。

## 記録の重複をどう防ぐか

実施記録のIDは**組み立てで決める**（`src/shared/contracts/habit/progress.ts`）。

```text
habit-entry:<habit_id>:<performed_on>:<sequence>
```

- 連打と通信再送は同じIDになるため、**記録が増えない**。
- 同じ日の2回目は `nextEntrySequence` が返す次の番号を使い、**別の記録**になる（UIの「もう1回記録」）。
- 実施日を後から直しても記録は作り直さないので、**IDは変えず** `performed_on` と `corrected_at` だけを更新する。
- `sequence` は数値なので、文字列だけを見る汎用の必須field検証には入れず、domain側で検証する。

## 週の区切り

**利用者のローカル日付で月曜開始**（`weekRangeOf`）。呼び出し側が利用者のタイムゾーンで求めた「今日」を渡す。
`performed_on` は利用者が記録した時点のローカル日付なので、週の計算に時差変換は入らない。

- 主表示は「今日1回」「今週2/3回」。`daily` は今週の目標を7回とする。
- 先週以前の記録は今週へ数えない。**連続日数や達成率は返さない**（`habitProgress` の戻り値をテストで固定）。

## 一時停止と再開

`habitStateAfter` が `state` と `paused_at` / `resumed_at` だけを変える。**過去の実施記録は書き換えない。**

## 削除・復元・Export

- 削除は論理削除。`habit` を削除すると `habit_entry` も一緒に外れ、復元で一緒に戻る（`repositoryDeletePolicy.mjs`）。
- 実施記録の取消・実施日の修正は、記録を消して作り直すのではなく**同じIDの更新**で行う。
- Export/Importは既存のSnapshot経路がEntityを丸ごと運ぶため、`habit` / `habit_entry` もそのまま往復する。

## 検証

```powershell
rtk node scripts/run-electron-node.mjs --test tests/habit-progress.test.mjs
rtk node scripts/run-electron-node.mjs --test tests/habit-storage.test.mjs
rtk npm run typecheck
```

## まだ無いもの

| 未実装               | 内容                                                                      |
| -------------------- | ------------------------------------------------------------------------- |
| Todayの表示          | 「続けること」の節、`1回記録`、記録後の時刻とUndo、`もう1回記録`          |
| 履歴と実施日修正のUI | 過去記録の一覧と日付の修正、一時停止・再開、削除とUndoの導線              |
| 実利用評価           | 2週間程度の使用で「自然に記録できるか」「Recurring Taskより意味が合うか」 |
| Widget               | 価値を確認した後に判断する                                                |
| Maintenance          | Habitの後に別の小さな実験として進める（計画書のO単位）                    |
