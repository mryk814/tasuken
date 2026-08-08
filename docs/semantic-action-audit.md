# Semantic action audit (#312)

基準日は 2026-08-08。操作の意味は `Button` の `variant`、状態の意味は `StatusBadge` と `--color-status-*`、AI用途のアイコンは `pages/semanticIcons.ts` を正本にする。

## 監査コマンド

```powershell
rg -n --glob '*.tsx' --glob '*.ts' '(IconSparkles|IconBulb|IconWand|IconRobot)' src/renderer/src
rg -n --glob '*.tsx' --glob '*.ts' '(danger-button|danger-text|is-danger)' src/renderer/src
rg -n --glob '*.tsx' --glob '*.ts' '(primary-button|secondary-button|text-button)' src/renderer/src/features/workspace
rg -n --glob '*.html' --glob '*.css' ':[[:space:]]*#[0-9A-Fa-f]{3,8}' src/renderer
```

## AI icon inventory

| 用途 | 現在の正本 | 判定 |
|---|---|---|
| AI回答を受け取る | `ContextPackDialog.tsx` / `Button variant="ai"` | AI依頼。適切 |
| AI Draft / Note AI | `NotesPage.tsx`, `NoteAiDialog.tsx` | AI生成・提案。適切 |
| AI向けContext | `ThemePage.tsx` | AIへ渡す。適切 |
| assistant message | `ConversationPreview.tsx` | AI生成結果。適切 |
| AI IO route | `routeIcons.ts` | AI連携画面。適切 |
| Knowledge node `insight` | `KnowledgePage.tsx` の `IconBulb` | Knowledge種別。AI iconではない |
| Sketch「手描き認識」 | `SketchPage.tsx` の `IconShape` | 通常の図形認識。Sparklesを除去済み |

機械検索で残る `IconSparkles` は `semanticIcons.ts` のregistryだけで、featureからの直接importはない。Knowledge化・通常の関連付け・自動保存・コピーにはAI iconを使っていない。

Today mini、Quick Capture、Memo stickyのstandalone windowも `electron.vite.config.ts` の `tasken-shared-design-tokens` pluginで同じ `design-standard/tokens.css` をbuild時に注入する。各HTMLに独自の色パレットやhex値を残さず、`data-theme` の切替とdark modeを共通tokenへ接続している。

## Danger audit

赤系の操作は次の不可逆または影響範囲の大きい操作に限定した。

- Entity削除、Knowledge/Theme section削除: `drawer.tsx`, `ThemePage.tsx`
- Draft破棄・Source置換: `DraftWorkspaceDialog.tsx`
- Calendar接続解除、保存済みAPI key削除: `SettingsPage.tsx`
- link解除などの不可逆操作: `MarkdownRichEditor.tsx`

次の状態変更・作業中断はdangerからsecondaryへ変更した。

- Timelineの依存接続をキャンセル
- Waitingを中止
- Pending Proposalを却下

`statusTone` は `delayed` / `overdue` をworkflowの `blocked` に分類し、操作dangerの赤とは分離している。状態表示はlabelとmarkを併記し、Timelineの左表は共通 `StatusBadge`、右のbarは状態label・記号・線種を併用する。

## Primary audit

主要surfaceの入口は次の通り。各surfaceの主目的に対するprimaryを一つにし、補助操作はsecondary/ghostへ置く。

| Surface | Primary |
|---|---|
| Today | 今日のTaskを追加 |
| ToDo | タスクを追加 |
| Inbox | Memo |
| Timeline | 実施事項を追加 |
| Knowledge | 問いを追加 |
| Notes | 文書の保存・作成（編集状態では保存をprimary） |
| Chat Refs | 追加 |
| Settings / 各設定panel | そのpanelの保存・接続 |
| AI IO / Preview | 現在の段階の採用・取り込み |

## Accessibility and motion

`Button` は常にkeyboard focus ring・disabled状態・hover/activeを持ち、既定typeを `button` にする。icon-only controlは既存の `aria-label` を維持する。`StatusBadge` は色以外にmarkとlabelを持つ。既存の `prefers-reduced-motion: reduce` を共通semantic buttonにも適用する。
