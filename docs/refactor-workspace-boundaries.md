# Workspace boundary refactor

## 目的

現在の動作を変えずに、Workspace の正本、Main Process、Renderer の責務境界を明確にする。

## 非交渉の互換条件

1. 既存の SQLite データと Workspace Snapshot をそのまま読み書きできる。
2. `window.api`、Preload、IPC の公開契約を変えない。
3. Notes、Drawer、Timeline、Quick Capture、Today Mini の操作結果を変えない。
4. Export / Import の形式と往復結果を変えない。
5. `npm test`、`npm run typecheck`、`npm run build`、`npm run smoke:desktop` を各フェーズで維持する。

## フェーズ

1. `workspace-v2` の別名レイヤーを撤去し、`workspace/domain-model` を唯一の正本にする。
2. `src/main/index.ts` から Window、Tray、Reminder、Protocol の責務を分離する。
3. `drawer.tsx` と `NotesPage.tsx` を責務単位の component / hook / helper へ分離する。

各フェーズは単独でビルド・起動可能な状態にし、フェーズごとにコミットする。
