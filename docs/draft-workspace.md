# Draft Workspace

## 利用者の一周

1. Notesの「AI Draft」で、AI原稿・任意のサービス名・元チャットURL・指示メモを受け取る。
2. AI原稿を不変の`Source Draft`としてNoteの`properties_json.draft_workspace`へ保存し、通常の`body_markdown`を`Working Draft`として作る。
3. Source / Edit / Diffを切り替え、変更ブロック単位でSource側を採用する。採用とSnapshot復元は保存前ならUndoできる。
4. Working Draftを通常のMarkdown Noteとして保存し、既存NotesのPreview・Markdown保存・PDF出力を使う。
5. 再依頼文をクリップボードへ出し、返答は新しいSource Draftとして追加する。既存Working Draftは上書きしない。

## データと境界

- Source Draft、AIサービス、URL、指示、軽量SnapshotはNoteの`properties_json.draft_workspace`に保持する。
- Working Draftの正本は既存どおりNoteの`body_markdown`。別Entityや別ファイルへ複製しない。
- Source Draftは最大12件、Snapshotは最大20件を保持し、長期運用でNoteの付帯データが無制限に増えないようにする。
- Diffは表示時だけ計算し、既存の長文向けcoarse diff境界を再利用する。
- AI APIは内蔵せず、再依頼と返答はクリップボード往復を正規経路にする。
