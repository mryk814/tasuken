# Command Palette

## 利用者の一周

1. `Ctrl+Shift+K`、またはタイトルバーの「コマンド」で開く。
2. コマンド名、Task、Note、Theme、Resource、Artifactを同じ入力欄から検索する。
3. `↑` / `↓`で候補を選び、`Enter`で実行する。`Esc`で閉じると元のfocusへ戻る。
4. 実行したコマンドやEntityはRecentへ残り、次回すぐ再実行できる。

## 境界契約

- registryはRenderer内の固定リストと正式Workspaceデータの検索投影で構成し、任意コードを読み込まない。
- 作成は既存Drawer、移動は既存route、保存や出力はNotesの既存処理へ委譲する。
- Markdown Edit内の`Ctrl+K`はリンク作成を維持する。Paletteは`Ctrl+Shift+K`を全画面共通とし、編集欄外では`Ctrl+K`でも開ける。
- Paletteからの画面遷移も既存の未保存・Drawer保存規則を通る。
