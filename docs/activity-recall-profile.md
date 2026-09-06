# Activity recall profile

Issue #541。`queryActivityEvents`、Core `get_activity` / `get_activity_entries` は
`profile: "recall"` を明示したときだけ入力・計画を含む振り返り用の索引を返す。
省略または `"default"` では従来の選択と出力形を維持する。
Today、Activity 画面、既存 MCP 呼出しの既定は変更しない。

## 選択と公開境界

recall は未整理 Capture の入力、Task 作成、意味のある Task / Plan / Schedule 変更を含む。
計画変更は状態、優先度、所属、親、実行者、今日の日付、棚、予定時刻・期間、繰り返し、
Schedule の日付・確度・粒度など保存フィールドで判定する。
タイトルだけの編集、version / updated_at だけの autosave は計画変更に数えない。
既存の作業記録・完了・AI 報告・人間の採用も残す。

非空の `event_kinds` は profile の既定種別選択を置き換える。
そのため明示した `task_created` / `task_updated` / `schedule_updated` が既定フィルターで
消えることはない。空配列は profile の既定選択を使う。
`include_in_activity` は既定表示のヒントで、公開権限ではない。
明示選択でも現在の AI visibility、秘密情報の除去、参照先の公開判定は省略しない。
recall の二次参照は全 AI audience で現在の公開範囲を確認し、Schedule は owner の公開範囲も確認する。

## 入力と実績を区別する

recall の各行だけに `recall` を追加する。`stage` は次の意味を持つ。

| stage          | 意味                                  |
| -------------- | ------------------------------------- |
| input          | 未整理 Capture を記録した             |
| planned        | Task を作成した、または計画を変更した |
| work_recorded  | 作業記録または Task 完了を記録した    |
| ai_reported    | AI の完了報告。人間の採用とは区別する |
| human_accepted | 人間が AI 作業を採用した              |
| organized      | Capture を正式な項目へ整理した        |
| changed        | その他の既存 Activity                 |

`authority` と `authority_origin` は既存 AI authority の現在値と由来を保つ。
未設定は null / unset で、AI 生成データを人間確認済みへ昇格しない。
`source_ref` は元の entity を指す。入力・計画・整理の行を実績件数として足し上げてはならない。
Markdown にも段階と根拠を記載する。

Capture は既存の作成 event があれば source ID で重複排除して使う。
作成 event のない旧 Capture だけ `capture-input:<id>` の安定 ID で補完する。
時刻は保存済み `captured_at`、本文索引はサニタイズ後の先頭 2,000 文字とする。
`captured_at` のオフセット表記は同じ瞬間の UTC ISO 文字列へ正規化する。
正本の Capture、Change Event、本文は書き換えない。
整理済み Capture の入力行は既定 recall に加えず、formalized / TaskCreated と入力を重複計上しない。

件数上限、日付・期間・種別フィルター、公開範囲の除外件数、truncated は共通 query を使う。
Core の ActivityEntries は既存どおり自身の result_meta を返す。
履歴時点の所属、期間境界、ページング拡張は別 Issue の対象とする。

## 検証

`tests/activity-recall-profile.test.mjs` で既定不変、入力・計画・AI段階、Capture の安定 ID / 重複排除、
原本不変、2,000文字の索引上限、空結果、visibility、非公開参照、Schedule owner、
件数上限と Core の日付/Task consumer・runtime schema を検証する。
`tests/tasken-core-mcp-wave8-integration.test.mjs` では recall を Core → HTTP → MCP に通し、
get_activity / get_activity_entries の同一結果と read_only を確認する。

`activityRecall.mjs` は Activity が所有する pure-domain の選択・分類ポリシーで、
既存 shared-runtime の `activityProjection.mjs` だけから呼ぶ。Transport DTO は既存の
`shared/contracts/task` feature-contract に置く。新しい `.mjs` / `.d.mts` の宣言ペアや
compatibility consumer は追加しない。`architecture/shared-ownership.json` に所有者を明記し、
`audit:architecture -- --enforce core-mcp` で監査する。
