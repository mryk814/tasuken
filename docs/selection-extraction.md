# 選択範囲からの切り出し

## 利用者の一周

1. NotesのEditで本文を選択する。
2. 選択位置のツールバーからTaskまたはNoteを選ぶ。
3. 選択範囲から作られたタイトル候補を確認・修正する。
4. 作成後も元のNotes編集面、本文、スクロール位置を維持する。
5. 結果通知から作成先を開き、元の文書へ戻れる。

## 境界契約

- 初期対象はNote / Report / Promptを含むNoteエンティティのMarkdown本文とする。
- 元本文はコピー元であり、切り出し操作では書き換えない。移動は別機能として明示的に設計する。
- 作成先は通常のTask / Noteを使い、専用の切り出しEntityを増やさない。
- Task / Note、変更履歴、`derived_from` ReferenceをMain Repositoryの一括保存で確定する。
- Referenceは作成先を`source`、元Noteを`target`として、元見出しと短い引用を保持する。
- 元NoteのThemeを作成先へ引き継ぐ。Themeなしは未設定のまま保存する。
- 選択検出はDOM Selectionを読むだけとし、LexicalのUndo / Redo、IME、Markdown本文へ操作ノードを挿入しない。

## 非ゴール

- 元本文から選択範囲を削除する「移動」
- Taskと元Note本文の同期
- AIによる自動抽出
- 永続的なblock IDの導入
