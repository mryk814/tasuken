# Notes本文identityの診断手順（#333）

この手順は、既存データを変更せずにNote / Report / Prompt / Resourceの本文混入を確認するためのものです。

## 1. 先に保全する

Tasukenを終了し、`research-desk.sqlite`とcanonical Markdownのフォルダを別場所へコピーします。
DBは通常、Electronの`app.getPath("userData")`配下にあります。Windowsの実データを直接編集せず、コピーを読み取り専用で確認します。

## 2. Entity本文をID・種別付きで一覧する

SQLiteで次を実行します。`note_type`が`report` / `prompt`の行も同じ`notes`テーブルにあるため、種類を省略しないでください。

```sql
SELECT
  id,
  note_type,
  title,
  theme_id,
  substr(body_markdown, 1, 240) AS body_preview,
  length(body_markdown) AS body_length,
  updated_at,
  json_extract(properties_json, '$.markdown_export.filePath') AS canonical_path,
  json_extract(properties_json, '$.markdown_export.bodySignature') AS body_signature,
  json_extract(properties_json, '$.markdown_export.fileSignature') AS file_signature
FROM notes
ORDER BY updated_at DESC;
```

`NOTE_A_ONLY`等、文書固有の語が別IDの`body_preview`やcanonical fileへ現れていないかを確認します。本文全文をログへ出さず、必要な行だけ保全コピー上で照合してください。

## 3. canonical Markdownを照合する

各Note行の`canonical_path`を、DBの別Noteのパスと取り違えていないか確認します。ファイル本文のfrontmatter `title`と本文固有語がDB行の`id`・`title`に対応するかを見ます。

同じファイルを複数Noteが指している場合は、保存せずにパス重複を記録します。ファイルを書き戻す修復は#333の診断範囲外です。

## 4. 混入が疑われる場合

次の情報を一組で記録してください。

- DBのEntity `id` / `note_type` / `updated_at`
- 混入している本文の固有語（全文ではなく短いsignatureまたは先頭語）
- canonical pathとファイルの更新時刻
- 本体Notesかdetached Note windowか
- 切替順（scope / Theme / search / Edit / Preview / Raw）
- 発生前の未保存表示とCtrl+S / autosaveの有無

修復前にはSQLiteコピーとcanonical filesを保持します。現在の実装はowner不一致のlive本文を保存せず、未保存警告を優先する契約なので、再現ログでは「保存されなかった」ケースも失敗ではなく安全側の結果として扱います。
