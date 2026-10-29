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
通常のメモ入力は「Feedへ投稿」を主操作とし、入力とThemeをそのままFeed専用の投稿（`feed_post`）として保存する。
未整理CaptureやNoteを作らないため、投稿後に「整理する」操作を要求しない。失敗時は入力を残す。
上のCapture整理フローは既存Captureやファイル・画像・手書きの受取履歴に適用し、通常のメモショートカットには適用しない。

タスク追加（`Ctrl+Shift+M`）では「保存してFocus開始」または`Ctrl+Alt+Enter`で、
保存したTaskのFocus Sessionをメイン画面に開ける。`Ctrl+Enter`の通常保存と
`Ctrl+Shift+Enter`の連続追加は従来通り。AI整理で候補をまとめて追加する画面には適用しない。
Focus開始に失敗した場合や別のFocusが進行中・一時停止中の場合も、Taskは保存済みとして保持する。
「Focus開始を再試行」は同じTaskを使い、「保存済み・閉じる」で保存だけを終えられる。
別のFocusは自動で終了・置換しない。保存結果が不明な場合は編集を止め、同じCommand IDで再確認する。

## 正本と境界

- 受取履歴の正本は `CaptureEntry`。
- URLは `content_type=url` と `url` を保持し、InboxでResource候補として開く。
- ファイルと画像は `CaptureEntry` と、`source_type=capture_entry` のlinked Artifactを
  一つの保存操作で作る。元ファイルを勝手にコピーしない。
- Ink Captureは `CaptureEntry` と編集可能なSketchを一つの保存操作で作る。
- Task / Note / Resourceへ整理すると、Captureに付いていたArtifactも整理先へ移す。
- 「やったことを記録」（`Ctrl+Shift+,`）では、成果物のファイル・URLをドロップするか、コピーしたファイルを貼り付けて添えられる。
  保存すると完了Taskと、`source_type=task` のlinked Artifactを作る。ファイルはコピーせず元の場所を参照する。
  見つからないファイルや http(s) 以外のURLがあればTaskを作らずに止め、入力と添付を残す。
  外からドラッグしてくる間に閉じないよう、このモードはTask追加と同じくフォーカスが外れても開いたままにする。
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
