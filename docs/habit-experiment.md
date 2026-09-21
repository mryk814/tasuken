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

## 画面

| 場所     | 内容                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------- |
| Today    | 「続けること」の節。**Habitがある場合だけ現れる**（未使用の人へ空の設定案内を常設しない）      |
| Today    | 主表示「今日1回」「今週2/3回」、主操作「1回記録」／同じ日の追加は「もう1回記録」               |
| Today    | 記録後は実施日と「直前の記録を取り消す」、履歴（実施日を修正・取消）、一時停止と再開           |
| Settings | 「Habits」の節。追加（名前・毎日1回／週N回）、削除と元に戻す、一時停止と再開はここからも行える |

実装は `components/HabitPanel.tsx`（`manage` で Settings の管理面を出す）。

`projectWorkspaceData` は `WORKSPACE_ARRAY_KEYS` に載っているcollectionだけを画面へ渡す。
`habit` / `habit_entrys` をここへ入れ忘れると、保存はできるのにTodayへ出ない
（実装時に実際に起きた）。`tests/workspace-projection-keys.test.mjs` がRegistryとの一致を固定する。

## 削除・復元・Export

- 削除は論理削除。`habit` を削除すると `habit_entry` も一緒に外れ、復元で一緒に戻る（`repositoryDeletePolicy.mjs`）。
- 実施記録の取消・実施日の修正は、記録を消して作り直すのではなく**同じIDの更新**で行う。
- Export/Importは既存のSnapshot経路がEntityを丸ごと運ぶため、`habit` / `habit_entry` もそのまま往復する。

## 検証

```powershell
rtk npm run typecheck
rtk npm run build
rtk npm run audit:habit
rtk node scripts/run-electron-node.mjs --test tests/habit-progress.test.mjs
rtk node scripts/run-electron-node.mjs --test tests/habit-storage.test.mjs
rtk node scripts/run-electron-node.mjs --test tests/workspace-projection-keys.test.mjs
```

`audit:habit` は隔離した一時userDataで実画面を通す。Habitが無いTodayへ空の案内を出さないこと、
Settingsでの追加、Todayの「今日1回」「今週1/3回」、記録後の実施日と取消、同じ日の2回目が
別記録になること、履歴からの実施日修正（今週の数が変わり記録は増えない）、一時停止と再開、
削除と元に戻す、**再起動後の保持**を実測する。スクリーンショットは `output/playwright/habit-audit`。

## まだ無いもの

| 未実装      | 内容                                                                      |
| ----------- | ------------------------------------------------------------------------- |
| 実利用評価  | 2週間程度の使用で「自然に記録できるか」「Recurring Taskより意味が合うか」 |
| Widget      | 価値を確認した後に判断する                                                |
| Maintenance | Habitの後に別の小さな実験として進める（計画書のO単位）                    |
