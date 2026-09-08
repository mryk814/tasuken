# 選択Taskの日程変更案

Taskの編集画面で「文章から日程を変更」を選び、今回の指示を入力する。
編集中の内容がある場合は先に保存する。
「変更案を確認」で変更前後と警告を確認し、「この日程を適用」で保存する。
取消し・取得失敗では指示を残し、「通常の日程編集」へ戻ると原指示を参照しながら時刻・所要時間・日付を編集できる。

入力整理と同じ任意provider設定を使う。
Mainは保存済みTask、所属Theme、workspaceのAI公開範囲から `external_ai` を判定し、送信前と候補取得後に確認する。
TaskのID・version・現在の予定、今回の指示、入力日時・timezoneと、そこから導出した15日分の日付anchorだけを送る。
Taskのタイトル・本文・Theme名・Checklist・他のTaskは送らない。

出力は開始日、期限、期間の意味、今日割当、予定時刻、所要時間のpatchに限定する。
patchの省略は保持、`null` は明示解除を表し、同値の変更は確認対象から除く。
provider wireでは各項目の `change` と `value` を必須にし、未指定と解除を区別する。
不正な型・日付・時刻を拒否し、逆転した日付や期間の意味と整合しない変更は未適用の警告にする。
相対曜日の解釈方針は既存入力整理と同じ日付anchorに従い、実APIの解釈精度をfixtureの結果から推定しない。

採用は既存の `UpdateTask` Commandを使い、触れないTask項目とSchedule項目を保持する。
Taskのexpected versionに加え、任意の `expectedSchedule` で確認時のSchedule ID/versionまたは不存在を検査する。
これにより時刻だけを変更する場合も、取得後の別の日程編集やSchedule新規作成を競合として止める。
確認案ごとにCommand IDを固定し、二重操作と同内容の再送を既存receiptで重複排除する。
指示文は入力・確認・通常編集への移動中に保持し、Task本文への追記は行わない。

検証は `tests/task-schedule-proposal.test.mjs`、既存Command/providerテスト、`tests/drawer-form-plans.test.mjs` が担当する。
fake providerのfixture、SQLite再オープン、再送、Task/Schedule競合、外部AI公開範囲の変更を検査する。
実APIの意味解釈品質は未検証とし、隔離Electronの表示・操作確認とは分けて扱う。
