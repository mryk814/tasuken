# Universal Inbox / Quick Capture

Issue: #196

## 一周

```text
Capture
  text / Markdown / URL / file / image / ink
        ↓
Inbox（未整理）
  search / Theme候補 / 種類を選ぶ
        ↓
Clarify
  Task / Note / Markdown / Resource / Artifact
        ↓
整理済み
  元Captureと整理先を確認する
```

Quick Captureは分類を要求しない独立ウィンドウである。`Ctrl+Shift+N`で開き、
`Ctrl+Enter`は保存して閉じる。`Ctrl+Shift+Enter`は保存後もウィンドウを残し、
連続して記録できる。Themeは任意で、未指定でも保存できる。

## 正本と境界

- 受取履歴の正本は `CaptureEntry`。
- URLは `content_type=url` と `url` を保持し、InboxでResource候補として開く。
- ファイルと画像は `CaptureEntry` と、`source_type=capture_entry` のlinked Artifactを
  一つの保存操作で作る。元ファイルを勝手にコピーしない。
- Ink Captureは `CaptureEntry` と編集可能なSketchを一つの保存操作で作る。
- Task / Note / Resourceへ整理すると、Captureに付いていたArtifactも整理先へ移す。
- 整理は元Captureを物理削除せず、`triaged_to_type` / `triaged_to_id` を残す。
- アーカイブは削除ではない。整理済み画面から未整理へ戻せる。
- CaptureEntryを削除した場合、そのCaptureだけを参照する未整理Artifactは論理削除する。

## 内容種別

`content_type` は `text | markdown | url | file | image | ink`。
既存CaptureEntryに値がなくてもtextとして読めるため、データ移行は不要。

## 失敗と復旧

- 保存失敗時は入力内容をQuick Captureウィンドウに残す。
- ファイルが移動・削除されて開けない場合は、保存場所を確認するエラーを出す。
- 整理前の下書きはInbox画面内の状態であり、正式データの保存成功までCaptureEntryを変更しない。
- 削除は既存の論理削除とSnapshot復元経路に従う。

## 検証

- `npm.cmd run typecheck`
- `npm.cmd test`
- `npm.cmd run build`
- `npm.cmd run smoke:desktop`
