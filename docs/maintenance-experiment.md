# Maintenanceの最小実験（#454後半 / O単位）

`docs/issue-design-plan-2026-09-20.md` の「Maintenanceの最小実験」を実装するための契約。
扱うのは「対象」「すること」「前回実施日」「次の目安」だけ。
**目安は推奨間隔からの提案**であり、必ず守る締切ではない。

## 保存するもの

| Entity              | 役割           | 主なfield                                                                                                                                                   |
| ------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maintenance`       | 手入れする対象 | `title`、`target`（対象）、`action`（すること）、`interval_days`（推奨間隔1〜3650）、`last_performed_on`、`next_due_on`、`started_on`、`note`、`project_id` |
| `maintenance_entry` | 1回の実施記録  | `maintenance_id`、`performed_on`、`next_due_on`、`previous_due_on`、`previous_performed_on`、`note`、`recorded_at`                                          |

- どちらも **Entity** として保存し、Snapshot/Exportの対象になる（`src/shared/entityRegistry.mjs`）。
- `maintenance_entry` は `maintenance` が無いと保存できない（`requireV2`）。`maintenance` を削除すると実施記録も一緒に外れ、**復元で一緒に戻る**。
- **Taskは作らない。** 目安から `task` も `schedule` も自動生成しない（テストで固定）。
- 実施記録のIDは `maintenance-entry:<maintenance_id>:<performed_on>`。同じ日の2回目は
  **記録を増やさず**、次の目安だけを更新する（Habitの「もう1回記録」とは意味が違う）。

## 次の目安の決め方

1. 前回が分からない項目は `next_due_on` を空のまま作り、**「次の目安を決める」**から始める。
   勝手に「期限超過」へ分類しない。
2. 実施を記録すると、次の目安は**今回の実施日＋推奨間隔**で提案する。
3. 利用者が日付を指定した場合は、その値を保存する。
4. 戻すときは、記録側に残した `previous_due_on` / `previous_performed_on` へ戻す。
   実施記録と次の目安の**両方**が戻る。

`maintenanceDue` が返す状態は `unscheduled`（次の目安を決める）/ `upcoming` / `due_soon`（7日以内）/
`overdue`（目安を過ぎた）。`overdue` は**目安の超過**であって、Taskの期限違反ではない。

## 画面

| 場所     | 内容                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------- |
| Today    | 「手入れ」の節。**目安が近い（7日以内）か過ぎた項目だけ**を小さく出す。未実施回数は積み上げない   |
| Settings | 「Maintenance」の節。追加（対象・すること・推奨間隔）、次の目安、実施の記録、履歴、削除と元に戻す |

実装は `components/MaintenancePanel.tsx`（`manage` で Settings の管理面を出す）。
`projectWorkspaceData` の `WORKSPACE_ARRAY_KEYS` へ `maintenances` / `maintenance_entrys` を入れてある
（入れ忘れると保存はできるのに画面へ出ない。`tests/workspace-projection-keys.test.mjs` が固定する）。

## 検証

```powershell
rtk npm run typecheck
rtk npm run build
rtk npm run audit:maintenance
rtk node scripts/run-electron-node.mjs --test tests/maintenance-schedule.test.mjs
rtk node scripts/run-electron-node.mjs --test tests/maintenance-storage.test.mjs
```

`audit:maintenance` は隔離した一時userDataで実画面を通す。手入れが無いTodayへ空の案内を出さないこと、
追加直後は「次の目安を決める」でTodayに出ないこと、目安が近いと出ること、実施の記録で
次の目安が提案されること、指定した目安が保存されること、同じ日の2回目が記録を増やさないこと、
直前の記録を戻すと**記録と次の目安の両方**が戻ること、目安超過がTodayの期限の確認に出ないこと、
削除と元に戻す、再起動後の保持を実測する。スクリーンショットは `output/playwright/maintenance-audit`。

## まだ無いもの

| 未実装                | 内容                                                                       |
| --------------------- | -------------------------------------------------------------------------- |
| 実利用評価            | 少なくとも一回の手入れ周期を含めて評価し、利用回数の少なさだけで廃止しない |
| 目安の一括見直し      | 複数項目の目安をまとめて調整する導線                                       |
| 外部Signal            | 自動実施判定は手動モデルが成立した後の別実験                               |
| 独立したTop Level画面 | 必要性を確認してから判断する（いまはTodayとSettingsだけ）                  |
