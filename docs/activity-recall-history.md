# 振り返りで使う当時の名称・所属

Issue #542。`profile: "recall"` は過去の出来事を現在のTask名・所属だけで表示しない。
保存済みeventとsnapshotから当時のラベルを解決し、根拠が足りない箇所は明示する。
現在のCurrent Work、既定Activity、正本のID・event ID・保存内容は変更しない。

## 保存済みの証拠

対象名は元eventのafter snapshot、before snapshotの順に読む。
どちらにも名前がなければ現在名を表示し、`recall.history.entity_title_source = current_fallback` とする。
現在名もなければ `unknown` とし、対象の型とIDだけを表示する。
本文・descriptionはsnapshotから読み戻さない。

当時の所属は元eventの`theme_ref`、after snapshot、before snapshotの順に読む。
証拠がなければ`theme_ref_source = unknown`、所属はnoneとする。
現在の所属を補完して過去のTheme別queryへ入れることはない。
旧eventのmigrationが現在entityを使って補った値も、今回の履歴根拠には使わない。
作成eventのないCapture補完行も現在レコードであり、過去所属の証拠には扱わない。

Theme名は同Themeの保存済み変更から、対象時刻以前の最新after名を使う。
それがない場合だけ、時刻より後の最初のbefore名を使い、由来を`theme_event_before`と明示する。
履歴がなければ現在Theme名を`current_fallback`として表示する。
これは保存済み変更に基づく表示であり、完全な版履歴があるとは主張しない。
Theme履歴の時刻比較はISO表記の文字順ではなく同じ瞬間の値で行う。

`recall.history`には名称・所属の由来に加え、`current_entity_title`、`current_theme_ref`、
`current_theme_title`を別項目として返す。
JSONとMarkdownの双方で当時の根拠と現在情報を区別する。

## 現在の公開範囲を優先する

AI向けrecallでは現在の対象entityのvisibilityを判定したうえで、当時のThemeと現在のThemeにも
現在の公開方針を適用する。
過去publicだったThemeがprivateになった場合や、現在の対象がprivateになった場合は、
旧タイトル・旧summary・リンクを返さず除外理由だけを返す。
当時のThemeが現在見つからない場合も、現在の許可を確認できないため除外する。

削除済みまたはmissingの対象entityは、`include_archived`でsnapshotに含まれていてもrecallから除外する。
削除済みの二次参照も返さない。
`type` / `id` の参照だけでなく、canonical参照の `entity_id` も現在の対象を一意に解決して公開判定する。
`kind` は保存先の種類でありEntity種別へ推測変換しない。
同じIDが複数種別に存在する場合、対象を決められないcanonical参照は除外する。
`entity_id`を持たない外部URL・root相対参照は既存のサニタイズ契約を維持する。
`state = archived`のように削除されていないアーカイブ項目は、現在の公開範囲が許す場合に履歴を残す。
正本snapshotから本文を復活させる処理、DBへのbackfill、新たな全文version管理は行わない。

## 検証

`tests/activity-recall-history.test.mjs`では、Theme A→B移動、Task・Theme改名、archive、delete、
missing、対象および両Themeのprivate化、非公開・削除済みsource参照、履歴不足、before/afterの由来、
IDと入力snapshotの不変を確認する。
同じfixtureでAのrecallに当時の記録が残り、Theme AI PackのCurrent WorkはBだけに現在Taskを載せることを確認する。
Core runtime schemaとMCPの公開projectionは既存recall回帰テストにより検証する。
