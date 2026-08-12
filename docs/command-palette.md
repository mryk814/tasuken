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

## Tasken Root（Issue #393 Phase 0〜3）

### Phase 0 inventory

| 責任 | 正本 |
|---|---|
| 検索正規化・exact / prefix / partial / keyword ranking | `src/shared/commandPalette.mjs` |
| Action label・icon・role・safety・availability | `src/shared/taskenRoot.ts` |
| Task mutation | `src/main/services/applicationCommandService.ts` |
| global shortcut・singleton Root Window | `src/main/taskenRootController.ts` |
| Root検索・Action Panel | `src/renderer/src/tasken-root/TaskenRootApp.tsx` |
| shortcut設定 | generic Preference APIの `taskenRoot.globalShortcut` |

### 非交渉の互換条件

- 既存GUI、`Ctrl+Shift+K` のCommand Palette、Quick Capture等のdirect shortcutを維持する。
- Task mutationはRootでもApplication Commandだけを通し、`source: tasken_root` とexpectedVersionを記録する。
- Workspace schema、既存データ、Snapshot / Export形式を変更しない。
- Root Windowは常に一枚とし、再shortcutとEscapeでhide、アプリ終了時にhotkeyを解除する。
- RootでEntityを開く処理はMain UIへ引き渡し、Root専用の保存・drawer・viewer実装を持たない。

### Phase 1〜3の実装

- Phase 1: `CommandOrControl+Shift+Space`（設定可能）で専用Root Windowをtoggleする。既存NFKC検索契約でCommand / Task / Note / Theme / Resource / Artifactを横断し、Enterまたはmouseでprimary actionを実行する。
- Phase 2: `Ctrl+K` で共通Action Panelを開く。TaskのOpen / Focus / Complete / Reopen / Edit、NoteとArtifactの代表Actionをregistryから生成し、利用不可理由を表示する。
- Phase 3: SettingsでRoot shortcutを変更し、競合時は既存登録を維持して原因と修正方法を表示する。direct shortcutは共通registryで一覧化する。rankingは既存match scoreを主とし、localな利用回数とrecencyを小さなboostとして加える。

利用履歴はgeneric Preferenceへlocal保存し、外部送信しない。自然言語routingとAI writeはPhase 0〜3の対象外とする。

### 検証

- focused behavior: Tasken Root / Command Palette / Application Command 28件
- full test: 1,073件
- `npm run typecheck`
- `npm run build`（`out/renderer/root.html`を含む）
- consistency audit: findings 0
- script audit: PASS

Linux/Xvfbのdesktop smokeは既存fixtureの`ai_authority`検証エラーでcore smokeが停止する。Root実装より前のApplication Command fixture経路であり、Phase 0〜3のfocused/full testとは分離して扱う。packaged Windowsでのglobal shortcut、foreground復帰、125% / 150% scalingはWindows実機確認項目として残す。
